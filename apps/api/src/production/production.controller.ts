import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  DefectReasonSchema,
  IssueMaterialsSchema,
  ProductionCancelSchema,
  ProductionOrderCreateInput,
  ProductionOrderCreateSchema,
  ProductionOutputCreateInput,
  ProductionOutputCreateSchema,
  ProductionStageSchema,
  ProgressReportSchema,
  ReturnMaterialsSchema,
  TechSheetVersionSaveInput,
  TechSheetVersionSaveSchema,
  WorkshopDispatchCreateSchema,
  WorkshopRateSchema,
  WorkshopSettlementCreateInput,
  WorkshopSettlementCreateSchema,
  zQty,
} from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { ProductionService } from './production.service';
import { ProductionConfigService } from './production-config.service';
import { TechSheetsService } from './techsheets.service';
import { SettlementsService } from './settlements.service';

const ListQuery = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const LinesSchema = z.object({ lines: z.array(z.object({ variantItemId: z.string().uuid(), qty: zQty() })) });
const WriteOffSchema = ReturnMaterialsSchema.and(z.object({ reason: z.string().trim().min(3, 'Indicá el motivo') }));
const WorkshopQuery = z.object({ workshopId: z.string().uuid() });
const OptionalWorkshop = z.object({ workshopId: z.string().uuid().optional() });
const CloseSchema = z
  .object({ acceptPendingConsumption: z.boolean().default(false), reason: z.string().trim().max(500).optional().nullable() })
  .default({});

@Controller('production')
export class ProductionController {
  constructor(
    private readonly production: ProductionService,
    private readonly config: ProductionConfigService,
    private readonly sheets: TechSheetsService,
    private readonly settlements: SettlementsService,
  ) {}

  // Configuración
  @Get('config')
  @RequirePermissions('production.view')
  getConfig(@Ctx() ctx: RequestContext) {
    return this.config.get(ctx);
  }

  @Put('config/stages')
  @RequirePermissions('settings.production')
  stage(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ProductionStageSchema)) b: z.infer<typeof ProductionStageSchema>) {
    return this.config.upsertStage(ctx, b);
  }

  @Post('config/defect-reasons')
  @RequirePermissions('settings.production')
  defect(@Ctx() ctx: RequestContext, @Body(new ZodPipe(DefectReasonSchema)) b: z.infer<typeof DefectReasonSchema>) {
    return this.config.createDefectReason(ctx, b);
  }

  @Post('config/workshop-rates')
  @RequirePermissions('settings.production')
  rate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(WorkshopRateSchema)) b: z.infer<typeof WorkshopRateSchema>) {
    return this.config.createRate(ctx, b);
  }

  // Fichas técnicas
  @Get('tech-sheets/:productId')
  @RequirePermissions('techsheets.view')
  sheet(@Ctx() ctx: RequestContext, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.sheets.get(ctx, productId);
  }

  @Put('tech-sheets/:productId/draft')
  @RequirePermissions('techsheets.edit')
  saveDraft(@Ctx() ctx: RequestContext, @Param('productId', ParseUUIDPipe) productId: string, @Body(new ZodPipe(TechSheetVersionSaveSchema)) b: TechSheetVersionSaveInput) {
    return this.sheets.saveDraft(ctx, productId, b);
  }

  @Post('tech-sheets/:productId/activate')
  @RequirePermissions('techsheets.edit')
  activate(@Ctx() ctx: RequestContext, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.sheets.activate(ctx, productId);
  }

  // Tablero y vista de planta
  @Get('dashboard')
  @RequirePermissions('production.view')
  dashboard(@Ctx() ctx: RequestContext) {
    return this.production.dashboard(ctx);
  }

  @Get('my-tasks')
  @RequirePermissions('production.report')
  myTasks(@Ctx() ctx: RequestContext) {
    return this.production.myTasks(ctx);
  }

  // Liquidaciones de talleres
  @Get('settlements')
  @RequirePermissions('production.view')
  settlementsList(@Ctx() ctx: RequestContext, @Query(new ZodPipe(OptionalWorkshop)) q: z.infer<typeof OptionalWorkshop>) {
    return this.settlements.list(ctx, q.workshopId);
  }

  @Get('settlements/pending')
  @RequirePermissions('production.settle')
  pendingSettlement(@Ctx() ctx: RequestContext, @Query(new ZodPipe(WorkshopQuery)) q: z.infer<typeof WorkshopQuery>) {
    return this.settlements.pending(ctx, q.workshopId);
  }

  @Post('settlements')
  @RequirePermissions('production.settle')
  settle(@Ctx() ctx: RequestContext, @Body(new ZodPipe(WorkshopSettlementCreateSchema)) b: WorkshopSettlementCreateInput) {
    return this.settlements.create(ctx, b);
  }

  // Órdenes
  @Get('orders')
  @RequirePermissions('production.view')
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.production.list(ctx, q);
  }

  @Post('orders')
  @RequirePermissions('production.plan')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ProductionOrderCreateSchema)) b: ProductionOrderCreateInput) {
    return this.production.create(ctx, b);
  }

  @Get('orders/:id')
  @RequirePermissions('production.view')
  detail(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.production.detail(ctx, id);
  }

  @Put('orders/:id/lines')
  @RequirePermissions('production.plan')
  updateLines(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(LinesSchema)) b: z.infer<typeof LinesSchema>) {
    return this.production.updateDraftLines(ctx, id, b.lines);
  }

  @Post('orders/:id/release')
  @RequirePermissions('production.plan')
  release(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.production.release(ctx, id);
  }

  @Post('orders/:id/purchase-request')
  @RequirePermissions('purchasing.order')
  purchaseRequest(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.production.requestShortages(ctx, id);
  }

  @Post('orders/:id/issue')
  @RequirePermissions('production.materials')
  issue(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(IssueMaterialsSchema)) b: z.infer<typeof IssueMaterialsSchema>) {
    return this.production.issueMaterials(ctx, id, b);
  }

  @Post('orders/:id/return')
  @RequirePermissions('production.materials')
  returnMaterials(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReturnMaterialsSchema)) b: z.infer<typeof ReturnMaterialsSchema>) {
    return this.production.returnMaterials(ctx, id, b);
  }

  @Post('orders/:id/workshop-write-off')
  @RequirePermissions('production.workshop')
  writeOff(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(WriteOffSchema)) b: z.infer<typeof WriteOffSchema>) {
    return this.production.writeOffWorkshopMaterials(ctx, id, b);
  }

  @Post('orders/:id/dispatch')
  @RequirePermissions('production.workshop')
  dispatch(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(WorkshopDispatchCreateSchema)) b: z.infer<typeof WorkshopDispatchCreateSchema>) {
    return this.production.dispatch(ctx, id, b);
  }

  @Post('orders/:id/report')
  @RequirePermissions('production.report')
  report(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ProgressReportSchema)) b: z.infer<typeof ProgressReportSchema>) {
    return this.production.report(ctx, id, b);
  }

  @Post('orders/:id/output')
  @RequirePermissions('production.qc')
  output(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ProductionOutputCreateSchema)) b: ProductionOutputCreateInput) {
    return this.production.output(ctx, id, b);
  }

  @Post('orders/:id/close')
  @RequirePermissions('production.plan')
  close(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CloseSchema)) b: z.infer<typeof CloseSchema>) {
    return this.production.close(ctx, id, b);
  }

  @Post('orders/:id/consume-by-sheet')
  @RequirePermissions('production.materials')
  consumeBySheet(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.production.consumeBySheet(ctx, id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('production.plan')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ProductionCancelSchema)) b: z.infer<typeof ProductionCancelSchema>) {
    return this.production.cancel(ctx, id, b.reason);
  }
}
