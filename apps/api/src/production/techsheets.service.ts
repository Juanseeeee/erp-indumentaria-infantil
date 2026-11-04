import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, ErrorCodes, dec } from '@erp/domain-core';
import { estimateUnitCost, type BomLine } from '@erp/domain-production';
import type { TechSheetVersionSaveInput } from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';

type MaterialRow = Prisma.TechSheetMaterialGetPayload<object>;

export function toBomLines(rows: MaterialRow[]): BomLine[] {
  return rows.map((m) => ({
    materialItemId: m.materialItemId,
    byGarmentColor: m.byGarmentColor,
    colorMap: (m.colorMap ?? {}) as Record<string, string>,
    qtyPerUnit: m.qtyPerUnit.toString(),
    sizeQty: Object.fromEntries(Object.entries((m.sizeQty ?? {}) as Record<string, string>).map(([k, v]) => [k, String(v)])),
    wastePct: m.wastePct.toString(),
  }));
}

/**
 * Fichas técnicas versionadas. Una versión ACTIVE es inmutable: editar crea un borrador nuevo.
 * Las órdenes de producción guardan la versión con la que se liberaron, así los costos históricos no cambian.
 */
@Injectable()
export class TechSheetsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  get(ctx: RequestContext, productId: string) {
    return this.uow.run(ctx, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El modelo no existe.', 404);
      const sheet = await tx.techSheet.findUnique({
        where: { productId },
        include: { versions: { include: { materials: { orderBy: { sortOrder: 'asc' } } }, orderBy: { versionNo: 'desc' } } },
      });
      const materialIds = [
        ...new Set(
          (sheet?.versions ?? []).flatMap((v) =>
            v.materials.flatMap((m) => [m.materialItemId, ...Object.values((m.colorMap ?? {}) as Record<string, string>)]).filter((x): x is string => !!x),
          ),
        ),
      ];
      const items = await tx.item.findMany({ where: { id: { in: materialIds } }, select: { id: true, sku: true, name: true, baseUomId: true } });
      const variants = await tx.productVariant.findMany({ where: { productId }, select: { colorId: true, sizeId: true } });
      const estimate = sheet?.currentVersionId ? await this.estimate(tx, ctx, productId, sheet.currentVersionId) : null;
      return {
        product,
        sheet: sheet
          ? {
              ...sheet,
              versions: sheet.versions.map((v) => ({
                ...v,
                materials: v.materials.map((m) => ({ ...m, qtyPerUnit: m.qtyPerUnit.toString(), wastePct: m.wastePct.toString() })),
              })),
            }
          : null,
        items,
        colorIds: [...new Set(variants.map((v) => v.colorId))],
        sizeIds: [...new Set(variants.map((v) => v.sizeId))],
        estimate,
      };
    });
  }

  /** Guarda el borrador: si no hay, lo crea como versión siguiente (copiando nada: se envía completo). */
  saveDraft(ctx: RequestContext, productId: string, input: TechSheetVersionSaveInput) {
    return this.uow.run(ctx, async (tx) => {
      await this.validate(tx, productId, input);
      const sheet =
        (await tx.techSheet.findUnique({ where: { productId } })) ?? (await tx.techSheet.create({ data: { companyId: ctx.companyId, productId } }));
      let draft = await tx.techSheetVersion.findFirst({ where: { techSheetId: sheet.id, status: 'DRAFT' } });
      if (!draft) {
        const last = await tx.techSheetVersion.aggregate({ where: { techSheetId: sheet.id }, _max: { versionNo: true } });
        draft = await tx.techSheetVersion.create({
          data: { companyId: ctx.companyId, techSheetId: sheet.id, versionNo: (last._max.versionNo ?? 0) + 1, createdBy: ctx.userId },
        });
      }
      await tx.techSheetMaterial.deleteMany({ where: { versionId: draft.id } });
      await tx.techSheetMaterial.createMany({
        data: input.materials.map((m, i) => ({
          companyId: ctx.companyId,
          versionId: draft!.id,
          materialItemId: m.byGarmentColor ? null : m.materialItemId!,
          byGarmentColor: m.byGarmentColor,
          colorMap: m.colorMap,
          qtyPerUnit: m.qtyPerUnit,
          sizeQty: m.sizeQty,
          wastePct: m.wastePct,
          notes: m.notes,
          sortOrder: i,
        })),
      });
      await tx.techSheetVersion.update({ where: { id: draft.id }, data: { stageIds: input.stageIds, instructions: input.instructions } });
      await this.audit.log(tx, ctx, { entity: 'tech_sheet', entityId: sheet.id, action: 'save_draft', diff: { versionNo: draft.versionNo } });
      return { versionId: draft.id, versionNo: draft.versionNo };
    });
  }

  /** Activa el borrador: pasa a ser la versión vigente; la anterior queda archivada (no se borra). */
  activate(ctx: RequestContext, productId: string) {
    return this.uow.run(ctx, async (tx) => {
      const sheet = await tx.techSheet.findUnique({ where: { productId } });
      const draft = sheet ? await tx.techSheetVersion.findFirst({ where: { techSheetId: sheet.id, status: 'DRAFT' }, include: { materials: true } }) : null;
      if (!sheet || !draft) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'No hay un borrador de ficha para activar.');
      if (!draft.materials.length) throw new DomainError(ErrorCodes.VALIDACION, 'La ficha no tiene materiales.');
      // Todos los colores del modelo deben tener material en las líneas por color.
      const colors = [...new Set((await tx.productVariant.findMany({ where: { productId }, select: { colorId: true } })).map((v) => v.colorId))];
      for (const m of draft.materials.filter((x) => x.byGarmentColor)) {
        const missing = colors.filter((c) => !(m.colorMap as Record<string, string>)[c]);
        if (missing.length) {
          const names = await tx.color.findMany({ where: { id: { in: missing } }, select: { name: true } });
          throw new DomainError(ErrorCodes.VALIDACION, `Falta indicar el material para: ${names.map((n) => n.name).join(', ')}.`);
        }
      }
      await tx.techSheetVersion.updateMany({ where: { techSheetId: sheet.id, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
      await tx.techSheetVersion.update({ where: { id: draft.id }, data: { status: 'ACTIVE', activatedAt: new Date(), activatedBy: ctx.userId } });
      await tx.techSheet.update({ where: { id: sheet.id }, data: { currentVersionId: draft.id } });
      await this.audit.log(tx, ctx, { entity: 'tech_sheet', entityId: sheet.id, action: 'activate', diff: { versionNo: draft.versionNo } });
      return { versionId: draft.id, versionNo: draft.versionNo };
    });
  }

  /** Costo estimado por variante con la versión indicada, a costo promedio actual de los materiales. */
  async estimate(tx: Tx, ctx: RequestContext, productId: string, versionId: string, workshopRate = '0') {
    const materials = await tx.techSheetMaterial.findMany({ where: { versionId } });
    const bom = toBomLines(materials);
    const materialIds = [...new Set(materials.flatMap((m) => [m.materialItemId, ...Object.values(m.colorMap as Record<string, string>)]).filter((x): x is string => !!x))];
    const costs = await tx.$queryRaw<{ item_id: string; cost: Prisma.Decimal | null }[]>`
      SELECT item_id, CASE WHEN SUM(on_hand) > 0 THEN SUM(on_hand * avg_cost) / SUM(on_hand) ELSE MAX(avg_cost) END AS cost
      FROM stock_balances WHERE item_id = ANY(${materialIds}::uuid[]) GROUP BY item_id`;
    const lastCosts = await tx.material.findMany({ where: { itemId: { in: materialIds } }, select: { itemId: true, lastCost: true } });
    const costMap: Record<string, string> = {};
    for (const id of materialIds) {
      const c = costs.find((x) => x.item_id === id)?.cost;
      costMap[id] = c && !c.isZero() ? c.toString() : (lastCosts.find((x) => x.itemId === id)?.lastCost?.toString() ?? '0');
    }
    const variants = await tx.productVariant.findMany({ where: { productId }, include: { item: { select: { sku: true } } } });
    const showCost = can(ctx, 'costs.view');
    const missingCost = materialIds.filter((id) => dec(costMap[id]!).isZero());
    return {
      missingCostItemIds: missingCost,
      variants: variants.map((v) => {
        try {
          const e = estimateUnitCost(bom, { sizeId: v.sizeId, colorId: v.colorId }, costMap, workshopRate);
          return { itemId: v.itemId, sku: v.item.sku, materials: showCost ? e.materials.toString() : null, total: showCost ? e.total.toString() : null, error: null };
        } catch (err) {
          return { itemId: v.itemId, sku: v.item.sku, materials: null, total: null, error: (err as Error).message };
        }
      }),
    };
  }

  private async validate(tx: Tx, productId: string, input: TechSheetVersionSaveInput) {
    const ids = [...new Set(input.materials.flatMap((m) => [m.materialItemId, ...Object.values(m.colorMap)]).filter((x): x is string => !!x))];
    const found = await tx.material.findMany({ where: { itemId: { in: ids } }, select: { itemId: true } });
    if (found.length !== ids.length) throw new DomainError(ErrorCodes.VALIDACION, 'La ficha usa artículos que no son materias primas.');
    if (input.stageIds.length) {
      const st = await tx.productionStage.count({ where: { id: { in: input.stageIds } } });
      if (st !== new Set(input.stageIds).size) throw new DomainError(ErrorCodes.VALIDACION, 'Hay etapas inexistentes.');
    }
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const sizeIds = (await tx.size.findMany({ where: { sizeScaleId: product.sizeScaleId }, select: { id: true } })).map((s) => s.id);
    for (const m of input.materials) {
      if (Object.keys(m.sizeQty).some((s) => !sizeIds.includes(s))) throw new DomainError(ErrorCodes.VALIDACION, 'Hay consumos por talle para talles de otra escala.');
    }
  }
}
