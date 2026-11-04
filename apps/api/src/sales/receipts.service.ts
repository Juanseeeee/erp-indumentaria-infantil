import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PAYMENT_METHOD_LABELS, ReceiptCreateInput } from '@erp/contracts';
import { DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import { CHEQUE_STATUS_LABELS } from '@erp/domain-finance';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { businessDate } from '../common/dates';
import { AccountsService } from '../accounts/accounts.service';
import { AllocationsService } from '../accounts/allocations.service';
import { TreasuryService } from '../treasury/treasury.service';
import { ChequesService } from '../treasury/cheques.service';

/**
 * Recibos de cobro. Generan el crédito en la cuenta corriente del cliente y lo imputan a las facturas
 * indicadas; lo no imputado queda como saldo a favor. Las comisiones se devengan con cada imputación.
 * Cada medio entra en su caja, banco o billetera; los cheques quedan en cartera. Anular el recibo
 * genera los contramovimientos y devuelve los cheques (solo si siguen en cartera).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
    private readonly allocations: AllocationsService,
    private readonly treasury: TreasuryService,
    private readonly cheques: ChequesService,
  ) {}

  create(ctx: RequestContext, input: ReceiptCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const customer = await tx.party.findUnique({ where: { id: input.customerId }, include: { roles: true } });
        if (!customer || !customer.roles.some((r) => r.role === 'CUSTOMER')) throw new DomainError(ErrorCodes.VALIDACION, 'El tercero elegido no es cliente.');
        const total = roundMoney(input.payments.reduce((a, p) => a.plus(p.amount), dec(0)));
        const allocated = roundMoney(input.allocations.reduce((a, p) => a.plus(p.amount), dec(0)));
        if (allocated.gt(total)) throw new DomainError(ErrorCodes.VALIDACION, `Se imputan $ ${allocated.toFixed(2)} y el recibo es de $ ${total.toFixed(2)}.`);
        const date = input.date ?? businessDate();
        const number = `RC-${await this.numbering.next(tx, ctx.companyId, 'CUSTOMER_RECEIPT', '', 8)}`;
        const receipt = await tx.customerReceipt.create({
          data: {
            companyId: ctx.companyId,
            number,
            customerId: customer.id,
            date,
            total: total.toString(),
            notes: input.notes,
            createdBy: ctx.userId,
          },
        });
        for (const p of input.payments) {
          const isCheque = p.method === 'CHEQUE' || p.method === 'ECHEQ';
          let cashAccountId: string | null = null;
          let chequeId: string | null = null;
          if (isCheque) {
            const cheque = await this.cheques.receiveInTx(tx, ctx, {
              isEcheq: p.method === 'ECHEQ',
              bank: p.bank!,
              number: p.reference!,
              amount: p.amount,
              paymentDate: p.dueDate!,
              issueDate: p.issueDate,
              drawerName: p.drawerName,
              drawerTaxId: p.drawerTaxId,
              receivedFromId: customer.id,
              date,
              sourceDocType: 'CUSTOMER_RECEIPT',
              sourceDocId: receipt.id,
              concept: `Recibo ${number}`,
            });
            cashAccountId = cheque.cashAccountId;
            chequeId = cheque.id;
          } else {
            const account = await this.treasury.accountForMethod(tx, p.method, p.cashAccountId);
            if (account) {
              cashAccountId = account.id;
              await this.treasury.postInTx(tx, ctx, {
                cashAccountId,
                direction: 'IN',
                amount: p.amount,
                operationDate: date,
                // Tarjetas y transferencias diferidas: el dinero está disponible a la fecha indicada.
                valueDate: p.dueDate && p.dueDate > date ? p.dueDate : date,
                concept: `Recibo ${number} · ${customer.legalName}`,
                paymentMethod: p.method,
                sourceDocType: 'CUSTOMER_RECEIPT',
                sourceDocId: receipt.id,
              });
            }
          }
          await tx.receiptPayment.create({
            data: { companyId: ctx.companyId, receiptId: receipt.id, method: p.method, amount: p.amount, reference: p.reference, bank: p.bank, dueDate: p.dueDate, cashAccountId, chequeId },
          });
        }
        const entry = await this.accounts.post(tx, ctx, {
          partyId: customer.id,
          accountType: 'RECEIVABLE',
          entryType: 'RECEIPT',
          sourceDocType: 'CUSTOMER_RECEIPT',
          sourceDocId: receipt.id,
          description: `Recibo ${number}`,
          date,
          amount: total.negated().toString(),
        });
        await this.allocations.allocateInTx(tx, ctx, entry.id, input.allocations);
        await this.audit.log(tx, ctx, { entity: 'customer_receipt', entityId: receipt.id, action: 'create', diff: { number, total: total.toString(), allocated: allocated.toString() } });
        return this.detailInTx(tx, receipt.id);
      },
      { idempotent: true },
    );
  }

  /** Anula el recibo: revierte sus imputaciones (y comisiones) y registra el movimiento inverso. */
  void(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_receipts WHERE id = ${id}::uuid FOR UPDATE`;
      const r = await tx.customerReceipt.findUnique({ where: { id }, include: { payments: true } });
      if (!r) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El recibo no existe.', 404);
      if (r.status === 'VOIDED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El recibo ya está anulado.');
      const today = businessDate();
      for (const p of r.payments) {
        if (p.chequeId) {
          await this.cheques.returnInTx(tx, ctx, p.chequeId, today, `Anulación recibo ${r.number}`, { type: 'CUSTOMER_RECEIPT_VOID', id });
        } else if (p.cashAccountId) {
          await this.treasury.postInTx(tx, ctx, {
            cashAccountId: p.cashAccountId,
            direction: 'OUT',
            amount: p.amount.toString(),
            operationDate: today,
            concept: `Anulación recibo ${r.number}`,
            paymentMethod: p.method,
            sourceDocType: 'CUSTOMER_RECEIPT_VOID',
            sourceDocId: id,
          });
        }
      }
      const entry = await tx.accountEntry.findFirstOrThrow({ where: { sourceDocType: 'CUSTOMER_RECEIPT', sourceDocId: id } });
      await this.allocations.reverseAllForEntry(tx, ctx, entry.id, `Anulación del recibo ${r.number}: ${reason}`);
      // El movimiento original queda con saldo abierto = importe; el inverso lo compensa y ambos se cancelan entre sí.
      const reversal = await this.accounts.post(tx, ctx, {
        partyId: r.customerId,
        accountType: 'RECEIVABLE',
        entryType: 'REVERSAL',
        sourceDocType: 'CUSTOMER_RECEIPT_VOID',
        sourceDocId: id,
        description: `Anulación recibo ${r.number}`,
        date: today,
        amount: r.total.toString(),
      });
      await this.allocations.allocateInTx(tx, ctx, entry.id, [{ entryId: reversal.id, amount: r.total.toString() }], 'Anulación de recibo');
      await tx.customerReceipt.update({ where: { id }, data: { status: 'VOIDED' } });
      await this.audit.log(tx, ctx, { entity: 'customer_receipt', entityId: id, action: 'void', reason });
      return this.detailInTx(tx, id);
    });
  }

  list(ctx: RequestContext, q: { customerId?: string; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.CustomerReceiptWhereInput = q.customerId ? { customerId: q.customerId } : {};
      const [rows, total] = await Promise.all([
        tx.customerReceipt.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { payments: true } }),
        tx.customerReceipt.count({ where }),
      ]);
      const [parties, entries] = await Promise.all([
        tx.party.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, legalName: true } }),
        tx.accountEntry.findMany({ where: { sourceDocType: 'CUSTOMER_RECEIPT', sourceDocId: { in: rows.map((r) => r.id) } }, select: { sourceDocId: true, openAmount: true } }),
      ]);
      return {
        total,
        rows: rows.map((r) => ({
          ...r,
          total: r.total.toString(),
          customer: parties.find((p) => p.id === r.customerId)?.legalName,
          methods: [...new Set(r.payments.map((p) => PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method))].join(', '),
          unapplied: r.status === 'POSTED' ? (entries.find((e) => e.sourceDocId === r.id)?.openAmount.abs().toString() ?? '0') : '0',
          payments: undefined,
        })),
      };
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, id));
  }

  private async detailInTx(tx: Tx, id: string) {
    const r = await tx.customerReceipt.findUnique({
      where: { id },
      include: { payments: { include: { cashAccount: { select: { name: true } }, cheque: { select: { id: true, status: true } } } } },
    });
    if (!r) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El recibo no existe.', 404);
    const [customer, company, entry] = await Promise.all([
      tx.party.findUnique({ where: { id: r.customerId }, select: { id: true, code: true, legalName: true, taxId: true, taxCondition: true } }),
      tx.company.findUnique({ where: { id: r.companyId }, select: { legalName: true, cuit: true, address: true } }),
      tx.accountEntry.findFirst({ where: { sourceDocType: 'CUSTOMER_RECEIPT', sourceDocId: id } }),
    ]);
    const active = entry ? await this.allocations.activeFor(tx, entry.id) : [];
    const debits = await tx.accountEntry.findMany({ where: { id: { in: active.map((a) => a.debitEntryId) } } });
    return {
      ...r,
      total: r.total.toString(),
      customer,
      company,
      entryId: entry?.id ?? null,
      unapplied: r.status === 'POSTED' && entry ? entry.openAmount.abs().toString() : '0',
      payments: r.payments.map(({ cashAccount, cheque, ...p }) => ({
        ...p,
        amount: p.amount.toString(),
        label: PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method,
        account: cashAccount?.name ?? null,
        chequeStatus: cheque ? CHEQUE_STATUS_LABELS[cheque.status] : null,
      })),
      allocations: active.map((a) => ({ id: a.id, amount: a.amount.toString(), document: debits.find((d) => d.id === a.debitEntryId)?.description, documentId: debits.find((d) => d.id === a.debitEntryId)?.sourceDocId, createdAt: a.createdAt })),
    };
  }
}
