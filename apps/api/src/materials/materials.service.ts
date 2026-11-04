import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { ListQuerySchema, MaterialUpsertInput, MaterialUpsertSchema } from '@erp/contracts';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, shallowDiff } from '../common/common.service';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';

const MaterialListQuery = ListQuerySchema.extend({ categoryId: z.string().uuid().optional() });

@Injectable()
export class MaterialsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext, q: z.infer<typeof MaterialListQuery>) {
    const showCost = can(ctx, 'costs.view');
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.MaterialWhereInput = {
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        item: {
          ...(q.includeInactive ? {} : { isActive: true }),
          ...(q.q
            ? { OR: [{ sku: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }, { barcode: q.q }] }
            : {}),
        },
      };
      const [rows, total] = await Promise.all([
        tx.material.findMany({
          where,
          include: { item: true },
          orderBy: { item: { sku: 'asc' } },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.material.count({ where }),
      ]);
      return { total, rows: rows.map((m) => ({ ...m, lastCost: showCost ? m.lastCost : null })) };
    });
  }

  get(ctx: RequestContext, id: string) {
    const showCost = can(ctx, 'costs.view');
    return this.uow.run(ctx, async (tx) => {
      const m = await tx.material.findUnique({ where: { itemId: id }, include: { item: true } });
      if (!m) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El material no existe.', 404);
      return { ...m, lastCost: showCost ? m.lastCost : null };
    });
  }

  create(ctx: RequestContext, input: MaterialUpsertInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const item = await tx.item.create({
          data: {
            companyId: ctx.companyId,
            kind: 'MATERIAL',
            sku: input.sku.toUpperCase(),
            name: input.name,
            barcode: input.barcode || null,
            baseUomId: input.baseUomId,
            trackLots: input.trackLots,
            minStock: input.minStock ?? null,
            reorderQty: input.reorderQty ?? null,
          },
        });
        const m = await tx.material.create({ data: { itemId: item.id, companyId: ctx.companyId, ...this.materialData(input) } });
        await this.audit.log(tx, ctx, { entity: 'material', entityId: item.id, action: 'create', diff: input });
        return { ...m, item };
      },
      { idempotent: true },
    );
  }

  update(ctx: RequestContext, id: string, input: MaterialUpsertInput) {
    return this.uow.run(ctx, async (tx) => {
      const before = await tx.item.findUnique({ where: { id }, include: { material: true } });
      if (!before?.material) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El material no existe.', 404);
      if (before.baseUomId !== input.baseUomId) {
        const moved = await tx.stockMovement.findFirst({ where: { itemId: id }, select: { id: true } });
        if (moved) {
          throw new DomainError(
            ErrorCodes.VALIDACION,
            'No se puede cambiar la unidad base de un material con movimientos de stock.',
          );
        }
      }
      const itemData = {
        sku: input.sku.toUpperCase(),
        name: input.name,
        barcode: input.barcode || null,
        baseUomId: input.baseUomId,
        trackLots: input.trackLots,
        minStock: input.minStock ?? null,
        reorderQty: input.reorderQty ?? null,
      };
      await tx.item.update({ where: { id }, data: itemData });
      await tx.material.update({ where: { itemId: id }, data: this.materialData(input) });
      await this.audit.log(tx, ctx, { entity: 'material', entityId: id, action: 'update', diff: shallowDiff(before, itemData) });
      return tx.material.findUniqueOrThrow({ where: { itemId: id }, include: { item: true } });
    });
  }

  private materialData(input: MaterialUpsertInput) {
    return {
      categoryId: input.categoryId ?? null,
      defaultSupplierId: input.defaultSupplierId ?? null,
      purchaseUomId: input.purchaseUomId ?? null,
      fabricWidthCm: input.fabricWidthCm ?? null,
      composition: input.composition,
      weightGsm: input.weightGsm ?? null,
      colorId: input.colorId ?? null,
    };
  }
}

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @RequirePermissions('materials.view')
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(MaterialListQuery)) q: z.infer<typeof MaterialListQuery>) {
    return this.materials.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('materials.view')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.materials.get(ctx, id);
  }

  @Post()
  @RequirePermissions('materials.create')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(MaterialUpsertSchema)) body: MaterialUpsertInput) {
    return this.materials.create(ctx, body);
  }

  @Put(':id')
  @RequirePermissions('materials.edit')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(MaterialUpsertSchema)) body: MaterialUpsertInput,
  ) {
    return this.materials.update(ctx, id, body);
  }
}
