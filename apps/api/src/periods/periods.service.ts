import { Injectable } from '@nestjs/common';
import { PeriodCloseInput, PeriodReopenInput } from '@erp/contracts';
import { assertPeriodMove } from '@erp/domain-finance';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { businessDate } from '../common/dates';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (v: string) => new Date(`${v}T00:00:00.000Z`);

/**
 * Cierre de período. La fecha vive en la empresa y la hacen cumplir triggers sobre las tablas donde
 * terminan todos los documentos (ver migración period_lock). Cerrar avanza la fecha; reabrir la
 * retrocede con motivo. Todo queda en un historial inmutable.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  status(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { lockedUntil: true } });
      const history = await tx.periodLock.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(history.map((h) => h.createdBy))] } }, select: { id: true, name: true } });
      return {
        lockedUntil: iso(company.lockedUntil),
        today: iso(businessDate()),
        history: history.map((h) => ({
          id: h.id,
          action: h.action,
          previousUntil: iso(h.previousUntil),
          lockedUntil: iso(h.lockedUntil),
          notes: h.notes,
          createdAt: h.createdAt,
          by: users.find((u) => u.id === h.createdBy)?.name ?? null,
        })),
      };
    });
  }

  /** Lo que conviene resolver antes de cerrar hasta esa fecha. Informativo: no impide cerrar. */
  checklist(ctx: RequestContext, until: string) {
    return this.uow.run(ctx, async (tx) => {
      const limit = asDate(until);
      const [pendingLines, ownCheques, boxes] = await Promise.all([
        tx.bankStatementLine.count({ where: { status: 'PENDING', date: { lte: limit } } }),
        tx.cheque.count({ where: { ownership: 'OWN', status: 'ISSUED', paymentDate: { lte: limit } } }),
        tx.cashAccount.findMany({ where: { type: 'CASH_BOX', isActive: true } }),
      ]);
      const boxesWithoutClosing: string[] = [];
      for (const box of boxes) {
        const last = await tx.cashClosing.findFirst({ where: { cashAccountId: box.id }, orderBy: { closingDate: 'desc' } });
        if (last && last.closingDate >= limit) continue;
        const moved = await tx.treasuryMovement.count({
          where: { cashAccountId: box.id, operationDate: { lte: limit, ...(last ? { gt: last.closingDate } : {}) } },
        });
        if (moved) boxesWithoutClosing.push(box.name);
      }
      return {
        until,
        checks: [
          { key: 'statements', ok: pendingLines === 0, label: 'Extractos conciliados', detail: pendingLines ? `${pendingLines} líneas de extracto sin conciliar` : 'Sin líneas pendientes' },
          { key: 'cash', ok: boxesWithoutClosing.length === 0, label: 'Cajas arqueadas al cierre', detail: boxesWithoutClosing.length ? `Sin arqueo: ${boxesWithoutClosing.join(', ')}` : 'Todas las cajas con arqueo' },
          { key: 'cheques', ok: ownCheques === 0, label: 'Cheques propios vencidos debitados', detail: ownCheques ? `${ownCheques} cheques propios vencidos sin marcar como debitados` : 'Sin pendientes' },
        ],
      };
    });
  }

  close(ctx: RequestContext, input: PeriodCloseInput) {
    return this.uow.run(ctx, async (tx) => {
      const current = await this.lockCompany(tx, ctx.companyId);
      assertPeriodMove('CLOSE', current, input.until, iso(businessDate())!);
      await this.move(tx, ctx, 'CLOSE', current, input.until, input.notes ?? null);
      return this.statusInTx(tx, ctx);
    });
  }

  reopen(ctx: RequestContext, input: PeriodReopenInput) {
    return this.uow.run(ctx, async (tx) => {
      const current = await this.lockCompany(tx, ctx.companyId);
      const next = input.until ?? null;
      assertPeriodMove('REOPEN', current, next, iso(businessDate())!);
      await this.move(tx, ctx, 'REOPEN', current, next, input.reason);
      return this.statusInTx(tx, ctx);
    });
  }

  /** Serializa cierres y reaperturas concurrentes de la misma empresa. */
  private async lockCompany(tx: Tx, companyId: string) {
    const rows = await tx.$queryRaw<{ locked_until: Date | null }[]>`SELECT locked_until FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
    return iso(rows[0]?.locked_until);
  }

  private async move(tx: Tx, ctx: RequestContext, action: 'CLOSE' | 'REOPEN', previous: string | null, next: string | null, notes: string | null) {
    await tx.company.update({ where: { id: ctx.companyId }, data: { lockedUntil: next ? asDate(next) : null } });
    const lock = await tx.periodLock.create({
      data: { companyId: ctx.companyId, action, previousUntil: previous ? asDate(previous) : null, lockedUntil: next ? asDate(next) : null, notes, createdBy: ctx.userId },
    });
    await this.audit.log(tx, ctx, { entity: 'period_lock', entityId: lock.id, action: action.toLowerCase(), diff: { from: previous, to: next }, reason: action === 'REOPEN' ? (notes ?? undefined) : undefined });
  }

  private async statusInTx(tx: Tx, ctx: RequestContext) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { lockedUntil: true } });
    return { lockedUntil: iso(company.lockedUntil) };
  }
}
