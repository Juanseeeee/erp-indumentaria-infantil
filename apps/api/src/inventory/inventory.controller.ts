import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CountCreateSchema,
  CountLinesPatchSchema,
  KardexQuerySchema,
  StockDocumentCreateInput,
  StockDocumentCreateSchema,
  StockQuerySchema,
} from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { StockDocumentsService } from './stock-documents.service';
import { InventoryQueryService } from './inventory-query.service';

const DocListQuery = z.object({
  type: z.enum(['OPENING', 'ADJUSTMENT', 'TRANSFER']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const VoidSchema = z.object({ reason: z.string().trim().min(3, 'Indicá el motivo de la anulación') });

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly docs: StockDocumentsService,
    private readonly query: InventoryQueryService,
  ) {}

  @Get('stock')
  @RequirePermissions('inventory.view')
  stock(@Ctx() ctx: RequestContext, @Query(new ZodPipe(StockQuerySchema)) q: z.infer<typeof StockQuerySchema>) {
    return this.query.balances(ctx, q);
  }

  @Get('summary')
  @RequirePermissions('inventory.view')
  summary(@Ctx() ctx: RequestContext) {
    return this.query.summary(ctx);
  }

  @Get('stock/:itemId')
  @RequirePermissions('inventory.view')
  itemStock(@Ctx() ctx: RequestContext, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.query.itemBalances(ctx, itemId);
  }

  @Get('kardex')
  @RequirePermissions('inventory.view')
  kardex(@Ctx() ctx: RequestContext, @Query(new ZodPipe(KardexQuerySchema)) q: z.infer<typeof KardexQuerySchema>) {
    return this.query.kardex(ctx, q);
  }

  @Get('reconciliation')
  @RequirePermissions('inventory.view', 'audit.view')
  reconcile(@Ctx() ctx: RequestContext) {
    return this.query.reconcile(ctx);
  }

  // Documentos: el permiso específico (opening/adjust/transfer) se valida en el servicio según el tipo.
  @Get('documents')
  @RequirePermissions('inventory.view')
  listDocs(@Ctx() ctx: RequestContext, @Query(new ZodPipe(DocListQuery)) q: z.infer<typeof DocListQuery>) {
    return this.docs.list(ctx, q);
  }

  @Get('documents/:id')
  @RequirePermissions('inventory.view')
  getDoc(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(ctx, id);
  }

  @Post('documents')
  createDoc(@Ctx() ctx: RequestContext, @Body(new ZodPipe(StockDocumentCreateSchema)) body: StockDocumentCreateInput) {
    return this.docs.create(ctx, body);
  }

  @Post('documents/:id/post')
  postDoc(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.post(ctx, id);
  }

  @Post('documents/:id/approve')
  @RequirePermissions('inventory.adjust.approve')
  approveDoc(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.approve(ctx, id);
  }

  @Post('documents/:id/void')
  voidDoc(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(VoidSchema)) body: z.infer<typeof VoidSchema>,
  ) {
    return this.docs.void(ctx, id, body.reason);
  }

  @Get('counts')
  @RequirePermissions('inventory.view')
  listCounts(@Ctx() ctx: RequestContext) {
    return this.query.listCounts(ctx);
  }

  @Post('counts')
  @RequirePermissions('inventory.count')
  createCount(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CountCreateSchema)) body: z.infer<typeof CountCreateSchema>) {
    return this.query.createCount(ctx, body);
  }

  @Get('counts/:id')
  @RequirePermissions('inventory.view')
  getCount(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.getCount(ctx, id);
  }

  @Patch('counts/:id/lines')
  @RequirePermissions('inventory.count')
  setCounted(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(CountLinesPatchSchema)) body: z.infer<typeof CountLinesPatchSchema>,
  ) {
    return this.query.setCounted(ctx, id, body);
  }

  @Post('counts/:id/post')
  @RequirePermissions('inventory.count', 'inventory.adjust')
  postCount(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.postCount(ctx, id);
  }
}
