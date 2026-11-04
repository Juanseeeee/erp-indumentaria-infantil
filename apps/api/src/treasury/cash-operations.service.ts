import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashClosingCreateInput, DateRangeQuery, TreasuryTransferCreateInput } from '@erp/contracts';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { assertTransfer, cashClosing } from '@erp/domain-finance';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { businessDate } from '../common/dates';
import { TreasuryService, asDate } from './treasury.service';

const dateRange = (q: DateRangeQuery) =>
  q.from || q.to ? { ...(q.from ? { gte: asDate(q.from) } : {}), ...(q.to ? { lte: asDate(q.to) } : {}) } : undefined;

/**
 * Operaciones entre cuentas propias: transferencias (con comisión opcional) y arqueos de caja.
 * Todo pasa por movimientos de tesorería append-only; anular es registrar el contramovimiento.
 */
@Injectable()
export class CashOperationsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly treasury: TreasuryService,
  ) {}

  // ─── Transferencias ───

  createTransfer(ctx: RequestContext, input: TreasuryTransferCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const [from, to] = await Promise.all([
          tx.cashAccount.findUnique({ where: { id: input.fromAccountId } }),
          tx.cashAccount.findUnique({ where: { id: input.toAccountId } }),
        ]);
        if (!from || !to) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
        const { amount, fee, received } = assertTransfer(from, to, input.amount, input.fee ?? 0);
        const date = input.date ? asDate(input.date) : businessDate();
        const valueDate = input.valueDate ? asDate(input.valueDate) : date;
        if (valueDate < date) throw new DomainError(ErrorCodes.VALIDACION, 'La fecha de valor no puede ser anterior a la de la transferencia.');
        const number = `TR-${await this.numbering.next(tx, ctx.companyId, 'TREASURY_TRANSFER', '', 8)}`;
        const transfer = await tx.treasuryTransfer.create({
          data: {
            companyId: ctx.companyId,
            number,
            date,
            valueDate,
            fromAccountId: from.id,
            toAccountId: to.id,
            amount: amount.toString(),
            fee: fee.toString(),
            concept: input.concept,
            createdBy: ctx.userId,
          },
        });
        const concept = `Transferencia ${number}${input.concept ? ` · ${input.concept}` : ''}`;
        const common = { operationDate: date, paymentMethod: 'TRANSFER', sourceDocType: 'TREASURY_TRANSFER', sourceDocId: transfer.id, transferGroupId: transfer.id };
        // La salida va primero: si es una caja sin efectivo suficiente, falla antes de acreditar nada.
        await this.treasury.postInTx(tx, ctx, { ...common, cashAccountId: from.id, direction: 'OUT', amount: received.toString(), concept: `${concept} → ${to.name}` });
        if (fee.gt(0)) {
          await this.treasury.postInTx(tx, ctx, { ...common, cashAccountId: from.id, direction: 'OUT', amount: fee.toString(), concept: `Comisión ${number}` });
        }
        await this.treasury.postInTx(tx, ctx, { ...common, cashAccountId: to.id, direction: 'IN', amount: received.toString(), valueDate, concept: `${concept} ← ${from.name}` });
        await this.audit.log(tx, ctx, { entity: 'treasury_transfer', entityId: transfer.id, action: 'create', diff: { number, amount: amount.toString(), fee: fee.toString() } });
        return this.transferDetail(tx, transfer.id);
      },
      { idempotent: true },
    );
  }

  voidTransfer(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      await tx.$queryRaw`SELECT id FROM treasury_transfers WHERE id = ${id}::uuid FOR UPDATE`;
      const transfer = await tx.treasuryTransfer.findUnique({ where: { id } });
      if (!transfer) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La transferencia no existe.', 404);
      if (transfer.status === 'VOIDED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La transferencia ya está anulada.');
      const movements = await tx.treasuryMovement.findMany({ where: { transferGroupId: id, sourceDocType: 'TREASURY_TRANSFER' } });
      const today = businessDate();
      // Primero se revierten las entradas: el dinero tiene que seguir en el destino para devolverlo.
      for (const m of [...movements].sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'IN' ? -1 : 1))) {
        await this.treasury.postInTx(tx, ctx, {
          cashAccountId: m.cashAccountId,
          direction: m.direction === 'IN' ? 'OUT' : 'IN',
          amount: m.amount.toString(),
          operationDate: today,
          concept: `Anulación ${transfer.number}: ${reason}`,
          paymentMethod: m.paymentMethod,
          sourceDocType: 'TREASURY_TRANSFER_VOID',
          sourceDocId: id,
          transferGroupId: id,
        });
      }
      await tx.treasuryTransfer.update({ where: { id }, data: { status: 'VOIDED' } });
      await this.audit.log(tx, ctx, { entity: 'treasury_transfer', entityId: id, action: 'void', reason });
      return this.transferDetail(tx, id);
    });
  }

  listTransfers(ctx: RequestContext, q: DateRangeQuery) {
    return this.uow.run(ctx, async (tx) => {
      const date = dateRange(q);
      const where: Prisma.TreasuryTransferWhereInput = date ? { date } : {};
      const [rows, total] = await Promise.all([
        tx.treasuryTransfer.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
        }),
        tx.treasuryTransfer.count({ where }),
      ]);
      return { total, rows: rows.map((r) => this.serializeTransfer(r)) };
    });
  }

  private async transferDetail(tx: Tx, id: string) {
    const t = await tx.treasuryTransfer.findUniqueOrThrow({
      where: { id },
      include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
    });
    return this.serializeTransfer(t);
  }

  private serializeTransfer({ fromAccount, toAccount, ...t }: Prisma.TreasuryTransferGetPayload<{ include: { fromAccount: { select: { name: true } }; toAccount: { select: { name: true } } } }>) {
    return { ...t, amount: t.amount.toString(), fee: t.fee.toString(), received: t.amount.minus(t.fee).toString(), from: fromAccount.name, to: toAccount.name };
  }

  // ─── Arqueos ───

  /** Lo que el sistema espera encontrar en la caja a una fecha, con lo movido desde el último arqueo. */
  closingPreview(ctx: RequestContext, cashAccountId: string, date?: string) {
    return this.uow.run(ctx, (tx) => this.previewInTx(tx, cashAccountId, date ? asDate(date) : businessDate()));
  }

  private async previewInTx(tx: Tx, cashAccountId: string, date: Date) {
    const account = await tx.cashAccount.findUnique({ where: { id: cashAccountId } });
    if (!account) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
    if (account.type !== 'CASH_BOX') throw new DomainError(ErrorCodes.VALIDACION, 'El arqueo se hace sobre una caja.');
    const last = await this.treasury.lastClosing(tx, account.id);
    const since = await tx.treasuryMovement.groupBy({
      by: ['direction'],
      // Desde el último arqueo: lo fechado después o lo registrado después en su mismo día (p. ej., el ajuste no entra).
      where: {
        cashAccountId: account.id,
        operationDate: { lte: date },
        ...(last ? { OR: [{ operationDate: { gt: last.closingDate } }, { operationDate: last.closingDate, createdAt: { gt: last.createdAt } }] } : {}),
      },
      _sum: { amount: true },
      _count: true,
    });
    const of = (d: 'IN' | 'OUT') => since.find((r) => r.direction === d);
    return {
      account: { id: account.id, name: account.name, isActive: account.isActive },
      date,
      expected: (await this.treasury.balanceInTx(tx, account.id, date)).toFixed(2),
      lastClosing: last ? { closingDate: last.closingDate, counted: last.counted.toString(), difference: last.difference.toString() } : null,
      incomeSinceLast: new Prisma.Decimal(of('IN')?._sum.amount ?? 0).toFixed(2),
      outcomeSinceLast: new Prisma.Decimal(of('OUT')?._sum.amount ?? 0).toFixed(2),
      movementsSinceLast: (of('IN')?._count ?? 0) + (of('OUT')?._count ?? 0),
    };
  }

  createClosing(ctx: RequestContext, input: CashClosingCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${input.cashAccountId}::uuid FOR UPDATE`;
        const date = input.date ? asDate(input.date) : businessDate();
        if (date > businessDate()) throw new DomainError(ErrorCodes.VALIDACION, 'No se puede arquear una fecha futura.');
        const preview = await this.previewInTx(tx, input.cashAccountId, date);
        if (!preview.account.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `La caja ${preview.account.name} está inactiva.`);
        if (preview.lastClosing && date < preview.lastClosing.closingDate) {
          throw new DomainError(ErrorCodes.VALIDACION, 'Ya hay un arqueo posterior a esa fecha.');
        }
        const { expected, counted, difference } = cashClosing(preview.expected, input.counted);
        let adjustmentMovementId: string | null = null;
        if (!difference.isZero()) {
          const surplus = difference.gt(0);
          const movement = await this.treasury.postInTx(tx, ctx, {
            cashAccountId: input.cashAccountId,
            direction: surplus ? 'IN' : 'OUT',
            amount: difference.abs().toString(),
            operationDate: date,
            concept: `${surplus ? 'Sobrante' : 'Faltante'} de arqueo${input.notes ? ` · ${input.notes}` : ''}`,
            paymentMethod: 'CASH',
            sourceDocType: 'CASH_CLOSING',
          });
          adjustmentMovementId = movement.id;
        }
        const closing = await tx.cashClosing.create({
          data: {
            companyId: ctx.companyId,
            cashAccountId: input.cashAccountId,
            closingDate: date,
            expected: expected.toString(),
            counted: counted.toString(),
            difference: difference.toString(),
            notes: input.notes,
            adjustmentMovementId,
            createdBy: ctx.userId,
          },
        });
        await this.audit.log(tx, ctx, {
          entity: 'cash_closing',
          entityId: closing.id,
          action: 'create',
          diff: { expected: expected.toString(), counted: counted.toString(), difference: difference.toString() },
        });
        return { ...closing, expected: closing.expected.toString(), counted: closing.counted.toString(), difference: closing.difference.toString(), account: preview.account.name };
      },
      { idempotent: true },
    );
  }

  listClosings(ctx: RequestContext, q: DateRangeQuery & { cashAccountId?: string }) {
    return this.uow.run(ctx, async (tx) => {
      const closingDate = dateRange(q);
      const where: Prisma.CashClosingWhereInput = { ...(q.cashAccountId ? { cashAccountId: q.cashAccountId } : {}), ...(closingDate ? { closingDate } : {}) };
      const [rows, total] = await Promise.all([
        tx.cashClosing.findMany({
          where,
          orderBy: [{ closingDate: 'desc' }, { createdAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { cashAccount: { select: { name: true } } },
        }),
        tx.cashClosing.count({ where }),
      ]);
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } }, select: { id: true, name: true } });
      return {
        total,
        rows: rows.map(({ cashAccount, ...r }) => ({
          ...r,
          expected: r.expected.toString(),
          counted: r.counted.toString(),
          difference: r.difference.toString(),
          account: cashAccount.name,
          closedBy: users.find((u) => u.id === r.createdBy)?.name ?? null,
        })),
      };
    });
  }
}
