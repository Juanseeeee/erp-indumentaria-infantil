import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_SKU_PATTERN, DomainError, ErrorCodes, buildInternalEan13, buildSku } from '@erp/domain-core';
import {
  ListQuerySchema,
  ProductAddVariantsSchema,
  ProductCreateInput,
  ProductUpdateSchema,
  VariantPatchSchema,
} from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService, shallowDiff } from '../common/common.service';

const ProductListQuery = ListQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
  collectionId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'DISCONTINUED']).optional(),
});
export { ProductListQuery };

@Injectable()
export class CatalogService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext, q: z.infer<typeof ProductListQuery>) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.ProductWhereInput = {
        ...(q.status ? { status: q.status } : q.includeInactive ? {} : { status: { not: 'DISCONTINUED' } }),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.collectionId ? { collectionId: q.collectionId } : {}),
        ...(q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.product.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { _count: { select: { variants: true } } },
        }),
        tx.product.count({ where }),
      ]);
      const stock = await tx.$queryRaw<{ product_id: string; on_hand: string; available: string }[]>`
        SELECT pv.product_id, COALESCE(SUM(b.on_hand), 0)::text AS on_hand, COALESCE(SUM(b.on_hand - b.reserved), 0)::text AS available
        FROM product_variants pv LEFT JOIN stock_balances b ON b.item_id = pv.item_id
        WHERE pv.product_id = ANY(${rows.map((r) => r.id)}::uuid[])
        GROUP BY pv.product_id`;
      return {
        total,
        rows: rows.map((r) => ({
          ...r,
          variantCount: r._count.variants,
          onHand: stock.find((s) => s.product_id === r.id)?.on_hand ?? '0',
          available: stock.find((s) => s.product_id === r.id)?.available ?? '0',
        })),
      };
    });
  }

  create(ctx: RequestContext, input: ProductCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const code = input.code.toUpperCase();
        const product = await tx.product.create({
          data: {
            companyId: ctx.companyId,
            code,
            name: input.name,
            description: input.description,
            categoryId: input.categoryId ?? null,
            collectionId: input.collectionId ?? null,
            sizeScaleId: input.sizeScaleId,
            status: input.status,
            materialText: input.materialText,
          },
        });
        const scale = await tx.sizeScale.findUniqueOrThrow({ where: { id: input.sizeScaleId }, include: { sizes: true } });
        const sizes = input.sizeIds?.length ? scale.sizes.filter((s) => input.sizeIds!.includes(s.id)) : scale.sizes;
        if (!sizes.length) throw new DomainError(ErrorCodes.VALIDACION, 'Los talles elegidos no pertenecen a la escala.');
        const created = await this.generateVariants(tx, ctx, product.id, input.colorIds, sizes.map((s) => s.id));
        await this.audit.log(tx, ctx, {
          entity: 'product',
          entityId: product.id,
          action: 'create',
          diff: { code, name: input.name, variants: created },
        });
        return { ...product, variantsCreated: created };
      },
      { idempotent: true },
    );
  }

  update(ctx: RequestContext, id: string, input: z.infer<typeof ProductUpdateSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El modelo no existe.', 404);
      const { version, ...data } = input;
      const res = await tx.product.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
      if (!res.count) throw new DomainError(ErrorCodes.CONFLICTO_VERSION, 'Otro usuario modificó el modelo. Recargá.', 409);
      // Nombre del modelo cambia → nombre de las variantes también (el SKU NO cambia).
      if (data.name !== before.name) await this.renameVariants(tx, id);
      await this.audit.log(tx, ctx, { entity: 'product', entityId: id, action: 'update', diff: shallowDiff(before, data) });
      return tx.product.findUniqueOrThrow({ where: { id } });
    });
  }

  addVariants(ctx: RequestContext, id: string, input: z.infer<typeof ProductAddVariantsSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id }, include: { variants: true } });
      const scale = await tx.size.findMany({ where: { sizeScaleId: product.sizeScaleId } });
      const currentColors = [...new Set(product.variants.map((v) => v.colorId))];
      const currentSizes = [...new Set(product.variants.map((v) => v.sizeId))];
      const colors = [...new Set([...currentColors, ...input.colorIds])];
      const sizes = [...new Set([...currentSizes, ...input.sizeIds])];
      if (sizes.some((s) => !scale.find((x) => x.id === s))) {
        throw new DomainError(ErrorCodes.VALIDACION, 'Hay talles que no pertenecen a la escala del modelo.');
      }
      const created = await this.generateVariants(tx, ctx, id, colors, sizes);
      await this.audit.log(tx, ctx, { entity: 'product', entityId: id, action: 'add_variants', diff: { created } });
      return { variantsCreated: created };
    });
  }

  /** Crea las combinaciones talle×color que falten. Idempotente: no duplica existentes. */
  private async generateVariants(tx: Tx, ctx: RequestContext, productId: string, colorIds: string[], sizeIds: string[]) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: { variants: true } });
    const [colors, sizes, unit, setting] = await Promise.all([
      tx.color.findMany({ where: { id: { in: colorIds } } }),
      tx.size.findMany({ where: { id: { in: sizeIds } } }),
      tx.uom.findFirst({ where: { dimension: 'UNIT', code: 'un' } }),
      tx.setting.findUnique({ where: { companyId_key: { companyId: ctx.companyId, key: 'catalog.skuPattern' } } }),
    ]);
    if (colors.length !== colorIds.length) throw new DomainError(ErrorCodes.VALIDACION, 'Hay colores inexistentes.');
    if (!unit) throw new DomainError(ErrorCodes.VALIDACION, 'Falta configurar la unidad "un" (unidades).');
    const pattern = typeof setting?.value === 'string' ? setting.value : DEFAULT_SKU_PATTERN;

    let created = 0;
    for (const color of colors) {
      for (const size of sizes) {
        if (product.variants.some((v) => v.colorId === color.id && v.sizeId === size.id)) continue;
        const seq = Number(await this.numbering.next(tx, ctx.companyId, 'BARCODE', '', 1));
        const item = await tx.item.create({
          data: {
            companyId: ctx.companyId,
            kind: 'VARIANT',
            sku: buildSku(pattern, { model: product.code, color: color.code, size: size.code }),
            barcode: buildInternalEan13(seq),
            name: `${product.name} ${color.name} ${size.code}`,
            baseUomId: unit.id,
          },
        });
        await tx.productVariant.create({
          data: { itemId: item.id, companyId: ctx.companyId, productId, sizeId: size.id, colorId: color.id },
        });
        created++;
      }
    }
    return created;
  }

  private async renameVariants(tx: Tx, productId: string) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const variants = await tx.productVariant.findMany({ where: { productId } });
    const [colors, sizes] = await Promise.all([
      tx.color.findMany({ where: { id: { in: variants.map((v) => v.colorId) } } }),
      tx.size.findMany({ where: { id: { in: variants.map((v) => v.sizeId) } } }),
    ]);
    for (const v of variants) {
      const c = colors.find((x) => x.id === v.colorId)!;
      const s = sizes.find((x) => x.id === v.sizeId)!;
      await tx.item.update({ where: { id: v.itemId }, data: { name: `${product.name} ${c.name} ${s.code}` } });
    }
  }

  /**
   * Matriz talle × color de un modelo, con stock por celda.
   * Es la vista central del catálogo (y la base de la grilla de pedidos y OP).
   */
  matrix(ctx: RequestContext, productId: string, warehouseId?: string) {
    return this.uow.run(ctx, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El modelo no existe.', 404);
      const variants = await tx.productVariant.findMany({ where: { productId }, include: { item: true } });
      const [sizes, colors, balances] = await Promise.all([
        tx.size.findMany({ where: { sizeScaleId: product.sizeScaleId }, orderBy: { sortOrder: 'asc' } }),
        tx.color.findMany({ where: { id: { in: [...new Set(variants.map((v) => v.colorId))] } }, orderBy: { name: 'asc' } }),
        tx.stockBalance.groupBy({
          by: ['itemId'],
          where: { itemId: { in: variants.map((v) => v.itemId) }, ...(warehouseId ? { warehouseId } : {}) },
          _sum: { onHand: true, reserved: true },
        }),
      ]);
      const usedSizes = sizes.filter((s) => variants.some((v) => v.sizeId === s.id));
      return {
        product,
        sizes: usedSizes.map((s) => ({ id: s.id, code: s.code })),
        availableSizes: sizes.map((s) => ({ id: s.id, code: s.code })),
        colors: colors.map((c) => ({ id: c.id, code: c.code, name: c.name, hex: c.hex })),
        cells: variants.map((v) => {
          const b = balances.find((x) => x.itemId === v.itemId);
          const onHand = b?._sum.onHand ?? new Prisma.Decimal(0);
          const reserved = b?._sum.reserved ?? new Prisma.Decimal(0);
          return {
            itemId: v.itemId,
            sizeId: v.sizeId,
            colorId: v.colorId,
            sku: v.item.sku,
            barcode: v.item.barcode,
            isActive: v.item.isActive,
            minStock: v.item.minStock?.toString() ?? null,
            onHand: onHand.toString(),
            reserved: reserved.toString(),
            available: onHand.minus(reserved).toString(),
          };
        }),
      };
    });
  }

  patchVariants(ctx: RequestContext, productId: string, input: z.infer<typeof VariantPatchSchema>) {
    return this.uow.run(ctx, async (tx) => {
      const variantIds = new Set(
        (await tx.productVariant.findMany({ where: { productId }, select: { itemId: true } })).map((v) => v.itemId),
      );
      for (const u of input.updates) {
        if (!variantIds.has(u.itemId)) throw new DomainError(ErrorCodes.VALIDACION, 'Hay variantes que no pertenecen al modelo.');
        const before = await tx.item.findUniqueOrThrow({ where: { id: u.itemId } });
        const data: Prisma.ItemUpdateInput = {};
        if (u.isActive !== undefined) data.isActive = u.isActive;
        if (u.barcode !== undefined) data.barcode = u.barcode || null;
        if (u.minStock !== undefined) data.minStock = u.minStock;
        await tx.item.update({ where: { id: u.itemId }, data });
        await this.audit.log(tx, ctx, {
          entity: 'item',
          entityId: u.itemId,
          action: 'update',
          diff: shallowDiff(before, { isActive: u.isActive ?? before.isActive, barcode: u.barcode ?? before.barcode }),
        });
      }
      return { updated: input.updates.length };
    });
  }
}
