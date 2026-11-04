import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PriceListPrice } from '@prisma/client';
import { PriceBulkUpdateInput, PriceListUpsertInput, PriceSetInput } from '@erp/contracts';
import { Dec, DomainError, ErrorCodes, dec } from '@erp/domain-core';
import { adjustPrice, derivedPrice } from '@erp/domain-sales';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { businessDate } from '../common/dates';

export interface ResolvedPrice {
  /** Precio de lista (con o sin IVA según la lista). */
  price: Dec;
  includesVat: boolean;
  source: 'VARIANT' | 'PRODUCT';
}

/**
 * Listas de precios. Precio por modelo con excepción por variante; cada cambio es una fila nueva
 * (historial completo). Las listas derivadas calculan su precio desde la base al momento de usarlo.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  private async getList(tx: Tx, id: string) {
    const l = await tx.priceList.findUnique({ where: { id } });
    if (!l) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La lista de precios no existe.', 404);
    return l;
  }

  /** Último precio vigente por clave (modelo o variante) a la fecha. */
  private latest(rows: PriceListPrice[]) {
    const byKey = new Map<string, PriceListPrice>();
    for (const r of [...rows].sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime())) {
      const key = r.itemId ? `i:${r.itemId}` : `p:${r.productId}`;
      if (!byKey.has(key)) byKey.set(key, r);
    }
    return byKey;
  }

  /**
   * Precio de lista de cada variante. Variante con precio propio > precio del modelo.
   * Lista derivada: precio de la base × (1 + %). Las variantes sin precio no aparecen en el resultado.
   */
  async resolve(tx: Tx, priceListId: string, itemIds: string[], at: Date = businessDate(), depth = 0): Promise<Map<string, ResolvedPrice>> {
    const list = await this.getList(tx, priceListId);
    if (list.baseListId) {
      if (depth > 3) throw new DomainError(ErrorCodes.VALIDACION, 'Las listas derivadas forman un ciclo.');
      const base = await this.resolve(tx, list.baseListId, itemIds, at, depth + 1);
      return new Map([...base].map(([k, v]) => [k, { ...v, includesVat: list.includesVat, price: derivedPrice(v.price, list.markupPct!.toString()) }]));
    }
    const variants = await tx.productVariant.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, productId: true } });
    const rows = await tx.priceListPrice.findMany({
      where: {
        priceListId,
        validFrom: { lte: at },
        OR: [{ itemId: { in: itemIds } }, { productId: { in: [...new Set(variants.map((v) => v.productId))] } }],
      },
    });
    const latest = this.latest(rows);
    const out = new Map<string, ResolvedPrice>();
    for (const v of variants) {
      const own = latest.get(`i:${v.itemId}`);
      const model = latest.get(`p:${v.productId}`);
      const hit = own ?? model;
      if (hit) out.set(v.itemId, { price: dec(hit.price.toString()), includesVat: list.includesVat, source: own ? 'VARIANT' : 'PRODUCT' });
    }
    return out;
  }

  lists(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const lists = await tx.priceList.findMany({ orderBy: { name: 'asc' } });
      const counts = await tx.customerProfile.groupBy({ by: ['priceListId'], _count: true });
      return lists.map((l) => ({
        ...l,
        markupPct: l.markupPct?.toString() ?? null,
        baseList: lists.find((x) => x.id === l.baseListId)?.name ?? null,
        customers: counts.find((c) => c.priceListId === l.id)?._count ?? 0,
      }));
    });
  }

  upsertList(ctx: RequestContext, input: PriceListUpsertInput, id?: string) {
    return this.uow.run(ctx, async (tx) => {
      if (input.baseListId) {
        const base = await this.getList(tx, input.baseListId);
        if (base.baseListId) throw new DomainError(ErrorCodes.VALIDACION, 'La lista base no puede ser derivada: elegí una lista con precios propios.');
        if (base.id === id) throw new DomainError(ErrorCodes.VALIDACION, 'Una lista no puede derivar de sí misma.');
      }
      const dup = await tx.priceList.findFirst({ where: { name: input.name, ...(id ? { NOT: { id } } : {}) } });
      if (dup) throw new DomainError(ErrorCodes.DUPLICADO, 'Ya existe una lista con ese nombre.', 409);
      const data = {
        name: input.name,
        kind: input.kind,
        includesVat: input.includesVat,
        baseListId: input.baseListId ?? null,
        markupPct: input.baseListId ? input.markupPct : null,
        isActive: input.isActive,
      };
      if (id) {
        const before = await this.getList(tx, id);
        if (before.baseListId === null && input.baseListId) {
          const own = await tx.priceListPrice.count({ where: { priceListId: id } });
          if (own) throw new DomainError(ErrorCodes.VALIDACION, 'La lista ya tiene precios propios: no puede pasar a ser derivada.');
        }
        const l = await tx.priceList.update({ where: { id }, data });
        await this.audit.log(tx, ctx, { entity: 'price_list', entityId: id, action: 'update', diff: data });
        return l;
      }
      const l = await tx.priceList.create({ data: { companyId: ctx.companyId, ...data } });
      await this.audit.log(tx, ctx, { entity: 'price_list', entityId: l.id, action: 'create', diff: data });
      return l;
    });
  }

  /** Precios vigentes de la lista por modelo (con sus excepciones por variante). */
  prices(ctx: RequestContext, priceListId: string) {
    return this.uow.run(ctx, async (tx) => {
      const list = await this.getList(tx, priceListId);
      const sourceId = list.baseListId ?? list.id;
      const today = businessDate();
      const [products, rows, future] = await Promise.all([
        tx.product.findMany({ where: { status: { not: 'DISCONTINUED' } }, orderBy: { code: 'asc' }, include: { variants: { include: { item: { select: { id: true, sku: true, name: true } } } } } }),
        tx.priceListPrice.findMany({ where: { priceListId: sourceId, validFrom: { lte: today } } }),
        tx.priceListPrice.findMany({ where: { priceListId: sourceId, validFrom: { gt: today } }, orderBy: { validFrom: 'asc' } }),
      ]);
      const latest = this.latest(rows);
      const adj = (p: string) => (list.baseListId ? derivedPrice(p, list.markupPct!.toString()).toString() : p);
      return {
        list: { ...list, markupPct: list.markupPct?.toString() ?? null },
        rows: products.map((p) => {
          const own = latest.get(`p:${p.id}`);
          const next = future.find((f) => f.productId === p.id);
          return {
            productId: p.id,
            code: p.code,
            name: p.name,
            status: p.status,
            price: own ? adj(own.price.toString()) : null,
            validFrom: own?.validFrom ?? null,
            scheduled: next ? { price: adj(next.price.toString()), validFrom: next.validFrom } : null,
            variants: p.variants
              .map((v) => ({ itemId: v.itemId, sku: v.item.sku, override: latest.get(`i:${v.itemId}`) }))
              .filter((v) => v.override)
              .map((v) => ({ itemId: v.itemId, sku: v.sku, price: adj(v.override!.price.toString()) })),
          };
        }),
      };
    });
  }

  private async assertOwnPrices(tx: Tx, priceListId: string) {
    const list = await this.getList(tx, priceListId);
    if (list.baseListId) throw new DomainError(ErrorCodes.VALIDACION, 'Es una lista derivada: sus precios salen de la lista base. Cambiá la base o el porcentaje.');
    return list;
  }

  setPrices(ctx: RequestContext, priceListId: string, input: PriceSetInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await this.assertOwnPrices(tx, priceListId);
        const validFrom = input.validFrom ?? businessDate();
        const batchId = randomUUID();
        await tx.priceListPrice.createMany({
          data: input.prices.map((p) => ({
            companyId: ctx.companyId,
            priceListId,
            productId: p.productId ?? null,
            itemId: p.itemId ?? null,
            price: p.price,
            validFrom,
            batchId,
            createdBy: ctx.userId,
          })),
        });
        await this.audit.log(tx, ctx, { entity: 'price_list', entityId: priceListId, action: 'set_prices', diff: { count: input.prices.length, validFrom, batchId } });
        return { count: input.prices.length, batchId };
      },
      { idempotent: true },
    );
  }

  /** Aumento o rebaja por porcentaje sobre los precios vigentes (modelos y excepciones), con redondeo opcional. */
  bulkUpdate(ctx: RequestContext, priceListId: string, input: PriceBulkUpdateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await this.assertOwnPrices(tx, priceListId);
        const validFrom = input.validFrom ?? businessDate();
        const rows = await tx.priceListPrice.findMany({ where: { priceListId, validFrom: { lte: validFrom } } });
        let targets = [...this.latest(rows).values()];
        if (input.productIds?.length) {
          const variants = await tx.productVariant.findMany({ where: { productId: { in: input.productIds } }, select: { itemId: true } });
          const items = new Set(variants.map((v) => v.itemId));
          targets = targets.filter((t) => (t.productId && input.productIds!.includes(t.productId)) || (t.itemId && items.has(t.itemId)));
        }
        if (!targets.length) throw new DomainError(ErrorCodes.VALIDACION, 'No hay precios cargados para actualizar.');
        const batchId = randomUUID();
        await tx.priceListPrice.createMany({
          data: targets.map((t) => ({
            companyId: ctx.companyId,
            priceListId,
            productId: t.productId,
            itemId: t.itemId,
            price: adjustPrice(t.price.toString(), input.pct, input.roundTo).toString(),
            validFrom,
            batchId,
            createdBy: ctx.userId,
          })),
        });
        await this.audit.log(tx, ctx, {
          entity: 'price_list',
          entityId: priceListId,
          action: 'bulk_update',
          diff: { pct: input.pct, roundTo: input.roundTo ?? null, count: targets.length, validFrom, batchId },
        });
        return { count: targets.length, batchId };
      },
      { idempotent: true },
    );
  }

  history(ctx: RequestContext, priceListId: string, productId: string) {
    return this.uow.run(ctx, async (tx) => {
      const variants = await tx.productVariant.findMany({ where: { productId }, include: { item: { select: { sku: true } } } });
      const rows = await tx.priceListPrice.findMany({
        where: { priceListId, OR: [{ productId }, { itemId: { in: variants.map((v) => v.itemId) } }] },
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } }, select: { id: true, name: true } });
      return rows.map((r) => ({
        ...r,
        price: r.price.toString(),
        sku: r.itemId ? variants.find((v) => v.itemId === r.itemId)?.item.sku : null,
        user: users.find((u) => u.id === r.createdBy)?.name,
      }));
    });
  }

  /** Precios para cargar un pedido: por variante del modelo, según la lista. */
  forProduct(ctx: RequestContext, priceListId: string, productId: string) {
    return this.uow.run(ctx, async (tx) => {
      const variants = await tx.productVariant.findMany({ where: { productId }, select: { itemId: true } });
      const resolved = await this.resolve(tx, priceListId, variants.map((v) => v.itemId));
      return Object.fromEntries([...resolved].map(([k, v]) => [k, { price: v.price.toString(), includesVat: v.includesVat, source: v.source }]));
    });
  }
}
