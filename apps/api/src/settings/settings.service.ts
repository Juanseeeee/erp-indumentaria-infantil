import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import {
  CategoryCreateSchema,
  ColorCreateSchema,
  CostCenterCreateSchema,
  SeasonCreateSchema,
  SizeScaleCreateSchema,
  UomConversionCreateSchema,
  UomCreateSchema,
  WarehouseCreateSchema,
} from '@erp/contracts';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';

export const CompanyUpdateSchema = z.object({
  legalName: z.string().trim().min(1),
  tradeName: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
});
export const ApprovalRuleSchema = z.object({
  actionCode: z.enum(['inventory.adjust', 'purchasing.order', 'payables.payment']),
  threshold: z.union([z.string(), z.number()]).transform(String),
  isActive: z.boolean().default(true),
});
export const PaymentTermSchema = z.object({ name: z.string().trim().min(1), days: z.array(z.number().int().min(0).max(365)).min(1) });
export const ZoneSchema = z.object({ name: z.string().trim().min(1) });
export const CollectionSchema = z.object({ name: z.string().trim().min(1), seasonId: z.string().uuid() });

const REQUIRED_PERMISSION: Record<z.infer<typeof ApprovalRuleSchema>['actionCode'], string> = {
  'inventory.adjust': 'inventory.adjust.approve',
  'purchasing.order': 'purchasing.approve',
  'payables.payment': 'payables.approve',
};

/** Datos maestros configurables sin código. Cambios auditados. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  /** Todo lo que la UI necesita para formularios, en una sola llamada. */
  masterData(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const [uoms, conversions, colors, sizeScales, categories, seasons, collections, warehouses, paymentTerms, zones, costCenters] =
        await Promise.all([
          tx.uom.findMany({ orderBy: { code: 'asc' } }),
          tx.uomConversion.findMany(),
          tx.color.findMany({ orderBy: { name: 'asc' } }),
          tx.sizeScale.findMany({ include: { sizes: { orderBy: { sortOrder: 'asc' } } }, orderBy: { name: 'asc' } }),
          tx.category.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
          tx.season.findMany({ orderBy: [{ year: 'desc' }, { name: 'asc' }] }),
          tx.collection.findMany({ orderBy: { name: 'asc' } }),
          tx.warehouse.findMany({ orderBy: [{ type: 'asc' }, { code: 'asc' }] }),
          tx.paymentTerm.findMany({ orderBy: { name: 'asc' } }),
          tx.zone.findMany({ orderBy: { name: 'asc' } }),
          tx.costCenter.findMany({ orderBy: { code: 'asc' } }),
        ]);
      return { uoms, conversions, colors, sizeScales, categories, seasons, collections, warehouses, paymentTerms, zones, costCenters };
    });
  }

  company(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => ({
      company: await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } }),
      branches: await tx.branch.findMany(),
      approvalRules: await tx.approvalRule.findMany(),
    }));
  }

  updateCompany(ctx: RequestContext, input: z.infer<typeof CompanyUpdateSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const c = await tx.company.update({ where: { id: ctx.companyId }, data: input });
      await this.audit.log(tx, ctx, { entity: 'company', entityId: c.id, action: 'update', diff: input });
      return c;
    });
  }

  upsertApprovalRule(ctx: RequestContext, input: z.infer<typeof ApprovalRuleSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const r = await tx.approvalRule.upsert({
        where: { companyId_actionCode: { companyId: ctx.companyId, actionCode: input.actionCode } },
        create: { companyId: ctx.companyId, actionCode: input.actionCode, threshold: input.threshold, isActive: input.isActive, requiredPermission: REQUIRED_PERMISSION[input.actionCode] },
        update: { threshold: input.threshold, isActive: input.isActive },
      });
      await this.audit.log(tx, ctx, { entity: 'approval_rule', entityId: r.id, action: 'upsert', diff: input });
      return r;
    });
  }

  private create<T extends { id: string }>(ctx: RequestContext, entity: string, fn: (tx: Parameters<Parameters<UnitOfWork['run']>[1]>[0]) => Promise<T>) {
    return this.uow.run(ctx, async (tx) => {
      const row = await fn(tx);
      await this.audit.log(tx, ctx, { entity, entityId: row.id, action: 'create', diff: row });
      return row;
    });
  }

  createUom(ctx: RequestContext, input: z.infer<typeof UomCreateSchema>) {
    return this.create(ctx, 'uom', (tx) => tx.uom.create({ data: { ...input, companyId: ctx.companyId } }));
  }

  createConversion(ctx: RequestContext, input: z.infer<typeof UomConversionCreateSchema>) {
    if (input.fromUomId === input.toUomId) throw new DomainError(ErrorCodes.VALIDACION, 'Las unidades deben ser distintas.');
    return this.create(ctx, 'uom_conversion', async (tx) => {
      const [from, to] = await Promise.all([
        tx.uom.findUniqueOrThrow({ where: { id: input.fromUomId } }),
        tx.uom.findUniqueOrThrow({ where: { id: input.toUomId } }),
      ]);
      if (from.dimension !== to.dimension && !input.itemId) {
        throw new DomainError(
          ErrorCodes.CONVERSION_INCOMPATIBLE,
          `${from.code} y ${to.code} miden cosas distintas: solo se pueden convertir con un factor específico por artículo.`,
        );
      }
      return tx.uomConversion.create({ data: { ...input, itemId: input.itemId ?? null, companyId: ctx.companyId } });
    });
  }

  createColor(ctx: RequestContext, input: z.infer<typeof ColorCreateSchema>) {
    return this.create(ctx, 'color', (tx) => tx.color.create({ data: { ...input, code: input.code.toUpperCase(), companyId: ctx.companyId } }));
  }

  createSizeScale(ctx: RequestContext, input: z.infer<typeof SizeScaleCreateSchema>) {
    if (new Set(input.sizes.map((s) => s.toUpperCase())).size !== input.sizes.length) {
      throw new DomainError(ErrorCodes.DUPLICADO, 'Hay talles repetidos en la escala.');
    }
    return this.create(ctx, 'size_scale', (tx) =>
      tx.sizeScale.create({
        data: {
          companyId: ctx.companyId,
          name: input.name,
          sizes: { create: input.sizes.map((code, i) => ({ code, sortOrder: i + 1, companyId: ctx.companyId })) },
        },
        include: { sizes: true },
      }),
    );
  }

  /** Agrega talles al final de una escala existente (no se pueden quitar talles en uso). */
  addSizes(ctx: RequestContext, scaleId: string, sizes: string[]) {
    return this.uow.run(ctx, async (tx) => {
      const max = await tx.size.aggregate({ where: { sizeScaleId: scaleId }, _max: { sortOrder: true } });
      let order = max._max.sortOrder ?? 0;
      for (const code of sizes) {
        await tx.size.create({ data: { companyId: ctx.companyId, sizeScaleId: scaleId, code, sortOrder: ++order } });
      }
      await this.audit.log(tx, ctx, { entity: 'size_scale', entityId: scaleId, action: 'add_sizes', diff: sizes });
      return tx.sizeScale.findUniqueOrThrow({ where: { id: scaleId }, include: { sizes: { orderBy: { sortOrder: 'asc' } } } });
    });
  }

  createCategory(ctx: RequestContext, input: z.infer<typeof CategoryCreateSchema>) {
    return this.create(ctx, 'category', (tx) => tx.category.create({ data: { ...input, parentId: input.parentId ?? null, companyId: ctx.companyId } }));
  }

  createSeason(ctx: RequestContext, input: z.infer<typeof SeasonCreateSchema>) {
    return this.create(ctx, 'season', (tx) => tx.season.create({ data: { ...input, companyId: ctx.companyId } }));
  }

  createCollection(ctx: RequestContext, input: z.infer<typeof CollectionSchema>) {
    return this.create(ctx, 'collection', (tx) => tx.collection.create({ data: { ...input, companyId: ctx.companyId } }));
  }

  createWarehouse(ctx: RequestContext, input: z.infer<typeof WarehouseCreateSchema>) {
    if (input.type === 'WORKSHOP') {
      throw new DomainError(ErrorCodes.VALIDACION, 'Los depósitos de taller se crean automáticamente al dar de alta un taller.');
    }
    return this.create(ctx, 'warehouse', (tx) =>
      tx.warehouse.create({ data: { ...input, code: input.code.toUpperCase(), partyId: null, companyId: ctx.companyId } }),
    );
  }

  setWarehouseActive(ctx: RequestContext, id: string, isActive: boolean) {
    return this.uow.run(ctx, async (tx) => {
      if (!isActive) {
        const stock = await tx.stockBalance.findFirst({ where: { warehouseId: id, OR: [{ onHand: { not: 0 } }, { reserved: { not: 0 } }] } });
        if (stock) throw new DomainError(ErrorCodes.VALIDACION, 'No se puede desactivar un depósito con stock. Transferilo primero.');
      }
      const w = await tx.warehouse.update({ where: { id }, data: { isActive } });
      await this.audit.log(tx, ctx, { entity: 'warehouse', entityId: id, action: isActive ? 'activate' : 'deactivate' });
      return w;
    });
  }

  createPaymentTerm(ctx: RequestContext, input: z.infer<typeof PaymentTermSchema>) {
    return this.create(ctx, 'payment_term', (tx) => tx.paymentTerm.create({ data: { ...input, companyId: ctx.companyId } }));
  }

  createCostCenter(ctx: RequestContext, input: z.infer<typeof CostCenterCreateSchema>) {
    return this.create(ctx, 'cost_center', (tx) => tx.costCenter.create({ data: { ...input, companyId: ctx.companyId } }));
  }

  createZone(ctx: RequestContext, input: z.infer<typeof ZoneSchema>) {
    return this.create(ctx, 'zone', (tx) => tx.zone.create({ data: { ...input, companyId: ctx.companyId } }));
  }

  auditLog(ctx: RequestContext, q: { entity?: string; entityId?: string; page: number }) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { ...(q.entity ? { entity: q.entity } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
        orderBy: { at: 'desc' },
        skip: (q.page - 1) * 100,
        take: 100,
      });
      const users = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM users WHERE id = ANY(${[...new Set(rows.map((r) => r.userId).filter(Boolean))]}::uuid[])`;
      return rows.map((r) => ({ ...r, id: r.id.toString(), user: users.find((u) => u.id === r.userId)?.name ?? null }));
    });
  }
}
