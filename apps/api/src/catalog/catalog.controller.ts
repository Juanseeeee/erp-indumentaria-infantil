import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ProductAddVariantsSchema,
  ProductCreateInput,
  ProductCreateSchema,
  ProductUpdateSchema,
  VariantPatchSchema,
} from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { CatalogService, ProductListQuery } from './catalog.service';

const MatrixQuery = z.object({ warehouseId: z.string().uuid().optional() });

@Controller('catalog/products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermissions('catalog.view')
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ProductListQuery)) q: z.infer<typeof ProductListQuery>) {
    return this.catalog.list(ctx, q);
  }

  @Post()
  @RequirePermissions('catalog.create')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ProductCreateSchema)) body: ProductCreateInput) {
    return this.catalog.create(ctx, body);
  }

  @Put(':id')
  @RequirePermissions('catalog.edit')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ProductUpdateSchema)) body: z.infer<typeof ProductUpdateSchema>,
  ) {
    return this.catalog.update(ctx, id, body);
  }

  @Get(':id/matrix')
  @RequirePermissions('catalog.view')
  matrix(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(MatrixQuery)) q: z.infer<typeof MatrixQuery>,
  ) {
    return this.catalog.matrix(ctx, id, q.warehouseId);
  }

  @Post(':id/variants')
  @RequirePermissions('catalog.edit')
  addVariants(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ProductAddVariantsSchema)) body: z.infer<typeof ProductAddVariantsSchema>,
  ) {
    return this.catalog.addVariants(ctx, id, body);
  }

  @Patch(':id/variants')
  @RequirePermissions('catalog.edit')
  patchVariants(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(VariantPatchSchema)) body: z.infer<typeof VariantPatchSchema>,
  ) {
    return this.catalog.patchVariants(ctx, id, body);
  }
}
