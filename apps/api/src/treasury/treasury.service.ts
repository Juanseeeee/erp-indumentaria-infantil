import { Injectable } from '@nestjs/common';
import { CashAccount, Prisma, TreasuryDirection } from '@prisma/client';
import { CashAccountCreateInput, TreasuryMovementCreateInput, TreasuryMovementQuery } from '@erp/contracts';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { accountTypesFor, assertAccountForMethod, assertCashAvailable, assertCashBoxOpen } from '@erp/domain-finance';
import type { Tx } from '../prisma/prisma.service';
import { businessDate } from '../common/dates';
import type { RequestContext } from '../common/context';
import { AuditService } from '../common/common.service';
import { UnitOfWork } from '../common/unit-of-work';

export function asDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

type Ctx = Pick<RequestContext, 'companyId' | 'userId'>;

export interface PostMovementInput {
  cashAccountId: string;
  direction: TreasuryDirection;
  amount: string;
  operationDate: Date;
  valueDate?: Date | null;
  concept: string;
  paymentMethod?: string | null;
  sourceDocType?: string | null;
  sourceDocId?: string | null;
  transferGroupId?: string | null;
}

export const PORTFOLIO_ACCOUNT_NAME = 'Cartera de cheques';

@Injectable()
export class TreasuryService {
  constructor(private readonly uow: UnitOfWork, private readonly audit: AuditService) {}

  /**
   * Registra un movimiento dentro de la transacción del documento que lo origina. En una caja,
   * bloquea la cuenta (los egresos concurrentes se serializan), respeta el último arqueo y no deja
   * sacar más efectivo del que hay.
   */
  async postInTx(tx: Tx, ctx: Ctx, input: PostMovementInput) {
    const account = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
    if (!account) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
    if (!account.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `La cuenta ${account.name} está inactiva.`);
    if (account.type === 'CASH_BOX') {
      await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${account.id}::uuid FOR UPDATE`;
      const last = await this.lastClosing(tx, account.id);
      assertCashBoxOpen(input.operationDate, last?.closingDate ?? null, account.name);
      if (input.direction === 'OUT') assertCashAvailable(await this.balanceInTx(tx, account.id), input.amount, account.name);
    }
    return tx.treasuryMovement.create({
      data: {
        companyId: ctx.companyId,
        cashAccountId: account.id,
        direction: input.direction,
        amount: input.amount,
        currency: account.currency,
        operationDate: input.operationDate,
        valueDate: input.valueDate ?? input.operationDate,
        concept: input.concept,
        paymentMethod: input.paymentMethod ?? null,
        sourceDocType: input.sourceDocType ?? null,
        sourceDocId: input.sourceDocId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        createdBy: ctx.userId,
      },
    });
  }

  /** Saldo por fecha de operación (todos los movimientos registrados). */
  async balanceInTx(tx: Tx, cashAccountId: string, until?: Date) {
    const rows = await tx.treasuryMovement.groupBy({
      by: ['direction'],
      where: { cashAccountId, ...(until ? { operationDate: { lte: until } } : {}) },
      _sum: { amount: true },
    });
    const sum = (d: TreasuryDirection) => new Prisma.Decimal(rows.find((r) => r.direction === d)?._sum.amount ?? 0);
    return sum('IN').minus(sum('OUT'));
  }

  lastClosing(tx: Tx, cashAccountId: string) {
    return tx.cashClosing.findFirst({ where: { cashAccountId }, orderBy: [{ closingDate: 'desc' }, { createdAt: 'desc' }] });
  }

  /** Cartera de cheques de la empresa; se crea la primera vez que entra un cheque. */
  async portfolioAccount(tx: Tx, ctx: Ctx): Promise<CashAccount> {
    const existing = await tx.cashAccount.findFirst({ where: { type: 'CHEQUE_PORTFOLIO', isActive: true }, orderBy: { createdAt: 'asc' } });
    if (existing) return existing;
    await tx.$executeRaw`INSERT INTO cash_accounts (id, company_id, type, name) VALUES (gen_random_uuid(), ${ctx.companyId}::uuid, 'CHEQUE_PORTFOLIO', ${PORTFOLIO_ACCOUNT_NAME}) ON CONFLICT (company_id, name) DO NOTHING`;
    const account = await tx.cashAccount.findFirst({ where: { type: 'CHEQUE_PORTFOLIO', isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!account) throw new DomainError(ErrorCodes.VALIDACION, `Existe una cuenta "${PORTFOLIO_ACCOUNT_NAME}" inactiva o de otro tipo: activala o renombrala.`);
    return account;
  }

  /**
   * Cuenta donde entra (o de donde sale) un medio de pago: la indicada, validando el tipo, o la primera
   * activa del tipo que corresponde. Devuelve null para medios que no mueven fondos (retenciones).
   */
  async accountForMethod(tx: Tx, method: string, cashAccountId?: string | null): Promise<CashAccount | null> {
    const types = accountTypesFor(method);
    if (!types.length) {
      if (cashAccountId) assertAccountForMethod(method, 'CASH_BOX');
      return null;
    }
    if (cashAccountId) {
      const account = await tx.cashAccount.findUnique({ where: { id: cashAccountId } });
      if (!account) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
      if (!account.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `La cuenta ${account.name} está inactiva.`);
      assertAccountForMethod(method, account.type);
      return account;
    }
    const candidates = await tx.cashAccount.findMany({ where: { type: { in: types }, isActive: true }, orderBy: { name: 'asc' } });
    const account = candidates.sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type))[0];
    if (!account) {
      const labels: Record<string, string> = { CASH_BOX: 'una caja', BANK: 'un banco', WALLET: 'una billetera', CARD_CLEARING: 'una cuenta de tarjetas a acreditar' };
      throw new DomainError(ErrorCodes.VALIDACION, `No hay ${types.map((t) => labels[t]).join(' ni ')} activa para registrar ese medio. Creala en Tesorería.`);
    }
    return account;
  }

  listAccounts(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const accounts = await tx.cashAccount.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
      if (!accounts.length) return [];
      const today = businessDate();
      const [byOperationDate, byValueDate] = await Promise.all([
        tx.treasuryMovement.groupBy({
          by: ['cashAccountId', 'direction'],
          where: { cashAccountId: { in: accounts.map((a) => a.id) }, operationDate: { lte: today } },
          _sum: { amount: true },
        }),
        tx.treasuryMovement.groupBy({
          by: ['cashAccountId', 'direction'],
          where: { cashAccountId: { in: accounts.map((a) => a.id) }, valueDate: { lte: today } },
          _sum: { amount: true },
        }),
      ]);
      const balance = (rows: typeof byOperationDate, accountId: string) =>
        rows
          .filter((r) => r.cashAccountId === accountId)
          .reduce((sum, r) => {
            const amount = new Prisma.Decimal(r._sum.amount ?? 0);
            return sum.plus(r.direction === 'IN' ? amount : amount.negated());
          }, new Prisma.Decimal(0))
          .toFixed(2);
      return accounts.map((account) => ({
        ...account,
        operationBalance: balance(byOperationDate, account.id),
        valueBalance: balance(byValueDate, account.id),
      }));
    });
  }

  createAccount(ctx: RequestContext, input: CashAccountCreateInput) {
    return this.uow.run(ctx, async (tx) => {
      const account = await tx.cashAccount.create({
        data: {
          companyId: ctx.companyId,
          name: input.name,
          type: input.type,
          currency: input.currency,
          bank: input.bank,
          accountReference: input.accountReference,
        },
      });
      await this.audit.log(tx, ctx, { entity: 'cash_account', entityId: account.id, action: 'create', diff: input });
      return { ...account, operationBalance: '0.00', valueBalance: '0.00' };
    });
  }

  listMovements(ctx: RequestContext, accountId: string, q: TreasuryMovementQuery) {
    return this.uow.run(ctx, async (tx) => {
      const account = await tx.cashAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
      const where: Prisma.TreasuryMovementWhereInput = {
        cashAccountId: accountId,
        ...(q.from || q.to
          ? {
              operationDate: {
                ...(q.from ? { gte: asDate(q.from) } : {}),
                ...(q.to ? { lte: asDate(q.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.treasuryMovement.findMany({
          where,
          orderBy: [{ operationDate: 'desc' }, { createdAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { statementLine: { select: { id: true } } },
        }),
        tx.treasuryMovement.count({ where }),
      ]);
      return { total, rows: rows.map(({ statementLine, ...m }) => ({ ...m, reconciled: !!statementLine })) };
    });
  }

  createMovement(ctx: RequestContext, accountId: string, input: TreasuryMovementCreateInput) {
    return this.uow.run(ctx, async (tx) => {
      const account = await tx.cashAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
      if (!account.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'No se pueden registrar movimientos en una cuenta inactiva.');
      const operationDate = input.operationDate ? asDate(input.operationDate) : businessDate();
      const movement = await this.postInTx(tx, ctx, {
        cashAccountId: account.id,
        direction: input.direction,
        amount: input.amount,
        operationDate,
        valueDate: input.valueDate ? asDate(input.valueDate) : operationDate,
        concept: input.concept,
        paymentMethod: input.paymentMethod,
      });
      await this.audit.log(tx, ctx, {
        entity: 'treasury_movement',
        entityId: movement.id,
        action: 'create',
        diff: { cashAccountId: account.id, direction: movement.direction, amount: movement.amount.toString() },
      });
      return movement;
    }, { idempotent: true });
  }
}
