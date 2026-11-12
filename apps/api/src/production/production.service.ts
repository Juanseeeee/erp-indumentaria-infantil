import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Dec, DomainError, ErrorCodes, dec, roundMoney, roundQty, sum } from '@erp/domain-core';
import { actualUnitCost, assertTransition, estimateUnitCost, explodeBom, theoreticalConsumption } from '@erp/domain-production';
import {
  IssueMaterialsSchema,
  ProductionOrderCreateInput,
  ProductionOutputCreateInput,
  ProgressReportSchema,
  ReturnMaterialsSchema,
  WorkshopDispatchCreateSchema,
} from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { StockService } from '../inventory/stock.service';
import { PurchasingService } from '../purchasing/purchasing.service';
import { toBomLines } from './techsheets.service';
import { currentWorkshopRate } from './production-config.service';
import { businessDate } from '../common/dates';

const SRC = 'PRODUCTION_ORDER';

/**
 * Desvío de consumo vs ficha. Con la orden terminada: consumido − requerido.
 * En curso solo se informa si ya se entregó más de lo requerido (sobreconsumo anticipado).
 */
function deviationOf(status: string, r: { requiredQty: Prisma.Decimal; issuedQty: Prisma.Decimal; returnedQty: Prisma.Decimal; consumedQty: Prisma.Decimal }): string | null {
  const required = dec(r.requiredQty.toString());
  if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(status)) return dec(r.consumedQty.toString()).minus(required).toString();
  const net = dec(r.issuedQty.toString()).minus(r.returnedQty.toString());
  return net.gt(required) ? net.minus(required).toString() : null;
}
const ACTIVE = ['RELEASED', 'IN_PROGRESS', 'COMPLETED'] as const;

type Order = Prisma.ProductionOrderGetPayload<{ include: { lines: true; requirements: true; stages: true } }>;

@Injectable()
export class ProductionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly purchasing: PurchasingService,
  ) {}

  // ─── Helpers ───

  private async lock(tx: Tx, id: string): Promise<Order> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM production_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La orden de producción no existe.', 404);
    return tx.productionOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, requirements: true, stages: true } });
  }

  private assertActive(o: Order) {
    if (!(ACTIVE as readonly string[]).includes(o.status)) {
      throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `La orden está en estado ${o.status}: no admite esta operación.`);
    }
  }

  private async garments(tx: Tx, lines: { variantItemId: string; qty: Dec | string }[]) {
    const variants = await tx.productVariant.findMany({ where: { itemId: { in: lines.map((l) => l.variantItemId) } } });
    return lines.map((l) => {
      const v = variants.find((x) => x.itemId === l.variantItemId)!;
      return { variantItemId: l.variantItemId, sizeId: v.sizeId, colorId: v.colorId, qty: l.qty.toString() };
    });
  }

  private async bom(tx: Tx, versionId: string) {
    return toBomLines(await tx.techSheetMaterial.findMany({ where: { versionId }, orderBy: { sortOrder: 'asc' } }));
  }

  private async workshopWarehouse(tx: Tx, workshopId: string) {
    const wh = await tx.warehouse.findUnique({ where: { partyId: workshopId } });
    if (!wh) throw new DomainError(ErrorCodes.VALIDACION, 'El taller no tiene depósito asociado. Revisá que esté dado de alta como taller.');
    return wh;
  }

  private async requirement(tx: Tx, ctx: RequestContext, order: Order, materialItemId: string) {
    const existing = order.requirements.find((r) => r.materialItemId === materialItemId);
    if (existing) return existing;
    const mat = await tx.material.findUnique({ where: { itemId: materialItemId } });
    if (!mat) throw new DomainError(ErrorCodes.VALIDACION, 'Solo se pueden entregar materias primas.');
    // Consumo no previsto en la ficha: queda registrado con requerido 0 (aparece como desvío).
    const r = await tx.productionRequirement.create({ data: { companyId: ctx.companyId, orderId: order.id, materialItemId, requiredQty: '0' } });
    order.requirements.push(r);
    return r;
  }

  /** Materiales que se cuentan por unidad (broches, etiquetas): sus requerimientos se redondean hacia arriba. */
  private async unitItemIds(tx: Tx, itemIds: string[]): Promise<Set<string>> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM items i JOIN uoms u ON u.id = i.base_uom_id WHERE i.id = ANY(${itemIds}::uuid[]) AND u.dimension = 'UNIT'`;
    return new Set(rows.map((r) => r.id));
  }

  private async materialCostMap(tx: Tx, itemIds: string[], warehouseId: string) {
    const map: Record<string, string> = {};
    for (const id of itemIds) {
      const avg = await this.stock.currentAvgCost(tx, id, warehouseId);
      if (dec(avg).isZero()) {
        const m = await tx.material.findUnique({ where: { itemId: id }, select: { lastCost: true } });
        map[id] = m?.lastCost?.toString() ?? '0';
      } else map[id] = avg;
    }
    return map;
  }

  /**
   * Consumo de materiales que todavía falta registrar según la ficha, por las prendas ya ingresadas
   * (aprobadas, segunda y descarte): teórico − consumido − lo que está en poder de talleres.
   */
  private async consumptionGap(tx: Tx, o: Order) {
    if (!o.techSheetVersionId) return [];
    const lines = await tx.productionOrderLine.findMany({ where: { orderId: o.id } });
    const produced = lines
      .map((l) => ({ variantItemId: l.variantItemId, qty: dec(l.goodQty.toString()).plus(l.secondQty.toString()).plus(l.scrapQty.toString()) }))
      .filter((l) => l.qty.gt(0));
    if (!produced.length) return [];
    const colors = await tx.color.findMany({ select: { id: true, name: true } });
    const theo = explodeBom(await this.bom(tx, o.techSheetVersionId), await this.garments(tx, produced), Object.fromEntries(colors.map((c) => [c.id, c.name])));
    const units = await this.unitItemIds(tx, [...theo.keys()]);
    const reqs = await tx.productionRequirement.findMany({ where: { orderId: o.id } });
    const gaps: { materialItemId: string; qty: Dec }[] = [];
    for (const [materialItemId, raw] of theo) {
      const need = units.has(materialItemId) ? raw.ceil() : raw;
      const r = reqs.find((x) => x.materialItemId === materialItemId);
      const covered = r ? dec(r.consumedQty.toString()).plus(r.atWorkshopQty.toString()) : dec(0);
      const gap = roundQty(need.minus(covered));
      if (gap.gt(0)) gaps.push({ materialItemId, qty: gap });
    }
    return gaps;
  }

  /**
   * Registra el consumo pendiente según la ficha desde el depósito de materiales.
   * `partial`: consume lo que haya (libre + reservado para la orden) y devuelve lo que no se pudo.
   * Sin `partial` falla si falta stock (mensaje de stock insuficiente).
   */
  private async consumeGap(tx: Tx, ctx: RequestContext, o: Order, reason: string, partial: boolean) {
    const gaps = await this.consumptionGap(tx, o);
    await this.stock.prelock(tx, ctx.companyId, gaps.map((g) => ({ itemId: g.materialItemId, warehouseId: o.materialsWarehouseId })));
    const missing: { materialItemId: string; sku?: string; qty: string }[] = [];
    for (const g of gaps) {
      const r = await this.requirement(tx, ctx, o, g.materialItemId);
      const own = await this.stock.reservationPending(tx, r.reservationId);
      const free = await this.stock.available(tx, g.materialItemId, o.materialsWarehouseId);
      const avail = own.plus(free.gt(0) ? free : dec(0));
      const take = partial && avail.lt(g.qty) ? avail : g.qty;
      if (take.gt(0)) {
        await this.stock.moveOutFifo(tx, ctx, {
          itemId: g.materialItemId, warehouseId: o.materialsWarehouseId, type: 'PROD_ISSUE', qty: take.toString(),
          sourceDocType: SRC, sourceDocId: o.id, sourceLineId: r.id, reservationId: r.reservationId, reason,
        });
        await tx.productionRequirement.update({ where: { id: r.id }, data: { issuedQty: { increment: take.toString() }, consumedQty: { increment: take.toString() } } });
        r.issuedQty = new Prisma.Decimal(dec(r.issuedQty.toString()).plus(take).toString());
        r.consumedQty = new Prisma.Decimal(dec(r.consumedQty.toString()).plus(take).toString());
      }
      if (take.lt(g.qty)) missing.push({ materialItemId: g.materialItemId, qty: g.qty.minus(take).toString() });
    }
    if (missing.length) {
      const items = await tx.item.findMany({ where: { id: { in: missing.map((m) => m.materialItemId) } }, select: { id: true, sku: true } });
      for (const m of missing) m.sku = items.find((i) => i.id === m.materialItemId)?.sku;
    }
    return { consumed: gaps.length - missing.length, missing };
  }

  // ─── Alta ───

  create(ctx: RequestContext, input: ProductionOrderCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const variants = await tx.productVariant.findMany({ where: { productId: input.productId }, include: { item: true } });
        for (const l of input.lines) {
          const v = variants.find((x) => x.itemId === l.variantItemId);
          if (!v) throw new DomainError(ErrorCodes.VALIDACION, 'Hay variantes que no pertenecen al modelo.');
          if (!v.item.isActive) throw new DomainError(ErrorCodes.VALIDACION, `La variante ${v.item.sku} está inactiva.`);
        }
        if (input.secondsWarehouseId && input.secondsWarehouseId === input.outputWarehouseId) {
          throw new DomainError(ErrorCodes.VALIDACION, 'La segunda selección debe ir a un depósito distinto del de producto terminado.');
        }
        const number = `OP-${await this.numbering.next(tx, ctx.companyId, 'PRODUCTION_ORDER', '', 5)}`;
        const o = await tx.productionOrder.create({
          data: {
            companyId: ctx.companyId,
            number,
            productId: input.productId,
            priority: input.priority,
            plannedStart: input.plannedStart,
            dueDate: input.dueDate,
            responsibleUserId: input.responsibleUserId ?? null,
            materialsWarehouseId: input.materialsWarehouseId,
            outputWarehouseId: input.outputWarehouseId,
            secondsWarehouseId: input.secondsWarehouseId ?? null,
            notes: input.notes,
            createdBy: ctx.userId,
            lines: { create: input.lines.map((l) => ({ companyId: ctx.companyId, variantItemId: l.variantItemId, plannedQty: l.qty })) },
          },
        });
        await this.audit.log(tx, ctx, { entity: 'production_order', entityId: o.id, action: 'create', diff: { number, units: sum(input.lines.map((l) => l.qty)).toString() } });
        return o;
      },
      { idempotent: true },
    );
  }

  /** Ajusta cantidades de una orden en borrador. */
  updateDraftLines(ctx: RequestContext, id: string, lines: { variantItemId: string; qty: string }[]) {
    return this.uow.run(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      if (o.status !== 'DRAFT') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Solo se pueden editar cantidades en borrador.');
      await tx.productionOrderLine.deleteMany({ where: { orderId: id } });
      await tx.productionOrderLine.createMany({
        data: lines.filter((l) => dec(l.qty).gt(0)).map((l) => ({ companyId: ctx.companyId, orderId: id, variantItemId: l.variantItemId, plannedQty: l.qty })),
      });
      await this.audit.log(tx, ctx, { entity: 'production_order', entityId: id, action: 'update_lines' });
      return { ok: true };
    });
  }

  // ─── Liberación: congela ficha, explota materiales, reserva ───

  release(ctx: RequestContext, id: string) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        assertTransition(o.status, 'RELEASED');
        const sheet = await tx.techSheet.findUnique({ where: { productId: o.productId } });
        if (!sheet?.currentVersionId) {
          throw new DomainError(ErrorCodes.VALIDACION, 'El modelo no tiene una ficha técnica activa. Cargala y activala antes de liberar la orden.');
        }
        const version = await tx.techSheetVersion.findUniqueOrThrow({ where: { id: sheet.currentVersionId } });
        const bom = await this.bom(tx, version.id);
        const colors = await tx.color.findMany({ select: { id: true, name: true } });
        const req = explodeBom(
          bom,
          await this.garments(tx, o.lines.map((l) => ({ variantItemId: l.variantItemId, qty: l.plannedQty.toString() }))),
          Object.fromEntries(colors.map((c) => [c.id, c.name])),
        );
        const units = await this.unitItemIds(tx, [...req.keys()]);
        for (const [k, v] of req) if (units.has(k)) req.set(k, v.ceil());
        await this.stock.prelock(tx, ctx.companyId, [...req.keys()].map((itemId) => ({ itemId, warehouseId: o.materialsWarehouseId })));

        const shortages: { materialItemId: string; required: string; reserved: string; shortage: string }[] = [];
        for (const [materialItemId, required] of req) {
          const available = await this.stock.available(tx, materialItemId, o.materialsWarehouseId);
          const toReserve = available.gt(0) ? (available.lt(required) ? available : required) : dec(0);
          const reservation = toReserve.gt(0)
            ? await this.stock.reserve(tx, ctx, { itemId: materialItemId, warehouseId: o.materialsWarehouseId, qty: toReserve.toString(), sourceDocType: SRC, sourceDocId: o.id })
            : null;
          await tx.productionRequirement.create({
            data: { companyId: ctx.companyId, orderId: o.id, materialItemId, requiredQty: required.toString(), reservationId: reservation?.id ?? null },
          });
          if (toReserve.lt(required)) {
            shortages.push({ materialItemId, required: required.toString(), reserved: toReserve.toString(), shortage: required.minus(toReserve).toString() });
          }
        }

        // Recorrido: etapas de la ficha o, si no definió, todas las activas.
        const stageIds = version.stageIds.length
          ? version.stageIds
          : (await tx.productionStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })).map((s) => s.id);
        await tx.productionOrderStage.createMany({
          data: stageIds.map((stageId, i) => ({ companyId: ctx.companyId, orderId: o.id, stageId, sortOrder: i })),
        });

        // Costo estimado (materiales a costo promedio actual; la tarifa de taller se suma al recibir).
        const costMap = await this.materialCostMap(tx, [...req.keys()], o.materialsWarehouseId);
        const gs = await this.garments(tx, o.lines.map((l) => ({ variantItemId: l.variantItemId, qty: l.plannedQty.toString() })));
        const materialsTotal = roundMoney(sum(gs.map((g) => estimateUnitCost(bom, g, costMap).materials.times(g.qty))));
        const plannedUnits = sum(o.lines.map((l) => l.plannedQty.toString()));
        await tx.productionCostSnapshot.create({
          data: {
            companyId: ctx.companyId,
            orderId: o.id,
            kind: 'ESTIMATED',
            materials: materialsTotal.toString(),
            workshop: '0',
            overhead: '0',
            total: materialsTotal.toString(),
            goodUnits: plannedUnits.toString(),
            unitCost: plannedUnits.gt(0) ? materialsTotal.div(plannedUnits).toDecimalPlaces(6).toString() : '0',
            detail: { versionNo: version.versionNo, costMap },
            computedBy: ctx.userId,
          },
        });
        await tx.productionOrder.update({
          where: { id: o.id },
          data: {
            status: 'RELEASED',
            techSheetVersionId: version.id,
            releasedAt: new Date(),
            estimatedUnitCost: plannedUnits.gt(0) ? materialsTotal.div(plannedUnits).toDecimalPlaces(6).toString() : null,
            version: { increment: 1 },
          },
        });
        await this.audit.log(tx, ctx, { entity: 'production_order', entityId: o.id, action: 'release', diff: { techSheetVersion: version.versionNo, shortages: shortages.length } });
        return { id: o.id, shortages };
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  /** Genera una solicitud de compra con los faltantes actuales de la orden. */
  requestShortages(ctx: RequestContext, id: string) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        this.assertActive(o);
        const lines: { itemId: string; qty: string }[] = [];
        for (const r of o.requirements) {
          const pendingNeed = dec(r.requiredQty.toString()).minus(r.issuedQty.toString());
          if (pendingNeed.lte(0)) continue;
          const reserved = await this.stock.reservationPending(tx, r.reservationId);
          const free = await this.stock.available(tx, r.materialItemId, o.materialsWarehouseId);
          const short = pendingNeed.minus(reserved).minus(free.gt(0) ? free : dec(0));
          if (short.gt(0)) lines.push({ itemId: r.materialItemId, qty: roundQty(short).toString() });
        }
        if (!lines.length) throw new DomainError(ErrorCodes.VALIDACION, 'La orden no tiene faltantes de materiales.');
        return this.purchasing.createRequestInTx(
          tx,
          ctx,
          { lines, productionOrderId: o.id, neededBy: o.plannedStart, notes: `Faltantes de ${o.number}` },
          'PRODUCTION',
        );
      },
      { idempotent: true },
    );
  }

  // ─── Materiales ───

  /** Entrega de materiales: consumo interno (corte propio) o envío al depósito de un taller. */
  issueMaterials(ctx: RequestContext, id: string, input: z.infer<typeof IssueMaterialsSchema>) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        this.assertActive(o);
        const wsWh = input.workshopId ? await this.workshopWarehouse(tx, input.workshopId) : null;
        await this.stock.prelock(tx, ctx.companyId, input.lines.flatMap((l) => [
          { itemId: l.materialItemId, warehouseId: o.materialsWarehouseId },
          ...(wsWh ? [{ itemId: l.materialItemId, warehouseId: wsWh.id }] : []),
        ]));
        for (const l of input.lines) {
          const r = await this.requirement(tx, ctx, o, l.materialItemId);
          const lotId = l.lotCode ? (await tx.lot.findUnique({ where: { companyId_itemId_code: { companyId: ctx.companyId, itemId: l.materialItemId, code: l.lotCode } } }))?.id : null;
          if (l.lotCode && !lotId) throw new DomainError(ErrorCodes.NO_ENCONTRADO, `No existe la partida ${l.lotCode}.`, 404);
          const common = { itemId: l.materialItemId, sourceDocType: SRC, sourceDocId: o.id, sourceLineId: r.id, reservationId: r.reservationId, reason: input.notes ?? `Entrega ${o.number}` };
          if (wsWh) {
            await this.stock.transfer(tx, ctx, { ...common, fromWarehouseId: o.materialsWarehouseId, toWarehouseId: wsWh.id, qty: l.qty, lotId });
            await tx.productionRequirement.update({ where: { id: r.id }, data: { issuedQty: { increment: l.qty }, atWorkshopQty: { increment: l.qty } } });
          } else {
            if (lotId) await this.stock.move(tx, ctx, { ...common, warehouseId: o.materialsWarehouseId, lotId, type: 'PROD_ISSUE', qty: dec(l.qty).negated().toString() });
            else await this.stock.moveOutFifo(tx, ctx, { ...common, warehouseId: o.materialsWarehouseId, type: 'PROD_ISSUE', qty: l.qty });
            await tx.productionRequirement.update({ where: { id: r.id }, data: { issuedQty: { increment: l.qty }, consumedQty: { increment: l.qty } } });
          }
        }
        if (o.status === 'RELEASED') await tx.productionOrder.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
        await this.audit.log(tx, ctx, { entity: 'production_order', entityId: id, action: wsWh ? 'send_materials' : 'issue_materials', diff: input.lines });
        return this.detailInTx(tx, ctx, id);
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  /** Devolución de sobrantes: desde planta (interno) o desde el taller. */
  returnMaterials(ctx: RequestContext, id: string, input: z.infer<typeof ReturnMaterialsSchema>) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        if (!['RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(o.status)) {
          throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La orden no admite devoluciones.');
        }
        const wsWh = input.workshopId ? await this.workshopWarehouse(tx, input.workshopId) : null;
        for (const l of input.lines) {
          const r = o.requirements.find((x) => x.materialItemId === l.materialItemId);
          if (!r) throw new DomainError(ErrorCodes.VALIDACION, 'Ese material no se entregó para esta orden.');
          const common = { itemId: l.materialItemId, sourceDocType: SRC, sourceDocId: o.id, sourceLineId: r.id, reason: input.notes ?? `Devolución ${o.number}` };
          if (wsWh) {
            if (dec(l.qty).gt(r.atWorkshopQty.toString())) {
              throw new DomainError(ErrorCodes.VALIDACION, `Se devuelve más de lo que el taller tiene de esta orden (${r.atWorkshopQty.toString()}).`);
            }
            await this.stock.transfer(tx, ctx, { ...common, fromWarehouseId: wsWh.id, toWarehouseId: o.materialsWarehouseId, qty: l.qty });
            await tx.productionRequirement.update({ where: { id: r.id }, data: { atWorkshopQty: { decrement: l.qty }, returnedQty: { increment: l.qty } } });
          } else {
            if (dec(l.qty).gt(r.consumedQty.toString())) throw new DomainError(ErrorCodes.VALIDACION, 'Se devuelve más de lo entregado a planta.');
            const cost = await this.issuedUnitCost(tx, o.id, l.materialItemId);
            await this.stock.move(tx, ctx, { ...common, warehouseId: o.materialsWarehouseId, type: 'PROD_RETURN', qty: l.qty, unitCost: cost });
            await tx.productionRequirement.update({ where: { id: r.id }, data: { consumedQty: { decrement: l.qty }, returnedQty: { increment: l.qty } } });
          }
        }
        await this.audit.log(tx, ctx, { entity: 'production_order', entityId: id, action: 'return_materials', diff: input });
        return this.detailInTx(tx, ctx, id);
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  /** Faltante de material en el taller: se da de baja de su depósito y se carga a la orden. */
  writeOffWorkshopMaterials(ctx: RequestContext, id: string, input: z.infer<typeof ReturnMaterialsSchema> & { reason: string }) {
    return this.uow.run(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      if (!input.workshopId) throw new DomainError(ErrorCodes.VALIDACION, 'Indicá el taller.');
      const wsWh = await this.workshopWarehouse(tx, input.workshopId);
      for (const l of input.lines) {
        const r = o.requirements.find((x) => x.materialItemId === l.materialItemId);
        if (!r || dec(l.qty).gt(r.atWorkshopQty.toString())) throw new DomainError(ErrorCodes.VALIDACION, 'La cantidad supera lo que el taller tiene de esta orden.');
        await this.stock.moveOutFifo(tx, ctx, {
          itemId: l.materialItemId, warehouseId: wsWh.id, type: 'PROD_SCRAP', qty: l.qty,
          sourceDocType: SRC, sourceDocId: o.id, sourceLineId: r.id, reason: `Faltante en taller: ${input.reason}`,
        });
        await tx.productionRequirement.update({ where: { id: r.id }, data: { atWorkshopQty: { decrement: l.qty }, consumedQty: { increment: l.qty } } });
      }
      await this.audit.log(tx, ctx, { entity: 'production_order', entityId: id, action: 'write_off_workshop', reason: input.reason, diff: input.lines });
      return this.detailInTx(tx, ctx, id);
    });
  }

  private async issuedUnitCost(tx: Tx, orderId: string, itemId: string) {
    const rows = await tx.$queryRaw<{ cost: Prisma.Decimal | null }[]>`
      SELECT SUM(total_cost) / NULLIF(SUM(qty), 0) AS cost FROM stock_movements
      WHERE source_doc_type = ${SRC} AND source_doc_id = ${orderId}::uuid AND item_id = ${itemId}::uuid AND type = 'PROD_ISSUE'`;
    return rows[0]?.cost ? dec(rows[0].cost.toString()).abs().toDecimalPlaces(6).toString() : '0';
  }

  // ─── Talleres ───

  dispatch(ctx: RequestContext, id: string, input: z.infer<typeof WorkshopDispatchCreateSchema>) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        this.assertActive(o);
        const wsWh = await this.workshopWarehouse(tx, input.workshopId);
        const prev = await tx.workshopDispatchLine.findMany({ where: { kind: 'GARMENT', dispatch: { orderId: id } } });
        for (const g of input.garments) {
          const line = o.lines.find((l) => l.variantItemId === g.variantItemId);
          if (!line) throw new DomainError(ErrorCodes.VALIDACION, 'Hay prendas que no son de esta orden.');
          const sent = sum(prev.filter((p) => p.itemId === g.variantItemId).map((p) => p.qty.toString()));
          const pending = dec(line.plannedQty.toString()).minus(sent);
          if (dec(g.qty).gt(pending)) throw new DomainError(ErrorCodes.VALIDACION, `Se envían más prendas que las pendientes de enviar (${pending.toString()}).`);
        }
        const number = `ET-${await this.numbering.next(tx, ctx.companyId, 'WORKSHOP_DISPATCH', '', 6)}`;
        const d = await tx.workshopDispatch.create({
          data: {
            companyId: ctx.companyId, number, orderId: id, workshopId: input.workshopId, expectedAt: input.expectedAt, notes: input.notes, createdBy: ctx.userId,
            lines: {
              create: [
                ...input.garments.map((g) => ({ companyId: ctx.companyId, kind: 'GARMENT', itemId: g.variantItemId, qty: g.qty })),
                ...input.materials.map((m) => ({ companyId: ctx.companyId, kind: 'MATERIAL', itemId: m.materialItemId, qty: m.qty })),
              ],
            },
          },
        });
        for (const m of input.materials) {
          const r = await this.requirement(tx, ctx, o, m.materialItemId);
          const lotId = m.lotCode ? (await tx.lot.findUnique({ where: { companyId_itemId_code: { companyId: ctx.companyId, itemId: m.materialItemId, code: m.lotCode } } }))?.id : null;
          await this.stock.transfer(tx, ctx, {
            itemId: m.materialItemId, fromWarehouseId: o.materialsWarehouseId, toWarehouseId: wsWh.id, qty: m.qty, lotId,
            reservationId: r.reservationId, sourceDocType: SRC, sourceDocId: o.id, sourceLineId: r.id, reason: `Envío ${number}`,
          });
          await tx.productionRequirement.update({ where: { id: r.id }, data: { issuedQty: { increment: m.qty }, atWorkshopQty: { increment: m.qty } } });
        }
        // Las etapas externas sin taller asignado quedan a cargo de este taller.
        const external = await tx.productionStage.findMany({ where: { isExternal: true }, select: { id: true } });
        await tx.productionOrderStage.updateMany({
          where: { orderId: id, stageId: { in: external.map((s) => s.id) }, workshopId: null },
          data: { workshopId: input.workshopId, status: 'IN_PROGRESS', startedAt: new Date() },
        });
        if (o.status === 'RELEASED') await tx.productionOrder.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
        await this.audit.log(tx, ctx, { entity: 'workshop_dispatch', entityId: d.id, action: 'create', diff: { number, order: o.number } });
        return tx.workshopDispatch.findUniqueOrThrow({ where: { id: d.id }, include: { lines: true } });
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  // ─── Avances ───

  report(ctx: RequestContext, id: string, input: z.infer<typeof ProgressReportSchema>) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        this.assertActive(o);
        const stage = o.stages.find((s) => s.stageId === input.stageId);
        if (!stage) throw new DomainError(ErrorCodes.VALIDACION, 'La etapa no forma parte del recorrido de esta orden.');
        if (stage.status === 'DONE' || stage.status === 'SKIPPED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La etapa ya está cerrada.');
        if (dec(input.qtyGood).isNegative() || dec(input.qtyDefect).isNegative()) throw new DomainError(ErrorCodes.CANTIDAD_INVALIDA, 'Las cantidades no pueden ser negativas.');
        if (dec(input.qtyGood).plus(input.qtyDefect).isZero() && !input.finishStage) throw new DomainError(ErrorCodes.CANTIDAD_INVALIDA, 'Informá alguna cantidad.');
        await tx.productionReport.create({
          data: {
            companyId: ctx.companyId, orderId: id, stageId: input.stageId, qtyGood: input.qtyGood, qtyDefect: input.qtyDefect,
            defectReasonId: input.defectReasonId ?? null, notes: input.notes, reportedBy: ctx.userId,
          },
        });
        await tx.productionOrderStage.update({
          where: { id: stage.id },
          data: {
            completedQty: { increment: input.qtyGood },
            defectQty: { increment: input.qtyDefect },
            status: input.finishStage ? 'DONE' : 'IN_PROGRESS',
            startedAt: stage.startedAt ?? new Date(),
            finishedAt: input.finishStage ? new Date() : null,
          },
        });
        if (o.status === 'RELEASED') await tx.productionOrder.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
        return { ok: true };
      },
      { idempotent: true },
    );
  }

  // ─── Ingreso con control de calidad ───

  /**
   * Ingreso de prendas terminadas (internas o recibidas de un taller) con control de calidad.
   * Aprobadas → depósito de producto terminado; segunda → depósito de segunda; descarte → solo registro.
   * Si viene de un taller, consume del depósito del taller los materiales según la ficha (backflush).
   */
  output(ctx: RequestContext, id: string, input: ProductionOutputCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        this.assertActive(o);
        if (!o.techSheetVersionId) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La orden no está liberada.');
        const dispatch = input.dispatchId
          ? await tx.workshopDispatch.findUnique({ where: { id: input.dispatchId }, include: { lines: true } })
          : null;
        if (input.dispatchId && (!dispatch || dispatch.orderId !== id)) throw new DomainError(ErrorCodes.VALIDACION, 'El envío no corresponde a esta orden.');
        if (dispatch && dispatch.status === 'CLOSED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El envío ya está cerrado.');
        const workshopId = dispatch?.workshopId ?? null;
        const rate = workshopId ? await currentWorkshopRate(tx, workshopId, o.productId) : null;
        if (workshopId && !rate) {
          throw new DomainError(ErrorCodes.VALIDACION, 'No hay tarifa cargada para este taller y modelo. Cargala en Configuración de producción.');
        }
        const bom = await this.bom(tx, o.techSheetVersionId);
        const wsWh = workshopId ? await this.workshopWarehouse(tx, workshopId) : null;
        const outputs = await tx.productionOutputLine.findMany({ where: { output: { orderId: id } } });
        const number = `IP-${await this.numbering.next(tx, ctx.companyId, 'PRODUCTION_OUTPUT', '', 6)}`;
        const out = await tx.productionOutput.create({
          data: { companyId: ctx.companyId, number, orderId: id, workshopId, dispatchId: dispatch?.id ?? null, notes: input.notes, createdBy: ctx.userId },
        });

        const costMap = await this.materialCostMap(tx, [...new Set(bom.flatMap((b) => [b.materialItemId, ...Object.values(b.colorMap)]).filter((x): x is string => !!x))], o.materialsWarehouseId);
        const warnings: string[] = [];
        const touched = input.lines.flatMap((l) => [
          { itemId: l.variantItemId, warehouseId: o.outputWarehouseId },
          ...(o.secondsWarehouseId ? [{ itemId: l.variantItemId, warehouseId: o.secondsWarehouseId }] : []),
        ]);
        await this.stock.prelock(tx, ctx.companyId, touched);

        for (const l of input.lines) {
          const line = o.lines.find((x) => x.variantItemId === l.variantItemId);
          if (!line) throw new DomainError(ErrorCodes.VALIDACION, 'Hay prendas que no son de esta orden.');
          const units = dec(l.approvedQty).plus(l.secondQty).plus(l.scrapQty);
          if (units.lte(0)) continue;
          const already = sum(outputs.filter((x) => x.variantItemId === l.variantItemId).map((x) => dec(x.approvedQty.toString()).plus(x.secondQty.toString()).plus(x.scrapQty.toString())));
          if (already.plus(units).gt(line.plannedQty.toString())) {
            throw new DomainError(ErrorCodes.VALIDACION, `Se ingresan más prendas que las planificadas (${line.plannedQty.toString()}). Ajustá la orden antes de ingresar el excedente.`);
          }
          if (dec(l.secondQty).gt(0) && !o.secondsWarehouseId) throw new DomainError(ErrorCodes.VALIDACION, 'La orden no tiene depósito para segunda selección.');
          if (dispatch) {
            const dl = dispatch.lines.find((x) => x.kind === 'GARMENT' && x.itemId === l.variantItemId);
            const pend = dl ? dec(dl.qty.toString()).minus(dl.receivedQty.toString()) : dec(0);
            if (units.gt(pend)) throw new DomainError(ErrorCodes.VALIDACION, `Se reciben más prendas que las enviadas al taller y pendientes (${pend.toString()}).`);
            await tx.workshopDispatchLine.update({ where: { id: dl!.id }, data: { receivedQty: { increment: units.toString() } } });
          }
          const [g] = await this.garments(tx, [{ variantItemId: l.variantItemId, qty: units.toString() }]);
          const est = estimateUnitCost(bom, g!, costMap, rate?.price.toString() ?? '0');

          // Backflush del taller: consume la ficha teórica por las prendas recibidas.
          if (wsWh) {
            const theo = theoreticalConsumption(bom, g!);
            const unitIds = await this.unitItemIds(tx, [...theo.keys()]);
            for (const [materialItemId, rawQty] of theo) {
              const qty = unitIds.has(materialItemId) ? rawQty.ceil() : rawQty;
              const r = await this.requirement(tx, ctx, o, materialItemId);
              const atWs = dec(r.atWorkshopQty.toString());
              const take = qty.gt(atWs) ? atWs : qty;
              if (qty.gt(atWs)) {
                const item = await tx.item.findUnique({ where: { id: materialItemId }, select: { sku: true } });
                warnings.push(`${item?.sku}: la ficha indica ${qty.toString()} y el taller tenía ${atWs.toString()} de esta orden.`);
              }
              if (take.gt(0)) {
                await this.stock.moveOutFifo(tx, ctx, {
                  itemId: materialItemId, warehouseId: wsWh.id, type: 'PROD_ISSUE', qty: take.toString(),
                  sourceDocType: SRC, sourceDocId: o.id, sourceLineId: r.id, reason: `Consumo taller ${number}`,
                });
                await tx.productionRequirement.update({ where: { id: r.id }, data: { atWorkshopQty: { decrement: take.toString() }, consumedQty: { increment: take.toString() } } });
                r.atWorkshopQty = new Prisma.Decimal(atWs.minus(take).toString());
              }
            }
          }

          const outLine = await tx.productionOutputLine.create({
            data: {
              companyId: ctx.companyId, outputId: out.id, variantItemId: l.variantItemId, approvedQty: l.approvedQty, secondQty: l.secondQty,
              scrapQty: l.scrapQty, defectReasonId: l.defectReasonId ?? null, unitCost: est.total.toString(), workshopRate: rate?.price ?? null,
            },
          });
          if (dec(l.approvedQty).gt(0)) {
            await this.stock.move(tx, ctx, {
              itemId: l.variantItemId, warehouseId: o.outputWarehouseId, type: 'PROD_OUTPUT', qty: l.approvedQty, unitCost: est.total.toString(),
              sourceDocType: SRC, sourceDocId: o.id, sourceLineId: outLine.id, reason: `Ingreso ${number}`,
            });
          }
          if (dec(l.secondQty).gt(0)) {
            await this.stock.move(tx, ctx, {
              itemId: l.variantItemId, warehouseId: o.secondsWarehouseId!, type: 'PROD_OUTPUT', qty: l.secondQty, unitCost: est.total.toString(),
              sourceDocType: SRC, sourceDocId: o.id, sourceLineId: outLine.id, reason: `Segunda selección ${number}`,
            });
          }
          await tx.productionOrderLine.update({
            where: { id: line.id },
            data: { goodQty: { increment: l.approvedQty }, secondQty: { increment: l.secondQty }, scrapQty: { increment: l.scrapQty } },
          });
        }
        if (dispatch) {
          const lines = await tx.workshopDispatchLine.findMany({ where: { dispatchId: dispatch.id, kind: 'GARMENT' } });
          const done = lines.every((x) => dec(x.receivedQty.toString()).gte(x.qty.toString()));
          await tx.workshopDispatch.update({ where: { id: dispatch.id }, data: { status: done ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
        }
        // Producción propia: lo que la planta no retiró explícitamente se consume según la ficha.
        // Si falta material (p. ej. la compra todavía no se recibió) queda pendiente y se avisa.
        let pendingConsumption: { materialItemId: string; sku?: string; qty: string }[] = [];
        if (!dispatch) {
          const res = await this.consumeGap(tx, ctx, o, `Consumo según ficha ${number}`, true);
          pendingConsumption = res.missing;
          for (const m of res.missing) {
            warnings.push(`${m.sku}: faltan ${m.qty} en el depósito de materiales; el consumo queda pendiente. Cuando lo recibas, usá «Consumir según ficha».`);
          }
        }
        // Si se ingresó todo lo planificado, la orden queda terminada (lista para cerrar).
        const after = await tx.productionOrderLine.findMany({ where: { orderId: id } });
        const complete = after.every((x) => dec(x.goodQty.toString()).plus(x.secondQty.toString()).plus(x.scrapQty.toString()).gte(x.plannedQty.toString()));
        await tx.productionOrder.update({ where: { id }, data: { status: complete ? 'COMPLETED' : 'IN_PROGRESS', version: { increment: 1 } } });
        await this.audit.log(tx, ctx, { entity: 'production_output', entityId: out.id, action: 'create', diff: { number, order: o.number, warnings } });
        return { id: out.id, number, warnings, pendingConsumption };
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  // ─── Cierre y cancelación ───

  private async assertNothingAtWorkshop(tx: Tx, o: Order) {
    const pending = o.requirements.filter((r) => dec(r.atWorkshopQty.toString()).gt(0));
    if (pending.length) {
      const items = await tx.item.findMany({ where: { id: { in: pending.map((p) => p.materialItemId) } }, select: { id: true, sku: true } });
      throw new DomainError(
        ErrorCodes.VALIDACION,
        `Hay materiales de esta orden en poder de talleres: ${pending.map((p) => `${items.find((i) => i.id === p.materialItemId)?.sku} (${p.atWorkshopQty.toString()})`).join(', ')}. Registrá la devolución o el faltante antes de continuar.`,
        422,
        { pending: pending.map((p) => ({ materialItemId: p.materialItemId, qty: p.atWorkshopQty.toString() })) },
      );
    }
  }

  private async releaseReservations(tx: Tx, ctx: RequestContext, o: Order) {
    for (const r of o.requirements) if (r.reservationId) await this.stock.release(tx, ctx, r.reservationId, { strict: false });
  }

  private async actualCost(tx: Tx, ctx: RequestContext, o: Order, kind: 'ACTUAL' | 'CANCELLED') {
    const [mat] = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT -SUM(total_cost) AS total FROM stock_movements
      WHERE source_doc_type = ${SRC} AND source_doc_id = ${o.id}::uuid AND type IN ('PROD_ISSUE', 'PROD_RETURN', 'PROD_SCRAP')`;
    const outLines = await tx.productionOutputLine.findMany({ where: { output: { orderId: o.id } } });
    const workshop = roundMoney(sum(outLines.map((l) => dec(l.workshopRate?.toString() ?? '0').times(dec(l.approvedQty.toString()).plus(l.secondQty.toString())))));
    const units = sum(outLines.map((l) => dec(l.approvedQty.toString()).plus(l.secondQty.toString())));
    const overheadSetting = await tx.setting.findUnique({ where: { companyId_key: { companyId: ctx.companyId, key: 'production.overheadPerUnit' } } });
    const overhead = roundMoney(dec(String(overheadSetting?.value ?? 0)).times(units));
    const materials = dec(mat?.total?.toString() ?? '0');
    const r = actualUnitCost({ materials, workshop, overhead, goodUnits: units });
    return tx.productionCostSnapshot.create({
      data: {
        companyId: ctx.companyId, orderId: o.id, kind, materials: roundMoney(materials).toString(), workshop: workshop.toString(),
        overhead: overhead.toString(), total: r.total.toString(), goodUnits: units.toString(), unitCost: r.unitCost.toString(),
        detail: { scrapUnits: sum(outLines.map((l) => l.scrapQty.toString())).toString() }, computedBy: ctx.userId,
      },
    });
  }

  /** Consume el pendiente según la ficha (p. ej. cuando llegó la compra después del ingreso de prendas). */
  consumeBySheet(ctx: RequestContext, id: string) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        this.assertActive(o);
        const res = await this.consumeGap(tx, ctx, o, `Consumo según ficha ${o.number}`, false);
        if (!res.consumed) throw new DomainError(ErrorCodes.VALIDACION, 'No hay consumos pendientes: lo entregado cubre la ficha de las prendas ingresadas.');
        await this.audit.log(tx, ctx, { entity: 'production_order', entityId: id, action: 'consume_by_sheet', diff: { materials: res.consumed } });
        return this.detailInTx(tx, ctx, id);
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  close(ctx: RequestContext, id: string, input: { acceptPendingConsumption?: boolean; reason?: string | null } = {}) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        if (!['IN_PROGRESS', 'COMPLETED'].includes(o.status)) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Solo se cierran órdenes en curso o terminadas.');
        await this.assertNothingAtWorkshop(tx, o);
        // Sin consumo de materiales el costo real queda subvaluado: se exige registrarlo o justificarlo.
        const gaps = await this.consumptionGap(tx, o);
        if (gaps.length && !input.acceptPendingConsumption) {
          const items = await tx.item.findMany({ where: { id: { in: gaps.map((g) => g.materialItemId) } }, select: { id: true, sku: true } });
          throw new DomainError(
            ErrorCodes.VALIDACION,
            `Falta registrar el consumo de materiales según la ficha: ${gaps.map((g) => `${items.find((i) => i.id === g.materialItemId)?.sku} (${g.qty.toString()})`).join(', ')}. Usá «Consumir según ficha» (si el material todavía no está en stock, registrá antes la recepción de la compra) o cerrá indicando por qué se usó menos.`,
            422,
            { pendingConsumption: gaps.map((g) => ({ materialItemId: g.materialItemId, qty: g.qty.toString() })) },
          );
        }
        if (gaps.length && !input.reason?.trim()) throw new DomainError(ErrorCodes.VALIDACION, 'Indicá el motivo para cerrar sin registrar todo el consumo de materiales.');
        await this.releaseReservations(tx, ctx, o);
        await tx.workshopDispatch.updateMany({ where: { orderId: id, status: { in: ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'] } }, data: { status: 'CLOSED' } });
        const snap = await this.actualCost(tx, ctx, o, 'ACTUAL');
        await tx.productionOrder.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } } });
        await this.audit.log(tx, ctx, {
          entity: 'production_order', entityId: id, action: 'close',
          diff: { unitCost: snap.unitCost.toString(), total: snap.total.toString(), ...(gaps.length ? { pendingConsumption: gaps.map((g) => ({ materialItemId: g.materialItemId, qty: g.qty.toString() })) } : {}) },
          reason: gaps.length ? input.reason ?? undefined : undefined,
        });
        return { id, cost: snap };
      },
      { idempotent: true },
    );
  }

  cancel(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      assertTransition(o.status, 'CANCELLED');
      await this.assertNothingAtWorkshop(tx, o);
      await this.releaseReservations(tx, ctx, o);
      const consumed = o.requirements.some((r) => dec(r.consumedQty.toString()).gt(0));
      if (consumed) await this.actualCost(tx, ctx, o, 'CANCELLED');
      await tx.workshopDispatch.updateMany({ where: { orderId: id, status: { not: 'CLOSED' } }, data: { status: 'CLOSED' } });
      await tx.productionOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, closedAt: new Date(), version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { entity: 'production_order', entityId: id, action: 'cancel', reason });
      return { id, status: 'CANCELLED', materialsConsumed: consumed };
    });
  }

  // ─── Consultas ───

  list(ctx: RequestContext, q: { status?: string; q?: string; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.ProductionOrderWhereInput = {
        ...(q.status === 'ACTIVE' ? { status: { in: ['RELEASED', 'IN_PROGRESS', 'COMPLETED'] } } : q.status ? { status: q.status as never } : {}),
        ...(q.q ? { number: { contains: q.q, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.productionOrder.findMany({ where, include: { lines: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.productionOrder.count({ where }),
      ]);
      const products = await tx.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } });
      const today = businessDate();
      return {
        total,
        rows: rows.map(({ lines, ...r }) => ({
          ...r,
          product: products.find((p) => p.id === r.productId),
          planned: sum(lines.map((l) => l.plannedQty.toString())).toString(),
          done: sum(lines.map((l) => dec(l.goodQty.toString()).plus(l.secondQty.toString()).plus(l.scrapQty.toString()))).toString(),
          overdue: !!r.dueDate && r.dueDate < today && !['CLOSED', 'CANCELLED', 'COMPLETED'].includes(r.status),
        })),
      };
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, ctx, id));
  }

  private async detailInTx(tx: Tx, ctx: RequestContext, id: string) {
    const o = await tx.productionOrder.findUnique({ where: { id }, include: { lines: true, requirements: true, stages: { orderBy: { sortOrder: 'asc' } } } });
    if (!o) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La orden de producción no existe.', 404);
    const showCost = can(ctx, 'costs.view');
    const [product, variants, items, stages, dispatches, outputs, snapshots, sheetVersion] = await Promise.all([
      tx.product.findUniqueOrThrow({ where: { id: o.productId } }),
      tx.productVariant.findMany({ where: { productId: o.productId }, include: { item: { select: { sku: true, isActive: true } } } }),
      tx.item.findMany({ where: { id: { in: o.requirements.map((r) => r.materialItemId) } }, select: { id: true, sku: true, name: true, baseUomId: true } }),
      tx.productionStage.findMany(),
      tx.workshopDispatch.findMany({ where: { orderId: id }, include: { lines: true }, orderBy: { sentAt: 'asc' } }),
      tx.productionOutput.findMany({ where: { orderId: id }, include: { lines: true }, orderBy: { createdAt: 'asc' } }),
      tx.productionCostSnapshot.findMany({ where: { orderId: id }, orderBy: { computedAt: 'asc' } }),
      o.techSheetVersionId ? tx.techSheetVersion.findUnique({ where: { id: o.techSheetVersionId }, select: { versionNo: true } }) : null,
    ]);
    const [sizes, colors, uoms] = await Promise.all([
      tx.size.findMany({ where: { sizeScaleId: product.sizeScaleId }, orderBy: { sortOrder: 'asc' } }),
      tx.color.findMany({ where: { id: { in: [...new Set(variants.map((v) => v.colorId))] } }, orderBy: { name: 'asc' } }),
      tx.uom.findMany(),
    ]);
    const workshops = await tx.party.findMany({ where: { id: { in: [...dispatches.map((d) => d.workshopId), ...o.stages.map((s) => s.workshopId).filter((x): x is string => !!x)] } }, select: { id: true, legalName: true } });
    const requirements = [];
    for (const r of o.requirements) {
      const reserved = await this.stock.reservationPending(tx, r.reservationId);
      const available = await this.stock.available(tx, r.materialItemId, o.materialsWarehouseId);
      const pendingNeed = dec(r.requiredQty.toString()).minus(r.issuedQty.toString());
      const shortage = pendingNeed.minus(reserved).minus(available.gt(0) ? available : dec(0));
      const it = items.find((i) => i.id === r.materialItemId);
      requirements.push({
        ...r,
        item: it,
        uom: uoms.find((u) => u.id === it?.baseUomId)?.code,
        reservedPending: reserved.toString(),
        availableFree: available.toString(),
        shortage: shortage.gt(0) ? shortage.toString() : '0',
        deviation: deviationOf(o.status, r),
      });
    }
    return {
      ...o,
      product,
      techSheetVersionNo: sheetVersion?.versionNo ?? null,
      sizes: sizes.filter((s) => variants.some((v) => v.sizeId === s.id)).map((s) => ({ id: s.id, code: s.code })),
      colors: colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
      cells: variants.map((v) => ({ itemId: v.itemId, sizeId: v.sizeId, colorId: v.colorId, sku: v.item.sku, isActive: v.item.isActive })),
      requirements,
      pendingConsumption: (ACTIVE as readonly string[]).includes(o.status)
        ? (await this.consumptionGap(tx, o)).map((g) => ({ materialItemId: g.materialItemId, sku: items.find((i) => i.id === g.materialItemId)?.sku, qty: g.qty.toString() }))
        : [],
      stages: o.stages.map((s) => ({ ...s, stage: stages.find((x) => x.id === s.stageId), workshop: workshops.find((w) => w.id === s.workshopId) ?? null })),
      dispatches: dispatches.map((d) => ({ ...d, workshop: workshops.find((w) => w.id === d.workshopId) })),
      outputs: outputs.map((x) => ({
        ...x,
        lines: x.lines.map((l) => ({ ...l, unitCost: showCost ? l.unitCost : null, workshopRate: showCost ? l.workshopRate : null })),
      })),
      costs: showCost ? snapshots : [],
      estimatedUnitCost: showCost ? o.estimatedUnitCost : null,
    };
  }

  /** Vista del operario: órdenes con etapas abiertas, más urgentes primero. */
  myTasks(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const orders = await tx.productionOrder.findMany({
        where: { status: { in: ['RELEASED', 'IN_PROGRESS'] } },
        include: { stages: { orderBy: { sortOrder: 'asc' } }, lines: true },
        orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
        take: 100,
      });
      const [stages, products] = await Promise.all([
        tx.productionStage.findMany(),
        tx.product.findMany({ where: { id: { in: orders.map((o) => o.productId) } }, select: { id: true, name: true, code: true } }),
      ]);
      return orders.flatMap((o) => {
        const next = o.stages.find((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS');
        if (!next || next.workshopId) return [];
        return [{
          orderId: o.id, number: o.number, priority: o.priority, dueDate: o.dueDate, product: products.find((p) => p.id === o.productId),
          planned: sum(o.lines.map((l) => l.plannedQty.toString())).toString(),
          stage: { ...next, stage: stages.find((s) => s.id === next.stageId) },
        }];
      });
    });
  }

  /** Tablero de producción: datos reales, calculados al momento. */
  dashboard(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const today = businessDate();
      const [byStatus, overdue, active, dispatches] = await Promise.all([
        tx.productionOrder.groupBy({ by: ['status'], _count: true }),
        tx.productionOrder.findMany({
          where: { status: { in: ['RELEASED', 'IN_PROGRESS'] }, dueDate: { lt: today } },
          select: { id: true, number: true, dueDate: true, productId: true },
          orderBy: { dueDate: 'asc' },
          take: 20,
        }),
        tx.productionOrder.findMany({ where: { status: { in: ['RELEASED', 'IN_PROGRESS'] } }, include: { requirements: true } }),
        tx.workshopDispatch.findMany({ where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } }, include: { lines: true }, orderBy: { sentAt: 'asc' } }),
      ]);
      const shortages: { orderId: string; number: string; materialItemId: string; shortage: string }[] = [];
      for (const o of active) {
        for (const r of o.requirements) {
          const pendingNeed = dec(r.requiredQty.toString()).minus(r.issuedQty.toString());
          if (pendingNeed.lte(0)) continue;
          const reserved = await this.stock.reservationPending(tx, r.reservationId);
          if (reserved.gte(pendingNeed)) continue;
          const free = await this.stock.available(tx, r.materialItemId, o.materialsWarehouseId);
          const s = pendingNeed.minus(reserved).minus(free.gt(0) ? free : dec(0));
          if (s.gt(0)) shortages.push({ orderId: o.id, number: o.number, materialItemId: r.materialItemId, shortage: s.toString() });
        }
      }
      const items = await tx.item.findMany({ where: { id: { in: shortages.map((s) => s.materialItemId) } }, select: { id: true, sku: true, name: true } });
      const parties = await tx.party.findMany({ where: { id: { in: dispatches.map((d) => d.workshopId) } }, select: { id: true, legalName: true } });
      const orders = await tx.productionOrder.findMany({ where: { id: { in: dispatches.map((d) => d.orderId) } }, select: { id: true, number: true } });
      const products = await tx.product.findMany({ where: { id: { in: overdue.map((o) => o.productId) } }, select: { id: true, name: true } });
      return {
        byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count])),
        overdue: overdue.map((o) => ({ ...o, product: products.find((p) => p.id === o.productId)?.name })),
        shortages: shortages.map((s) => ({ ...s, item: items.find((i) => i.id === s.materialItemId) })),
        atWorkshops: dispatches.map((d) => {
          const garments = d.lines.filter((l) => l.kind === 'GARMENT');
          return {
            id: d.id, number: d.number, sentAt: d.sentAt, expectedAt: d.expectedAt, workshop: parties.find((p) => p.id === d.workshopId)?.legalName,
            order: orders.find((o) => o.id === d.orderId),
            pending: sum(garments.map((l) => dec(l.qty.toString()).minus(l.receivedQty.toString()))).toString(),
            late: !!d.expectedAt && d.expectedAt < today,
          };
        }),
      };
    });
  }
}
