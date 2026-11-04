import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PromotionUpsertInput } from '@erp/contracts';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { businessDate } from '../common/dates';

const asDate = (v: string) => new Date(`${v}T00:00:00.000Z`);

/** Estado de una promoción a hoy: vigente, programada, vencida o pausada. */
function statusOf(p: { isActive: boolean; validFrom: Date; validTo: Date | null }, today: Date) {
  if (!p.isActive) return 'PAUSED';
  if (p.validFrom > today) return 'SCHEDULED';
  if (p.validTo && p.validTo < today) return 'EXPIRED';
  return 'ACTIVE';
}

/**
 * Promociones (RF-VEN-08). Se aplican al armar el pedido (SalesOrdersService.buildLines); acá se
 * administran. Editar una promoción no cambia los pedidos ya armados: cada línea guarda su descuento.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const today = businessDate();
      const [promos, usage] = await Promise.all([
        tx.promotion.findMany({ orderBy: [{ validFrom: 'desc' }, { name: 'asc' }] }),
        // Uso en pedidos no anulados: unidades y descuento otorgado (neto de IVA).
        tx.$queryRaw<{ promotion_id: string; orders: bigint; units: string; discount: string }[]>`
          SELECT l.promotion_id, COUNT(DISTINCT l.order_id) AS orders, SUM(l.qty)::text AS units,
                 ROUND(SUM(l.qty * l.unit_price * l.discount_pct / 100), 2)::text AS discount
          FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
          WHERE l.promotion_id IS NOT NULL AND o.status <> 'CANCELLED'
          GROUP BY l.promotion_id`,
      ]);
      const names = await this.targetNames(tx, promos);
      return promos.map((p) => {
        const u = usage.find((x) => x.promotion_id === p.id);
        return {
          ...p,
          discountPct: p.discountPct.toString(),
          minQty: p.minQty.toString(),
          status: statusOf(p, today),
          targets: p.targetIds.map((id) => names.get(id) ?? '—'),
          customers: p.customerIds.map((id) => names.get(id) ?? '—'),
          priceLists: p.priceListIds.map((id) => names.get(id) ?? '—'),
          usage: { orders: Number(u?.orders ?? 0), units: new Prisma.Decimal(u?.units ?? 0).toString(), discount: u?.discount ?? '0.00' },
        };
      });
    });
  }

  /** Nombres de modelos, categorías, colecciones, clientes y listas, para mostrar sin otra consulta. */
  private async targetNames(tx: Tx, promos: { targetIds: string[]; customerIds: string[]; priceListIds: string[] }[]) {
    const ids = [...new Set(promos.flatMap((p) => [...p.targetIds, ...p.customerIds, ...p.priceListIds]))];
    if (!ids.length) return new Map<string, string>();
    const [products, categories, collections, parties, lists] = await Promise.all([
      tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }),
      tx.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      tx.collection.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      tx.party.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true } }),
      tx.priceList.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    return new Map<string, string>([
      ...products.map((p) => [p.id, `${p.code} · ${p.name}`] as const),
      ...categories.map((c) => [c.id, c.name] as const),
      ...collections.map((c) => [c.id, c.name] as const),
      ...parties.map((p) => [p.id, p.legalName] as const),
      ...lists.map((l) => [l.id, l.name] as const),
    ]);
  }

  private async validate(tx: Tx, input: PromotionUpsertInput, id?: string) {
    const dup = await tx.promotion.findFirst({ where: { name: input.name, ...(id ? { NOT: { id } } : {}) } });
    if (dup) throw new DomainError(ErrorCodes.DUPLICADO, 'Ya existe una promoción con ese nombre.', 409);
    const found =
      input.scope === 'PRODUCTS'
        ? await tx.product.count({ where: { id: { in: input.targetIds } } })
        : input.scope === 'CATEGORIES'
          ? await tx.category.count({ where: { id: { in: input.targetIds }, kind: 'PRODUCT' } })
          : input.scope === 'COLLECTIONS'
            ? await tx.collection.count({ where: { id: { in: input.targetIds } } })
            : 0;
    if (found !== new Set(input.targetIds).size) throw new DomainError(ErrorCodes.VALIDACION, 'Hay modelos, categorías o colecciones que no existen.');
    if (input.customerIds.length) {
      const customers = await tx.party.count({ where: { id: { in: input.customerIds }, roles: { some: { role: 'CUSTOMER' } } } });
      if (customers !== new Set(input.customerIds).size) throw new DomainError(ErrorCodes.VALIDACION, 'Hay clientes que no existen.');
    }
    if (input.priceListIds.length) {
      const lists = await tx.priceList.count({ where: { id: { in: input.priceListIds } } });
      if (lists !== new Set(input.priceListIds).size) throw new DomainError(ErrorCodes.VALIDACION, 'Hay listas de precios que no existen.');
    }
  }

  private data(input: PromotionUpsertInput) {
    return {
      name: input.name,
      discountPct: new Prisma.Decimal(input.discountPct),
      minQty: new Prisma.Decimal(input.minQty),
      scope: input.scope,
      targetIds: [...new Set(input.targetIds)],
      customerIds: [...new Set(input.customerIds)],
      priceListIds: [...new Set(input.priceListIds)],
      validFrom: asDate(input.validFrom),
      validTo: input.validTo ? asDate(input.validTo) : null,
      isActive: input.isActive,
      notes: input.notes,
    };
  }

  create(ctx: RequestContext, input: PromotionUpsertInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await this.validate(tx, input);
        const data = this.data(input);
        const p = await tx.promotion.create({ data: { companyId: ctx.companyId, ...data, createdBy: ctx.userId } });
        await this.audit.log(tx, ctx, { entity: 'promotion', entityId: p.id, action: 'create', diff: input });
        return p;
      },
      { idempotent: true },
    );
  }

  update(ctx: RequestContext, id: string, input: PromotionUpsertInput) {
    return this.uow.run(ctx, async (tx) => {
      const before = await tx.promotion.findUnique({ where: { id } });
      if (!before) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La promoción no existe.', 404);
      await this.validate(tx, input, id);
      const p = await tx.promotion.update({ where: { id }, data: { ...this.data(input), updatedAt: new Date() } });
      await this.audit.log(tx, ctx, {
        entity: 'promotion',
        entityId: id,
        action: 'update',
        diff: { before: { ...before, discountPct: before.discountPct.toString(), minQty: before.minQty.toString() }, after: input },
      });
      return p;
    });
  }
}
