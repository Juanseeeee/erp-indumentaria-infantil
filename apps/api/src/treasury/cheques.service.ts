import { Injectable } from '@nestjs/common';
import { Cheque, ChequeStatus, Prisma } from '@prisma/client';
import { ChequeCreditInput, ChequeDebitInput, ChequeDepositInput, ChequeQuery, ChequeRejectInput } from '@erp/contracts';
import { DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import { CHEQUE_STATUS_LABELS, ChequeEvent, assertCanDeposit, assertChequeData, chequeTransition } from '@erp/domain-finance';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { businessDate } from '../common/dates';
import { AccountsService } from '../accounts/accounts.service';
import { TreasuryService, asDate } from './treasury.service';

type Ctx = Pick<RequestContext, 'companyId' | 'userId' | 'ip'>;

export interface ReceiveChequeInput {
  isEcheq: boolean;
  bank: string;
  number: string;
  amount: string;
  paymentDate: Date;
  issueDate?: Date | null;
  drawerName?: string | null;
  drawerTaxId?: string | null;
  receivedFromId: string;
  date: Date;
  sourceDocType: string;
  sourceDocId: string;
  concept: string;
}

export interface IssueOwnChequeInput {
  bankAccountId: string;
  isEcheq: boolean;
  number: string;
  amount: string;
  paymentDate: Date;
  date: Date;
  deliveredToId: string;
  concept: string;
  source: { type: string; id: string };
}

/**
 * Cheques de terceros y propios. Los de terceros entran en cartera con un cobro y salen depositados
 * (recién al acreditarse suman al banco), endosados a un proveedor, rechazados (débito al cliente) o
 * devueltos (anulación del cobro). Los propios se emiten en un pago y salen del banco con fecha de
 * valor igual a la de pago. Cada cambio de estado deja un evento append-only y su movimiento de tesorería.
 */
@Injectable()
export class ChequesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly treasury: TreasuryService,
    private readonly accounts: AccountsService,
  ) {}

  /** Alta en cartera dentro de la transacción del cobro. */
  async receiveInTx(tx: Tx, ctx: Ctx, input: ReceiveChequeInput): Promise<Cheque> {
    // Sin fecha de emisión, la de recepción acota el plazo: no pudo emitirse después de que lo recibimos.
    const issueBound = input.issueDate ?? (input.paymentDate > input.date ? input.date : null);
    assertChequeData({ issueDate: issueBound, paymentDate: input.paymentDate, amount: input.amount });
    const dup = await tx.cheque.findFirst({
      where: { ownership: 'THIRD', bank: { equals: input.bank, mode: 'insensitive' }, number: input.number, status: { notIn: ['RETURNED', 'VOIDED'] } },
    });
    if (dup) throw new DomainError(ErrorCodes.DUPLICADO, `El cheque ${input.bank} n.º ${input.number} ya está registrado (${CHEQUE_STATUS_LABELS[dup.status].toLowerCase()}).`, 409);
    const portfolio = await this.treasury.portfolioAccount(tx, ctx);
    const party = await tx.party.findUnique({ where: { id: input.receivedFromId }, select: { legalName: true, taxId: true } });
    const cheque = await tx.cheque.create({
      data: {
        companyId: ctx.companyId,
        ownership: 'THIRD',
        isEcheq: input.isEcheq,
        bank: input.bank,
        number: input.number,
        amount: input.amount,
        currency: portfolio.currency,
        issueDate: input.issueDate ?? null,
        paymentDate: input.paymentDate,
        drawerName: input.drawerName ?? party?.legalName ?? null,
        drawerTaxId: input.drawerTaxId ?? party?.taxId ?? null,
        status: 'IN_PORTFOLIO',
        receivedFromId: input.receivedFromId,
        cashAccountId: portfolio.id,
        createdBy: ctx.userId,
      },
    });
    await this.event(tx, ctx, cheque, 'RECEIVE', null, 'IN_PORTFOLIO', input.date, portfolio.id, input.concept);
    await this.treasury.postInTx(tx, ctx, {
      cashAccountId: portfolio.id,
      direction: 'IN',
      amount: input.amount,
      operationDate: input.date,
      valueDate: input.paymentDate,
      concept: `${input.concept} · ${this.label(cheque)}`,
      paymentMethod: input.isEcheq ? 'ECHEQ' : 'CHEQUE',
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId,
    });
    return cheque;
  }

  /** Endoso a un proveedor dentro de la transacción del pago: sale de la cartera por su importe total. */
  async endorseInTx(tx: Tx, ctx: Ctx, chequeId: string, supplierId: string, date: Date, concept: string, source: { type: string; id: string }) {
    const cheque = await this.lock(tx, chequeId);
    if (cheque.ownership !== 'THIRD' || cheque.status !== 'IN_PORTFOLIO') {
      throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `El cheque ${this.label(cheque)} no está en cartera (${CHEQUE_STATUS_LABELS[cheque.status].toLowerCase()}).`, 409);
    }
    const portfolio = cheque.cashAccountId!;
    await this.transition(tx, ctx, cheque, 'ENDORSE', date, portfolio, concept, { deliveredToId: supplierId });
    await this.treasury.postInTx(tx, ctx, {
      cashAccountId: portfolio,
      direction: 'OUT',
      amount: cheque.amount.toString(),
      operationDate: date,
      valueDate: cheque.paymentDate > date ? cheque.paymentDate : date,
      concept: `${concept} · endoso ${this.label(cheque)}`,
      paymentMethod: 'THIRD_CHEQUE',
      sourceDocType: source.type,
      sourceDocId: source.id,
    });
    return cheque;
  }

  /** Anulación del pago: el cheque endosado vuelve a la cartera. */
  async recoverInTx(tx: Tx, ctx: Ctx, chequeId: string, date: Date, concept: string, source: { type: string; id: string }) {
    const cheque = await this.lock(tx, chequeId);
    if (cheque.status !== 'DELIVERED') {
      throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `El cheque ${this.label(cheque)} está ${CHEQUE_STATUS_LABELS[cheque.status].toLowerCase()}: no se puede anular el pago.`);
    }
    await this.transition(tx, ctx, cheque, 'RECOVER', date, cheque.cashAccountId, concept, { deliveredToId: null });
    await this.treasury.postInTx(tx, ctx, {
      cashAccountId: cheque.cashAccountId!,
      direction: 'IN',
      amount: cheque.amount.toString(),
      operationDate: date,
      valueDate: cheque.paymentDate > date ? cheque.paymentDate : date,
      concept: `${concept} · ${this.label(cheque)}`,
      paymentMethod: 'THIRD_CHEQUE',
      sourceDocType: source.type,
      sourceDocId: source.id,
    });
  }

  /** Emisión de un cheque o e-cheq propio: sale del banco con fecha de valor igual a la de pago. */
  async issueOwnInTx(tx: Tx, ctx: Ctx, input: IssueOwnChequeInput): Promise<Cheque> {
    const bank = await tx.cashAccount.findUnique({ where: { id: input.bankAccountId } });
    if (!bank || bank.type !== 'BANK') throw new DomainError(ErrorCodes.VALIDACION, 'Un cheque propio se emite contra una cuenta bancaria.');
    if (!bank.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `La cuenta ${bank.name} está inactiva.`);
    assertChequeData({ issueDate: input.date, paymentDate: input.paymentDate, amount: input.amount });
    const bankName = bank.bank ?? bank.name;
    const dup = await tx.cheque.findFirst({
      where: { ownership: 'OWN', bank: { equals: bankName, mode: 'insensitive' }, number: input.number, status: { notIn: ['VOIDED'] } },
    });
    if (dup) throw new DomainError(ErrorCodes.DUPLICADO, `El cheque propio ${bankName} n.º ${input.number} ya fue emitido.`, 409);
    const cheque = await tx.cheque.create({
      data: {
        companyId: ctx.companyId,
        ownership: 'OWN',
        isEcheq: input.isEcheq,
        bank: bankName,
        number: input.number,
        amount: input.amount,
        currency: bank.currency,
        issueDate: input.date,
        paymentDate: input.paymentDate,
        status: 'ISSUED',
        deliveredToId: input.deliveredToId,
        cashAccountId: bank.id,
        createdBy: ctx.userId,
      },
    });
    await this.event(tx, ctx, cheque, 'ISSUE', null, 'ISSUED', input.date, bank.id, input.concept);
    await this.treasury.postInTx(tx, ctx, {
      cashAccountId: bank.id,
      direction: 'OUT',
      amount: input.amount,
      operationDate: input.date,
      valueDate: input.paymentDate,
      concept: `${input.concept} · ${this.label(cheque)}`,
      paymentMethod: input.isEcheq ? 'OWN_ECHEQ' : 'OWN_CHEQUE',
      sourceDocType: input.source.type,
      sourceDocId: input.source.id,
    });
    return cheque;
  }

  /** Anulación de un cheque propio no debitado: el importe vuelve al banco con la misma fecha de valor. */
  async voidOwnInTx(tx: Tx, ctx: Ctx, chequeId: string, date: Date, concept: string, source: { type: string; id: string }) {
    const cheque = await this.lock(tx, chequeId);
    if (cheque.status !== 'ISSUED') {
      throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `El cheque propio ${this.label(cheque)} está ${CHEQUE_STATUS_LABELS[cheque.status].toLowerCase()}: no se puede anular.`);
    }
    await this.transition(tx, ctx, cheque, 'VOID', date, cheque.cashAccountId, concept);
    await this.treasury.postInTx(tx, ctx, {
      cashAccountId: cheque.cashAccountId!,
      direction: 'IN',
      amount: cheque.amount.toString(),
      operationDate: date,
      valueDate: cheque.paymentDate,
      concept: `${concept} · ${this.label(cheque)}`,
      paymentMethod: cheque.isEcheq ? 'OWN_ECHEQ' : 'OWN_CHEQUE',
      sourceDocType: source.type,
      sourceDocId: source.id,
    });
  }

  /** El banco debitó un cheque propio. Informativo: el egreso ya está registrado a su fecha de valor. */
  debit(ctx: RequestContext, id: string, input: ChequeDebitInput) {
    return this.uow.run(ctx, async (tx) => {
      const cheque = await this.lock(tx, id);
      await this.transition(tx, ctx, cheque, 'DEBIT', input.date ? asDate(input.date) : businessDate(), cheque.cashAccountId, 'Debitado');
      return this.detailInTx(tx, id);
    });
  }

  /** Devolución al cliente por anulación del cobro: solo si sigue en cartera. */
  async returnInTx(tx: Tx, ctx: Ctx, chequeId: string, date: Date, concept: string, source: { type: string; id: string }) {
    const cheque = await this.lock(tx, chequeId);
    if (cheque.status !== 'IN_PORTFOLIO') {
      throw new DomainError(
        ErrorCodes.TRANSICION_INVALIDA,
        `El cheque ${this.label(cheque)} está ${CHEQUE_STATUS_LABELS[cheque.status].toLowerCase()}: no se puede anular el cobro. Si fue rechazado, registralo desde Tesorería.`,
      );
    }
    const to = await this.transition(tx, ctx, cheque, 'RETURN', date, null, concept);
    await this.treasury.postInTx(tx, ctx, {
      cashAccountId: cheque.cashAccountId!,
      direction: 'OUT',
      amount: cheque.amount.toString(),
      operationDate: date,
      concept: `${concept} · ${this.label(cheque)}`,
      paymentMethod: cheque.isEcheq ? 'ECHEQ' : 'CHEQUE',
      sourceDocType: source.type,
      sourceDocId: source.id,
    });
    return to;
  }

  deposit(ctx: RequestContext, id: string, input: ChequeDepositInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const cheque = await this.lock(tx, id);
        const date = input.date ? asDate(input.date) : businessDate();
        const bank = await tx.cashAccount.findUnique({ where: { id: input.bankAccountId } });
        if (!bank || bank.type !== 'BANK') throw new DomainError(ErrorCodes.VALIDACION, 'Elegí la cuenta bancaria donde se deposita.');
        if (!bank.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `La cuenta ${bank.name} está inactiva.`);
        if (bank.currency !== cheque.currency) throw new DomainError(ErrorCodes.VALIDACION, `El cheque es en ${cheque.currency} y la cuenta en ${bank.currency}.`);
        chequeTransition(cheque.ownership, cheque.status, 'DEPOSIT');
        assertCanDeposit(cheque.paymentDate, date);
        const from = cheque.cashAccountId!;
        await this.transition(tx, ctx, cheque, 'DEPOSIT', date, bank.id, `Depositado en ${bank.name}`);
        await this.treasury.postInTx(tx, ctx, {
          cashAccountId: from,
          direction: 'OUT',
          amount: cheque.amount.toString(),
          operationDate: date,
          concept: `Depósito en ${bank.name} · ${this.label(cheque)}`,
          paymentMethod: 'CHEQUE',
          sourceDocType: 'CHEQUE',
          sourceDocId: cheque.id,
        });
        return this.detailInTx(tx, id);
      },
      { idempotent: true },
    );
  }

  /** El banco acreditó el depósito: recién ahí el importe suma al saldo del banco. */
  credit(ctx: RequestContext, id: string, input: ChequeCreditInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const cheque = await this.lock(tx, id);
        const date = input.date ? asDate(input.date) : businessDate();
        const bankId = cheque.cashAccountId!;
        await this.transition(tx, ctx, cheque, 'CREDIT', date, bankId, 'Acreditado');
        await this.treasury.postInTx(tx, ctx, {
          cashAccountId: bankId,
          direction: 'IN',
          amount: cheque.amount.toString(),
          operationDate: date,
          concept: `Acreditación · ${this.label(cheque)}`,
          paymentMethod: 'CHEQUE',
          sourceDocType: 'CHEQUE',
          sourceDocId: cheque.id,
        });
        return this.detailInTx(tx, id);
      },
      { idempotent: true },
    );
  }

  /**
   * Rechazo: el cheque sale de donde esté sin acreditar (cartera) y se debita al cliente el importe
   * más el gasto bancario, que vence en el día. Lo cobrado con ese cheque sigue imputado: la deuda
   * vuelve por el débito, que se cobra (o se reclama) como cualquier otro comprobante.
   */
  reject(ctx: RequestContext, id: string, input: ChequeRejectInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const cheque = await this.lock(tx, id);
        const date = input.date ? asDate(input.date) : businessDate();
        const fee = input.bankFee ? roundMoney(input.bankFee) : dec(0);
        if (fee.isNegative()) throw new DomainError(ErrorCodes.VALIDACION, 'El gasto bancario no puede ser negativo.');
        if (fee.gt(0) && cheque.status !== 'DEPOSITED') throw new DomainError(ErrorCodes.VALIDACION, 'El gasto bancario solo se registra si el cheque fue depositado.');
        const from = cheque.status;
        const accountId = cheque.cashAccountId;
        await this.transition(tx, ctx, cheque, 'REJECT', date, accountId, input.reason);
        if (from === 'IN_PORTFOLIO') {
          await this.treasury.postInTx(tx, ctx, {
            cashAccountId: accountId!,
            direction: 'OUT',
            amount: cheque.amount.toString(),
            operationDate: date,
            concept: `Rechazo · ${this.label(cheque)}`,
            paymentMethod: 'CHEQUE',
            sourceDocType: 'CHEQUE',
            sourceDocId: cheque.id,
          });
        }
        if (fee.gt(0)) {
          await this.treasury.postInTx(tx, ctx, {
            cashAccountId: accountId!,
            direction: 'OUT',
            amount: fee.toString(),
            operationDate: date,
            concept: `Gasto por rechazo · ${this.label(cheque)}`,
            sourceDocType: 'CHEQUE',
            sourceDocId: cheque.id,
          });
        }
        // Endosado: el proveedor lo devuelve y la deuda con él vuelve a existir.
        if (from === 'DELIVERED' && cheque.deliveredToId) {
          await this.accounts.post(tx, ctx, {
            partyId: cheque.deliveredToId,
            accountType: 'PAYABLE',
            entryType: 'CHEQUE_REJECTED',
            sourceDocType: 'CHEQUE',
            sourceDocId: cheque.id,
            description: `Cheque endosado rechazado ${this.label(cheque)}`,
            date,
            dueDate: date,
            amount: cheque.amount.toString(),
          });
        }
        if (cheque.receivedFromId) {
          await this.accounts.post(tx, ctx, {
            partyId: cheque.receivedFromId,
            accountType: 'RECEIVABLE',
            entryType: 'CHEQUE_REJECTED',
            sourceDocType: 'CHEQUE',
            sourceDocId: cheque.id,
            description: `Cheque rechazado ${this.label(cheque)}${fee.gt(0) ? ` + gastos $ ${fee.toFixed(2)}` : ''}`,
            date,
            dueDate: date,
            amount: roundMoney(cheque.amount.toString()).plus(fee).toString(),
          });
        }
        return this.detailInTx(tx, id);
      },
      { idempotent: true },
    );
  }

  list(ctx: RequestContext, q: ChequeQuery) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.ChequeWhereInput = { ...(q.ownership ? { ownership: q.ownership } : {}), ...(q.status ? { status: q.status } : {}) };
      const [rows, total, summary] = await Promise.all([
        tx.cheque.findMany({ where, orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { cashAccount: { select: { name: true } } } }),
        tx.cheque.count({ where }),
        tx.cheque.groupBy({ by: ['status'], where: q.ownership ? { ownership: q.ownership } : {}, _sum: { amount: true }, _count: true }),
      ]);
      const parties = await tx.party.findMany({
        where: { id: { in: rows.flatMap((r) => [r.receivedFromId, r.deliveredToId]).filter((x): x is string => !!x) } },
        select: { id: true, legalName: true },
      });
      return {
        total,
        summary: summary.map((s) => ({ status: s.status, label: CHEQUE_STATUS_LABELS[s.status], count: s._count, amount: (s._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) })),
        rows: rows.map((r) => ({
          ...r,
          amount: r.amount.toString(),
          statusLabel: CHEQUE_STATUS_LABELS[r.status],
          account: r.cashAccount?.name ?? null,
          cashAccount: undefined,
          receivedFrom: parties.find((p) => p.id === r.receivedFromId)?.legalName ?? null,
          deliveredTo: parties.find((p) => p.id === r.deliveredToId)?.legalName ?? null,
        })),
      };
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, id));
  }

  private async detailInTx(tx: Tx, id: string) {
    const c = await tx.cheque.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } }, cashAccount: { select: { name: true } }, receiptPayments: { include: { receipt: { select: { id: true, number: true } } } } } });
    if (!c) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El cheque no existe.', 404);
    const [party, deliveredTo] = await Promise.all([
      c.receivedFromId ? tx.party.findUnique({ where: { id: c.receivedFromId }, select: { id: true, legalName: true } }) : null,
      c.deliveredToId ? tx.party.findUnique({ where: { id: c.deliveredToId }, select: { id: true, legalName: true } }) : null,
    ]);
    const accounts = await tx.cashAccount.findMany({ where: { id: { in: c.events.map((e) => e.cashAccountId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return {
      ...c,
      amount: c.amount.toString(),
      statusLabel: CHEQUE_STATUS_LABELS[c.status],
      account: c.cashAccount?.name ?? null,
      cashAccount: undefined,
      receivedFrom: party,
      deliveredTo,
      receipt: c.receiptPayments[0]?.receipt ?? null,
      receiptPayments: undefined,
      events: c.events.map((e) => ({ ...e, toLabel: CHEQUE_STATUS_LABELS[e.toStatus], account: accounts.find((a) => a.id === e.cashAccountId)?.name ?? null })),
    };
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM cheques WHERE id = ${id}::uuid FOR UPDATE`;
    const cheque = await tx.cheque.findUnique({ where: { id } });
    if (!cheque) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El cheque no existe.', 404);
    return cheque;
  }

  private async transition(
    tx: Tx,
    ctx: Ctx,
    cheque: Cheque,
    event: ChequeEvent,
    date: Date,
    cashAccountId: string | null,
    notes: string | null,
    extra: Pick<Prisma.ChequeUncheckedUpdateInput, 'deliveredToId'> = {},
  ) {
    const to = chequeTransition(cheque.ownership, cheque.status, event);
    await tx.cheque.update({ where: { id: cheque.id }, data: { status: to, ...extra, ...(event === 'DEPOSIT' ? { cashAccountId } : {}) } });
    await this.event(tx, ctx, cheque, event, cheque.status, to, date, cashAccountId, notes);
    await this.audit.log(tx, ctx, { entity: 'cheque', entityId: cheque.id, action: event.toLowerCase(), diff: { from: cheque.status, to }, reason: notes ?? undefined });
    return to;
  }

  private event(tx: Tx, ctx: Ctx, cheque: Cheque, event: string, from: ChequeStatus | null, to: ChequeStatus, date: Date, cashAccountId: string | null, notes: string | null) {
    return tx.chequeEvent.create({
      data: { companyId: ctx.companyId, chequeId: cheque.id, event, fromStatus: from, toStatus: to, date, cashAccountId, notes, createdBy: ctx.userId },
    });
  }

  private label(c: Pick<Cheque, 'bank' | 'number' | 'isEcheq'>) {
    return `${c.isEcheq ? 'E-cheq' : 'Cheque'} ${c.bank} n.º ${c.number}`;
  }
}
