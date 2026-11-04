import { Injectable } from '@nestjs/common';
import { AccountAllocation, AccountEntry } from '@prisma/client';
import { DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import { CommissionBase, commissionOnCollection, docKind } from '@erp/domain-sales';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService, readSetting } from '../common/common.service';
import { businessDate } from '../common/dates';

/**
 * Comisiones de vendedores. Regla confirmada por el cliente (29/10/2026): se calculan sobre lo cobrado.
 * Se devengan al imputar un cobro a una factura; una reversa de la imputación genera la comisión negativa.
 * Base configurable (`sales.commissionBase`: NET sin IVA, o TOTAL) hasta que el cliente lo defina.
 */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  /** Llamado por AllocationsService dentro de la misma transacción. */
  async onAllocation(tx: Tx, ctx: Pick<RequestContext, 'companyId'>, alloc: AccountAllocation, debit: AccountEntry, credit: AccountEntry, sign: 1 | -1) {
    if (debit.accountType !== 'RECEIVABLE' || credit.entryType !== 'RECEIPT' || debit.sourceDocType !== 'FISCAL_DOCUMENT') return null;
    const doc = await tx.fiscalDocument.findUnique({ where: { id: debit.sourceDocId } });
    if (!doc || doc.direction !== 'SALE' || docKind(doc.docType) !== 'F' || !doc.sellerUserId || !doc.commissionPct || dec(doc.commissionPct.toString()).isZero()) {
      return null;
    }
    const base = await readSetting<CommissionBase>(tx, ctx.companyId, 'sales.commissionBase', 'NET');
    const c = commissionOnCollection({
      allocated: dec(alloc.amount.toString()).times(sign),
      docTotal: doc.total.toString(),
      docNet: doc.netTotal.toString(),
      pct: doc.commissionPct.toString(),
      base,
    });
    return tx.salesCommission.create({
      data: {
        companyId: ctx.companyId,
        sellerUserId: doc.sellerUserId,
        documentId: doc.id,
        allocationId: alloc.id,
        collectedAt: businessDate(),
        baseAmount: c.base.toString(),
        pct: doc.commissionPct.toString(),
        amount: c.amount.toString(),
      },
    });
  }

  /** % vigente del vendedor (0 si no está configurado). */
  async currentPct(tx: Tx, companyId: string, sellerUserId: string | null) {
    if (!sellerUserId) return null;
    const rep = await tx.salesRep.findUnique({ where: { companyId_userId: { companyId, userId: sellerUserId } } });
    return rep?.isActive ? rep.commissionPct.toString() : null;
  }

  reps(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const [reps, members] = await Promise.all([
        tx.salesRep.findMany(),
        tx.companyUser.findMany({ where: { isActive: true }, include: { user: { select: { id: true, name: true, email: true } } } }),
      ]);
      return members.map((m) => {
        const r = reps.find((x) => x.userId === m.userId);
        return { userId: m.userId, name: m.user.name, email: m.user.email, isRep: !!r, commissionPct: r?.commissionPct.toString() ?? null, isActive: r?.isActive ?? false };
      });
    });
  }

  sellers(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const reps = await tx.salesRep.findMany({ where: { isActive: true } });
      const users = await tx.user.findMany({ where: { id: { in: reps.map((r) => r.userId) } }, select: { id: true, name: true } });
      return users.map((u) => ({ userId: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  upsertRep(ctx: RequestContext, input: { userId: string; commissionPct: string; isActive: boolean }) {
    return this.uow.run(ctx, async (tx) => {
      const member = await tx.companyUser.findFirst({ where: { userId: input.userId } });
      if (!member) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El usuario no pertenece a la empresa.', 404);
      const before = await tx.salesRep.findUnique({ where: { companyId_userId: { companyId: ctx.companyId, userId: input.userId } } });
      const rep = await tx.salesRep.upsert({
        where: { companyId_userId: { companyId: ctx.companyId, userId: input.userId } },
        create: { companyId: ctx.companyId, userId: input.userId, commissionPct: input.commissionPct, isActive: input.isActive },
        update: { commissionPct: input.commissionPct, isActive: input.isActive },
      });
      await this.audit.log(tx, ctx, {
        entity: 'sales_rep',
        entityId: input.userId,
        action: before ? 'update' : 'create',
        diff: { commissionPct: { from: before?.commissionPct.toString() ?? null, to: input.commissionPct }, isActive: input.isActive },
      });
      return { ...rep, commissionPct: rep.commissionPct.toString() };
    });
  }

  /** Comisiones devengadas (pendientes de liquidar si `pending`). `sellerUserId` restringe a un vendedor. */
  list(ctx: RequestContext, q: { sellerUserId?: string; pending?: boolean }) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.salesCommission.findMany({
        where: { ...(q.sellerUserId ? { sellerUserId: q.sellerUserId } : {}), ...(q.pending ? { settlementId: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      const [docs, users, settlements] = await Promise.all([
        tx.fiscalDocument.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.documentId))] } }, select: { id: true, docType: true, pointOfSale: true, number: true, partyId: true } }),
        tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sellerUserId))] } }, select: { id: true, name: true } }),
        tx.commissionSettlement.findMany({ where: { id: { in: rows.map((r) => r.settlementId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
      ]);
      const parties = await tx.party.findMany({ where: { id: { in: docs.map((d) => d.partyId) } }, select: { id: true, legalName: true } });
      const summary = new Map<string, { sellerUserId: string; name: string; pending: string }>();
      for (const r of rows.filter((x) => !x.settlementId)) {
        const cur = summary.get(r.sellerUserId) ?? { sellerUserId: r.sellerUserId, name: users.find((u) => u.id === r.sellerUserId)?.name ?? '', pending: '0' };
        cur.pending = roundMoney(dec(cur.pending).plus(r.amount.toString())).toString();
        summary.set(r.sellerUserId, cur);
      }
      return {
        summary: [...summary.values()],
        rows: rows.map((r) => {
          const d = docs.find((x) => x.id === r.documentId);
          return {
            ...r,
            baseAmount: r.baseAmount.toString(),
            pct: r.pct.toString(),
            amount: r.amount.toString(),
            seller: users.find((u) => u.id === r.sellerUserId)?.name,
            document: d ? { ...d, party: parties.find((p) => p.id === d.partyId)?.legalName } : null,
            settlement: settlements.find((s) => s.id === r.settlementId)?.number ?? null,
          };
        }),
      };
    });
  }

  /** Liquida lo devengado hasta la fecha (incluidas las reversas). El pago se registra en sueldos, fuera del sistema. */
  settle(ctx: RequestContext, input: { sellerUserId: string; periodTo: Date; notes: string | null }) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'commission:' + input.sellerUserId}))`;
        const pending = await tx.salesCommission.findMany({ where: { sellerUserId: input.sellerUserId, settlementId: null, collectedAt: { lte: input.periodTo } } });
        if (!pending.length) throw new DomainError(ErrorCodes.VALIDACION, 'No hay comisiones pendientes hasta esa fecha.');
        const total = roundMoney(pending.reduce((a, r) => a.plus(r.amount.toString()), dec(0)));
        const number = `LC-${await this.numbering.next(tx, ctx.companyId, 'COMMISSION_SETTLEMENT', '', 6)}`;
        const s = await tx.commissionSettlement.create({
          data: { companyId: ctx.companyId, number, sellerUserId: input.sellerUserId, periodTo: input.periodTo, total: total.toString(), notes: input.notes, createdBy: ctx.userId },
        });
        await tx.salesCommission.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { settlementId: s.id } });
        await this.audit.log(tx, ctx, { entity: 'commission_settlement', entityId: s.id, action: 'create', diff: { number, total: total.toString(), count: pending.length } });
        return { ...s, total: s.total.toString(), count: pending.length };
      },
      { idempotent: true },
    );
  }
}
