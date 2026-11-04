import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SUPPLIER_PAYMENT_METHOD_LABELS, SupplierPaymentCreateInput, SupplierPaymentQuery } from '@erp/contracts';
import { DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import { CHEQUE_STATUS_LABELS } from '@erp/domain-finance';
import type { Tx } from '../prisma/prisma.service';
import { can, type RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { businessDate } from '../common/dates';
import { AccountsService } from '../accounts/accounts.service';
import { AllocationsService } from '../accounts/allocations.service';
import { ChequesService } from './cheques.service';
import { TreasuryService, asDate } from './treasury.service';

const label = (method: string) => SUPPLIER_PAYMENT_METHOD_LABELS[method as keyof typeof SUPPLIER_PAYMENT_METHOD_LABELS] ?? method;

/**
 * Órdenes de pago a proveedores y talleres. Generan el pago en su cuenta corriente y lo imputan a las
 * facturas indicadas (lo no imputado queda como anticipo). Cada medio sale de su cuenta: efectivo de
 * una caja, transferencia de un banco, cheques de cartera por endoso y cheques propios contra un banco.
 * Anular revierte imputaciones y fondos, recupera los endosos y anula los cheques propios no debitados.
 */
@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
    private readonly allocations: AllocationsService,
    private readonly treasury: TreasuryService,
    private readonly cheques: ChequesService,
  ) {}

  create(ctx: RequestContext, input: SupplierPaymentCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const supplier = await tx.party.findUnique({ where: { id: input.supplierId }, include: { roles: true } });
        if (!supplier || !supplier.roles.some((r) => r.role === 'SUPPLIER' || r.role === 'WORKSHOP')) {
          throw new DomainError(ErrorCodes.VALIDACION, 'El tercero elegido no es proveedor ni taller.');
        }
        const chequeIds = input.payments.map((p) => p.chequeId).filter((x): x is string => !!x);
        if (new Set(chequeIds).size !== chequeIds.length) throw new DomainError(ErrorCodes.VALIDACION, 'Hay un cheque repetido en el pago.');
        const cheques = await tx.cheque.findMany({ where: { id: { in: chequeIds } } });
        const amountOf = (p: SupplierPaymentCreateInput['payments'][number]) => {
          if (p.method !== 'THIRD_CHEQUE') return roundMoney(p.amount!);
          const c = cheques.find((x) => x.id === p.chequeId);
          if (!c) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El cheque de cartera no existe.', 404);
          if (c.status !== 'IN_PORTFOLIO') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `El cheque ${c.bank} n.º ${c.number} no está en cartera.`, 409);
          return roundMoney(c.amount.toString());
        };
        const amounts = input.payments.map(amountOf);
        const total = roundMoney(amounts.reduce((a, x) => a.plus(x), dec(0)));
        const allocated = roundMoney(input.allocations.reduce((a, x) => a.plus(x.amount), dec(0)));
        if (allocated.gt(total)) throw new DomainError(ErrorCodes.VALIDACION, `Se imputan $ ${allocated.toFixed(2)} y el pago es de $ ${total.toFixed(2)}.`);
        if (chequeIds.length) {
          const reserved = await tx.supplierPaymentLine.findFirst({
            where: { chequeId: { in: chequeIds }, payment: { status: 'PENDING_APPROVAL' } },
            include: { payment: { select: { number: true } } },
          });
          if (reserved) throw new DomainError(ErrorCodes.DUPLICADO, `Un cheque elegido ya está en la orden de pago ${reserved.payment.number}, pendiente de aprobación.`, 409);
        }
        // La cuenta de cada medio se fija al cargar, así la aprobación paga desde la misma.
        const accounts = await Promise.all(
          input.payments.map((p) => (p.method === 'THIRD_CHEQUE' ? null : this.treasury.accountForMethod(tx, p.method, p.cashAccountId))),
        );

        const date = input.date ? asDate(input.date) : businessDate();
        const pending = await this.needsApproval(tx, ctx, total.toString());
        const number = `OP-${await this.numbering.next(tx, ctx.companyId, 'SUPPLIER_PAYMENT', '', 8)}`;
        const payment = await tx.supplierPayment.create({
          data: {
            companyId: ctx.companyId,
            number,
            supplierId: supplier.id,
            date,
            total: total.toString(),
            notes: input.notes,
            status: pending ? 'PENDING_APPROVAL' : 'POSTED',
            pendingAllocations: pending ? input.allocations : undefined,
            createdBy: ctx.userId,
          },
        });
        for (const [i, p] of input.payments.entries()) {
          await tx.supplierPaymentLine.create({
            data: {
              companyId: ctx.companyId,
              paymentId: payment.id,
              method: p.method,
              amount: amounts[i]!.toString(),
              reference: p.reference,
              cashAccountId: accounts[i]?.id ?? null,
              chequeId: p.method === 'THIRD_CHEQUE' ? p.chequeId! : null,
              paymentDate: p.paymentDate ? asDate(p.paymentDate) : null,
            },
          });
        }
        if (!pending) await this.executeInTx(tx, ctx, payment.id, input.allocations);
        await this.audit.log(tx, ctx, {
          entity: 'supplier_payment',
          entityId: payment.id,
          action: 'create',
          diff: { number, total: total.toString(), allocated: allocated.toString(), status: payment.status },
        });
        return this.detailInTx(tx, payment.id);
      },
      { idempotent: true },
    );
  }

  /** Requiere aprobación si supera el umbral de la regla y quien la carga no puede aprobar. */
  private async needsApproval(tx: Tx, ctx: RequestContext, amount: string) {
    if (can(ctx, 'payables.approve')) return false;
    const rule = await tx.approvalRule.findFirst({ where: { actionCode: 'payables.payment', isActive: true } });
    return !!rule && dec(amount).gt(rule.threshold.toString());
  }

  /**
   * Mueve el dinero: cada medio sale de su cuenta (endoso, cheque propio, efectivo o transferencia),
   * se registra el pago en la cuenta corriente y se imputa. Al aprobar se vuelve a validar todo
   * (fondos en caja, cheque todavía en cartera, número de cheque propio libre, período abierto).
   */
  private async executeInTx(tx: Tx, ctx: RequestContext, paymentId: string, allocations: { entryId: string; amount: string }[]) {
    const payment = await tx.supplierPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { lines: true } });
    const supplier = await tx.party.findUniqueOrThrow({ where: { id: payment.supplierId } });
    const concept = `Pago ${payment.number} · ${supplier.legalName}`;
    const source = { type: 'SUPPLIER_PAYMENT', id: payment.id };
    for (const l of payment.lines) {
      const amount = l.amount.toString();
      if (l.method === 'THIRD_CHEQUE') {
        const c = await this.cheques.endorseInTx(tx, ctx, l.chequeId!, supplier.id, payment.date, concept, source);
        await tx.supplierPaymentLine.update({ where: { id: l.id }, data: { cashAccountId: c.cashAccountId } });
      } else if (l.method === 'OWN_CHEQUE' || l.method === 'OWN_ECHEQ') {
        const c = await this.cheques.issueOwnInTx(tx, ctx, {
          bankAccountId: l.cashAccountId!,
          isEcheq: l.method === 'OWN_ECHEQ',
          number: l.reference!,
          amount,
          paymentDate: l.paymentDate!,
          date: payment.date,
          deliveredToId: supplier.id,
          concept,
          source,
        });
        await tx.supplierPaymentLine.update({ where: { id: l.id }, data: { chequeId: c.id } });
      } else if (l.cashAccountId) {
        await this.treasury.postInTx(tx, ctx, {
          cashAccountId: l.cashAccountId,
          direction: 'OUT',
          amount,
          operationDate: payment.date,
          concept,
          paymentMethod: l.method,
          sourceDocType: source.type,
          sourceDocId: source.id,
        });
      }
    }
    const entry = await this.accounts.post(tx, ctx, {
      partyId: supplier.id,
      accountType: 'PAYABLE',
      entryType: 'PAYMENT',
      sourceDocType: 'SUPPLIER_PAYMENT',
      sourceDocId: payment.id,
      description: `Orden de pago ${payment.number}`,
      date: payment.date,
      amount: payment.total.negated().toString(),
    });
    await this.allocations.allocateInTx(tx, ctx, entry.id, allocations);
  }

  approve(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const payment = await this.lockPending(tx, id);
      if (payment.createdBy === ctx.userId) throw new DomainError(ErrorCodes.SIN_PERMISO, 'Una orden de pago no puede aprobarla quien la cargó.', 403);
      await this.executeInTx(tx, ctx, id, (payment.pendingAllocations ?? []) as { entryId: string; amount: string }[]);
      await tx.supplierPayment.update({ where: { id }, data: { status: 'POSTED', approvedBy: ctx.userId, approvedAt: new Date(), pendingAllocations: Prisma.DbNull } });
      await this.audit.log(tx, ctx, { entity: 'supplier_payment', entityId: id, action: 'approve' });
      return this.detailInTx(tx, id);
    });
  }

  reject(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      await this.lockPending(tx, id);
      await tx.supplierPayment.update({
        where: { id },
        data: { status: 'REJECTED', rejectionReason: reason, approvedBy: ctx.userId, approvedAt: new Date(), pendingAllocations: Prisma.DbNull },
      });
      await this.audit.log(tx, ctx, { entity: 'supplier_payment', entityId: id, action: 'reject', reason });
      return this.detailInTx(tx, id);
    });
  }

  private async lockPending(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM supplier_payments WHERE id = ${id}::uuid FOR UPDATE`;
    const payment = await tx.supplierPayment.findUnique({ where: { id } });
    if (!payment) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La orden de pago no existe.', 404);
    if (payment.status !== 'PENDING_APPROVAL') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La orden de pago no está pendiente de aprobación.');
    return payment;
  }

  void(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_payments WHERE id = ${id}::uuid FOR UPDATE`;
      const payment = await tx.supplierPayment.findUnique({ where: { id }, include: { lines: true } });
      if (!payment) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La orden de pago no existe.', 404);
      if (payment.status === 'VOIDED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La orden de pago ya está anulada.');
      if (payment.status !== 'POSTED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Solo se anula una orden de pago ya pagada; una pendiente se rechaza.');
      const today = businessDate();
      const concept = `Anulación pago ${payment.number}`;
      const source = { type: 'SUPPLIER_PAYMENT_VOID', id };
      for (const l of payment.lines) {
        if (l.method === 'THIRD_CHEQUE') await this.cheques.recoverInTx(tx, ctx, l.chequeId!, today, concept, source);
        else if (l.chequeId) await this.cheques.voidOwnInTx(tx, ctx, l.chequeId, today, concept, source);
        else if (l.cashAccountId) {
          await this.treasury.postInTx(tx, ctx, {
            cashAccountId: l.cashAccountId,
            direction: 'IN',
            amount: l.amount.toString(),
            operationDate: today,
            concept,
            paymentMethod: l.method,
            sourceDocType: source.type,
            sourceDocId: id,
          });
        }
      }
      const entry = await tx.accountEntry.findFirstOrThrow({ where: { sourceDocType: 'SUPPLIER_PAYMENT', sourceDocId: id } });
      await this.allocations.reverseAllForEntry(tx, ctx, entry.id, `${concept}: ${reason}`);
      const reversal = await this.accounts.post(tx, ctx, {
        partyId: payment.supplierId,
        accountType: 'PAYABLE',
        entryType: 'REVERSAL',
        sourceDocType: 'SUPPLIER_PAYMENT_VOID',
        sourceDocId: id,
        description: `Anulación orden de pago ${payment.number}`,
        date: today,
        amount: payment.total.toString(),
      });
      await this.allocations.allocateInTx(tx, ctx, entry.id, [{ entryId: reversal.id, amount: payment.total.toString() }], 'Anulación de orden de pago');
      await tx.supplierPayment.update({ where: { id }, data: { status: 'VOIDED' } });
      await this.audit.log(tx, ctx, { entity: 'supplier_payment', entityId: id, action: 'void', reason });
      return this.detailInTx(tx, id);
    });
  }

  list(ctx: RequestContext, q: SupplierPaymentQuery) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.SupplierPaymentWhereInput = { ...(q.supplierId ? { supplierId: q.supplierId } : {}), ...(q.status ? { status: q.status } : {}) };
      const [rows, total] = await Promise.all([
        tx.supplierPayment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { lines: true } }),
        tx.supplierPayment.count({ where }),
      ]);
      const [parties, entries] = await Promise.all([
        tx.party.findMany({ where: { id: { in: rows.map((r) => r.supplierId) } }, select: { id: true, legalName: true } }),
        tx.accountEntry.findMany({ where: { sourceDocType: 'SUPPLIER_PAYMENT', sourceDocId: { in: rows.map((r) => r.id) } }, select: { sourceDocId: true, openAmount: true } }),
      ]);
      return {
        total,
        rows: rows.map(({ lines, ...r }) => ({
          ...r,
          total: r.total.toString(),
          supplier: parties.find((p) => p.id === r.supplierId)?.legalName,
          methods: [...new Set(lines.map((l) => label(l.method)))].join(', '),
          unapplied: r.status === 'POSTED' ? (entries.find((e) => e.sourceDocId === r.id)?.openAmount.abs().toString() ?? '0') : '0',
        })),
      };
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, id));
  }

  private async detailInTx(tx: Tx, id: string) {
    const p = await tx.supplierPayment.findUnique({
      where: { id },
      include: { lines: { include: { cashAccount: { select: { name: true } }, cheque: { select: { id: true, bank: true, number: true, paymentDate: true, status: true, isEcheq: true } } } } },
    });
    if (!p) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La orden de pago no existe.', 404);
    const [supplier, company, entry] = await Promise.all([
      tx.party.findUnique({ where: { id: p.supplierId }, select: { id: true, code: true, legalName: true, taxId: true, taxCondition: true } }),
      tx.company.findUnique({ where: { id: p.companyId }, select: { legalName: true, cuit: true, address: true } }),
      tx.accountEntry.findFirst({ where: { sourceDocType: 'SUPPLIER_PAYMENT', sourceDocId: id } }),
    ]);
    const active = entry ? await this.allocations.activeFor(tx, entry.id) : [];
    // Pendiente de aprobación: todavía no hay imputaciones, se muestran las previstas.
    const planned = (p.pendingAllocations ?? []) as { entryId: string; amount: string }[];
    const debits = await tx.accountEntry.findMany({ where: { id: { in: [...active.map((a) => a.debitEntryId), ...planned.map((a) => a.entryId)] } } });
    const [creator, approver] = await Promise.all(
      [p.createdBy, p.approvedBy].map((uid) => (uid ? tx.user.findUnique({ where: { id: uid }, select: { name: true } }) : null)),
    );
    return {
      ...p,
      pendingAllocations: undefined,
      total: p.total.toString(),
      supplier,
      company,
      entryId: entry?.id ?? null,
      unapplied: p.status === 'POSTED' && entry ? entry.openAmount.abs().toString() : '0',
      lines: p.lines.map(({ cashAccount, cheque, ...l }) => ({
        ...l,
        amount: l.amount.toString(),
        label: label(l.method),
        account: cashAccount?.name ?? null,
        cheque: cheque ? { ...cheque, statusLabel: CHEQUE_STATUS_LABELS[cheque.status] } : null,
      })),
      allocations: active.map((a) => ({ id: a.id, amount: a.amount.toString(), document: debits.find((d) => d.id === a.debitEntryId)?.description, createdAt: a.createdAt })),
      plannedAllocations: planned.map((a) => ({ id: a.entryId, amount: roundMoney(a.amount).toFixed(2), document: debits.find((d) => d.id === a.entryId)?.description })),
      createdByName: creator?.name ?? null,
      approvedByName: approver?.name ?? null,
    };
  }
}
