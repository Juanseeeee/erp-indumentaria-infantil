import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, ErrorCodes, dec } from '@erp/domain-core';
import { z } from 'zod';
import { CountCreateSchema, CountLinesPatchSchema, KardexQuerySchema, StockQuerySchema } from '@erp/contracts';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { StockService } from './stock.service';

type StockQuery = z.infer<typeof StockQuerySchema>;

interface StockRow {
  item_id: string;
  sku: string;
  name: string;
  kind: string;
  uom: string;
  min_stock: string | null;
  on_hand: string;
  reserved: string;
  available: string;
  value: string | null;
  total: bigint;
}

@Injectable()
export class InventoryQueryService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly stock: StockService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /** Stock por artículo (total o de un depósito). La valorización solo con `costs.view`. */
  balances(ctx: RequestContext, q: StockQuery) {
    const showCost = can(ctx, 'costs.view');
    return this.uow.run(ctx, async (tx) => {
      const search = q.q ? `%${q.q}%` : null;
      const rows = await tx.$queryRaw<StockRow[]>`
        SELECT i.id AS item_id, i.sku, i.name, i.kind::text, u.code AS uom, i.min_stock::text,
               COALESCE(SUM(b.on_hand), 0)::text AS on_hand,
               COALESCE(SUM(b.reserved), 0)::text AS reserved,
               COALESCE(SUM(b.on_hand - b.reserved), 0)::text AS available,
               ROUND(COALESCE(SUM(b.on_hand * b.avg_cost), 0), 2)::text AS value,
               COUNT(*) OVER () AS total
        FROM items i
        JOIN uoms u ON u.id = i.base_uom_id
        LEFT JOIN stock_balances b ON b.item_id = i.id
          AND (${q.warehouseId ?? null}::uuid IS NULL OR b.warehouse_id = ${q.warehouseId ?? null}::uuid)
        WHERE i.is_active
          AND (${q.kind ?? null}::text IS NULL OR i.kind::text = ${q.kind ?? null}::text)
          AND (${search}::text IS NULL OR i.sku ILIKE ${search} OR i.name ILIKE ${search} OR i.barcode = ${q.q ?? null})
        GROUP BY i.id, u.code
        HAVING NOT ${q.onlyCritical} OR (i.min_stock IS NOT NULL AND COALESCE(SUM(b.on_hand - b.reserved), 0) < i.min_stock)
        ORDER BY i.created_at DESC, i.sku
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
      const total = rows[0] ? Number(rows[0].total) : 0;
      return {
        total,
        rows: rows.map(({ total: _t, value, ...r }) => ({
          ...r,
          on_hand: dec(r.on_hand).toString(),
          reserved: dec(r.reserved).toString(),
          available: dec(r.available).toString(),
          min_stock: r.min_stock === null ? null : dec(r.min_stock).toString(),
          value: showCost ? value : null,
          critical: r.min_stock !== null && dec(r.available).lt(r.min_stock),
        })),
      };
    });
  }

  /** Indicadores de inventario para el tablero. Valorización = Σ físico × costo promedio (estimado, no contable). */
  summary(ctx: RequestContext) {
    const showCost = can(ctx, 'costs.view');
    return this.uow.run(ctx, async (tx) => {
      const [row] = await tx.$queryRaw<
        { items_with_stock: bigint; critical: bigint; value_variants: string; value_materials: string; units_variants: string }[]
      >`
        WITH per_item AS (
          SELECT i.id, i.kind, i.min_stock,
                 COALESCE(SUM(b.on_hand), 0) AS on_hand,
                 COALESCE(SUM(b.on_hand - b.reserved), 0) AS available,
                 COALESCE(SUM(b.on_hand * b.avg_cost), 0) AS value
          FROM items i LEFT JOIN stock_balances b ON b.item_id = i.id
          WHERE i.is_active GROUP BY i.id
        )
        SELECT COUNT(*) FILTER (WHERE on_hand > 0) AS items_with_stock,
               COUNT(*) FILTER (WHERE min_stock IS NOT NULL AND available < min_stock) AS critical,
               ROUND(COALESCE(SUM(value) FILTER (WHERE kind = 'VARIANT'), 0), 2)::text AS value_variants,
               ROUND(COALESCE(SUM(value) FILTER (WHERE kind = 'MATERIAL'), 0), 2)::text AS value_materials,
               COALESCE(SUM(on_hand) FILTER (WHERE kind = 'VARIANT'), 0)::text AS units_variants
        FROM per_item`;
      const pendingApproval = await tx.stockDocument.count({ where: { status: 'PENDING_APPROVAL' } });
      return {
        itemsWithStock: Number(row!.items_with_stock),
        critical: Number(row!.critical),
        finishedUnits: dec(row!.units_variants).toString(),
        pendingApproval,
        valueFinished: showCost ? row!.value_variants : null,
        valueMaterials: showCost ? row!.value_materials : null,
      };
    });
  }

  /** Detalle por depósito y lote de un artículo. */
  itemBalances(ctx: RequestContext, itemId: string) {
    const showCost = can(ctx, 'costs.view');
    return this.uow.run(ctx, async (tx) => {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { id: true, sku: true, name: true, kind: true, barcode: true, minStock: true, baseUomId: true, variant: { select: { productId: true } } },
      });
      if (!item) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El artículo no existe.', 404);
      const uom = await tx.uom.findUnique({ where: { id: item.baseUomId }, select: { code: true } });
      const rows = await tx.stockBalance.findMany({ where: { itemId }, orderBy: { warehouseId: 'asc' } });
      const [warehouses, lots] = await Promise.all([
        tx.warehouse.findMany({ where: { id: { in: rows.map((r) => r.warehouseId) } }, select: { id: true, code: true, name: true } }),
        tx.lot.findMany({ where: { itemId }, select: { id: true, code: true } }),
      ]);
      const balances = rows
        .filter((r) => !r.onHand.isZero() || !r.reserved.isZero())
        .map((r) => ({
          warehouse: warehouses.find((w) => w.id === r.warehouseId),
          lot: lots.find((l) => l.id === r.lotId) ?? null,
          onHand: r.onHand.toString(),
          reserved: r.reserved.toString(),
          available: r.onHand.minus(r.reserved).toString(),
          avgCost: showCost ? r.avgCost.toString() : null,
        }));
      return {
        item: {
          id: item.id,
          sku: item.sku,
          name: item.name,
          kind: item.kind,
          barcode: item.barcode,
          uom: uom?.code ?? '',
          minStock: item.minStock?.toString() ?? null,
          productId: item.variant?.productId ?? null,
        },
        balances,
      };
    });
  }

  kardex(ctx: RequestContext, q: z.infer<typeof KardexQuerySchema>) {
    const showCost = can(ctx, 'costs.view');
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.StockMovementWhereInput = {
        itemId: q.itemId,
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        ...(q.from || q.to ? { occurredAt: { gte: q.from, lte: q.to } } : {}),
      };
      const rows = await tx.stockMovement.findMany({ where, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 5000 });
      const docIds = [...new Set(rows.filter((r) => r.sourceDocType.startsWith('STOCK_DOCUMENT')).map((r) => r.sourceDocId))];
      const docs = await tx.stockDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, number: true, type: true } });
      const users = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM users WHERE id = ANY(${[...new Set(rows.map((r) => r.createdBy))]}::uuid[])`;
      return rows.map((m) => ({
        id: m.id,
        occurredAt: m.occurredAt,
        type: m.type,
        warehouseId: m.warehouseId,
        qty: m.qty.toString(),
        balanceAfter: m.balanceAfter.toString(),
        unitCost: showCost ? m.unitCost.toString() : null,
        totalCost: showCost ? m.totalCost.toString() : null,
        reason: m.reason,
        source: {
          type: m.sourceDocType,
          id: m.sourceDocId,
          number: docs.find((d) => d.id === m.sourceDocId)?.number ?? null,
        },
        user: users.find((u) => u.id === m.createdBy)?.name ?? null,
      }));
    });
  }

  reconcile(ctx: RequestContext) {
    return this.uow.run(ctx, (tx) => this.stock.reconcile(tx));
  }

  // ─── Inventario físico ───

  createCount(ctx: RequestContext, input: z.infer<typeof CountCreateSchema>) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const number = `INV-${await this.numbering.next(tx, ctx.companyId, 'INVENTORY_COUNT')}`;
        const items = await tx.item.findMany({
          where: {
            isActive: true,
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.itemIds?.length ? { id: { in: input.itemIds } } : {}),
          },
          select: { id: true },
        });
        const balances = await tx.stockBalance.groupBy({
          by: ['itemId'],
          where: { warehouseId: input.warehouseId, itemId: { in: items.map((i) => i.id) } },
          _sum: { onHand: true },
        });
        const count = await tx.inventoryCount.create({
          data: {
            companyId: ctx.companyId,
            number,
            warehouseId: input.warehouseId,
            notes: input.notes,
            createdBy: ctx.userId,
            lines: {
              create: items.map((i) => ({
                companyId: ctx.companyId,
                itemId: i.id,
                expectedQty: balances.find((b) => b.itemId === i.id)?._sum.onHand?.toString() ?? '0',
              })),
            },
          },
        });
        await this.audit.log(tx, ctx, { entity: 'inventory_count', entityId: count.id, action: 'create' });
        return count;
      },
      { idempotent: true },
    );
  }

  getCount(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const count = await tx.inventoryCount.findUnique({ where: { id }, include: { lines: true } });
      if (!count) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El inventario no existe.', 404);
      const items = await tx.item.findMany({
        where: { id: { in: count.lines.map((l) => l.itemId) } },
        select: { id: true, sku: true, name: true, barcode: true },
      });
      return {
        ...count,
        lines: count.lines
          .map((l) => ({
            ...l,
            item: items.find((i) => i.id === l.itemId),
            difference: l.countedQty ? l.countedQty.minus(l.expectedQty).toString() : null,
          }))
          .sort((a, b) => (a.item?.sku ?? '').localeCompare(b.item?.sku ?? '')),
      };
    });
  }

  listCounts(ctx: RequestContext) {
    return this.uow.run(ctx, (tx) => tx.inventoryCount.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
  }

  setCounted(ctx: RequestContext, id: string, input: z.infer<typeof CountLinesPatchSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const count = await tx.inventoryCount.findUnique({ where: { id } });
      if (!count) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El inventario no existe.', 404);
      if (count.status !== 'OPEN') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El inventario ya no admite cambios.');
      for (const l of input.lines) {
        const res = await tx.inventoryCountLine.updateMany({
          where: { countId: id, itemId: l.itemId },
          data: { countedQty: l.countedQty, countedBy: ctx.userId },
        });
        if (res.count === 0) {
          throw new DomainError(ErrorCodes.VALIDACION, 'Hay artículos que no forman parte de este inventario.');
        }
      }
      return { updated: input.lines.length };
    });
  }

  /**
   * Postea el inventario: ajusta por la diferencia entre lo contado y lo esperado al abrir el conteo.
   * Las líneas sin contar no se ajustan. Supone el depósito sin movimientos durante el conteo.
   */
  postCount(ctx: RequestContext, id: string) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM inventory_counts WHERE id = ${id}::uuid FOR UPDATE`;
        if (!rows[0]) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El inventario no existe.', 404);
        if (rows[0].status !== 'OPEN' && rows[0].status !== 'REVIEW') {
          throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El inventario ya fue posteado o cancelado.');
        }
        const count = await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include: { lines: true } });
        const diffs = count.lines
          .filter((l) => l.countedQty !== null)
          .map((l) => ({ line: l, diff: dec(l.countedQty!.toString()).minus(l.expectedQty.toString()) }))
          .filter((d) => !d.diff.isZero());
        await this.stock.prelock(tx, ctx.companyId, diffs.map((d) => ({ itemId: d.line.itemId, warehouseId: count.warehouseId })));
        for (const { line, diff } of diffs) {
          await this.stock.move(tx, ctx, {
            itemId: line.itemId,
            warehouseId: count.warehouseId,
            type: 'COUNT_ADJUSTMENT',
            qty: diff.toString(),
            sourceDocType: 'INVENTORY_COUNT',
            sourceDocId: id,
            sourceLineId: line.id,
            reason: `Inventario ${count.number}`,
          });
        }
        await tx.inventoryCount.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date() } });
        await this.audit.log(tx, ctx, { entity: 'inventory_count', entityId: id, action: 'post', diff: { adjustedLines: diffs.length } });
        return { adjustedLines: diffs.length };
      },
      { idempotent: true, timeoutMs: 120_000 },
    );
  }
}
