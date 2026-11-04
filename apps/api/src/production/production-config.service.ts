import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { DefectReasonSchema, ProductionStageSchema, WorkshopRateSchema } from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';

/** Configuración de producción: etapas, motivos de falla y tarifas de taller por prenda. */
@Injectable()
export class ProductionConfigService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  get(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const [stages, defectReasons, rates, workshops] = await Promise.all([
        tx.productionStage.findMany({ orderBy: { sortOrder: 'asc' } }),
        tx.defectReason.findMany({ orderBy: { name: 'asc' } }),
        tx.workshopRate.findMany({ orderBy: [{ validFrom: 'desc' }] }),
        tx.party.findMany({
          where: { isActive: true, roles: { some: { role: 'WORKSHOP' } } },
          select: { id: true, code: true, legalName: true },
          orderBy: { legalName: 'asc' },
        }),
      ]);
      const products = await tx.product.findMany({ where: { id: { in: rates.map((r) => r.productId) } }, select: { id: true, code: true, name: true } });
      return {
        stages,
        defectReasons,
        workshops,
        rates: rates.map((r) => ({
          ...r,
          price: r.price.toString(),
          product: products.find((p) => p.id === r.productId),
          workshop: workshops.find((w) => w.id === r.workshopId),
        })),
      };
    });
  }

  upsertStage(ctx: RequestContext, input: z.infer<typeof ProductionStageSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const s = await tx.productionStage.upsert({
        where: { companyId_code: { companyId: ctx.companyId, code: input.code } },
        create: { ...input, companyId: ctx.companyId },
        update: { name: input.name, sortOrder: input.sortOrder, isExternal: input.isExternal },
      });
      await this.audit.log(tx, ctx, { entity: 'production_stage', entityId: s.id, action: 'upsert', diff: input });
      return s;
    });
  }

  createDefectReason(ctx: RequestContext, input: z.infer<typeof DefectReasonSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const r = await tx.defectReason.create({ data: { ...input, companyId: ctx.companyId } });
      await this.audit.log(tx, ctx, { entity: 'defect_reason', entityId: r.id, action: 'create', diff: input });
      return r;
    });
  }

  /** Nueva tarifa (no se pisa la anterior: queda el historial y vale la vigente a cada fecha). */
  createRate(ctx: RequestContext, input: z.infer<typeof WorkshopRateSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const ws = await tx.party.findUnique({ where: { id: input.workshopId }, include: { roles: true } });
      if (!ws?.roles.some((r) => r.role === 'WORKSHOP')) throw new DomainError(ErrorCodes.VALIDACION, 'El tercero elegido no es un taller.');
      const r = await tx.workshopRate.create({
        data: { companyId: ctx.companyId, workshopId: input.workshopId, productId: input.productId, price: input.price, validFrom: input.validFrom, createdBy: ctx.userId },
      });
      await this.audit.log(tx, ctx, { entity: 'workshop_rate', entityId: r.id, action: 'create', diff: input });
      return r;
    });
  }
}

/** Tarifa del taller por prenda de un modelo vigente a una fecha. */
export async function currentWorkshopRate(tx: Tx, workshopId: string, productId: string, at = new Date()) {
  return tx.workshopRate.findFirst({
    where: { workshopId, productId, validFrom: { lte: at } },
    orderBy: { validFrom: 'desc' },
  });
}
