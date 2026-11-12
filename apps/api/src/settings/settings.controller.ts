import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
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
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import {
  ApprovalRuleSchema,
  CollectionSchema,
  CompanyUpdateSchema,
  PaymentTermSchema,
  PurchasingPointsOfSaleSchema,
  SettingsService,
  ZoneSchema,
} from './settings.service';

const AuditQuery = z.object({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
const SizesSchema = z.object({ sizes: z.array(z.string().trim().min(1)).min(1) });

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Lectura de datos maestros: cualquier usuario autenticado (los necesita para operar). */
  @Get('master-data')
  masterData(@Ctx() ctx: RequestContext) {
    return this.settings.masterData(ctx);
  }

  @Get('company')
  @RequirePermissions('settings.company.view')
  company(@Ctx() ctx: RequestContext) {
    return this.settings.company(ctx);
  }

  @Put('company')
  @RequirePermissions('settings.company.edit')
  updateCompany(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CompanyUpdateSchema)) b: z.infer<typeof CompanyUpdateSchema>) {
    return this.settings.updateCompany(ctx, b);
  }

  @Put('approval-rules')
  @RequirePermissions('settings.company.edit')
  approvalRule(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ApprovalRuleSchema)) b: z.infer<typeof ApprovalRuleSchema>) {
    return this.settings.upsertApprovalRule(ctx, b);
  }

  @Put('purchasing-points-of-sale')
  @RequirePermissions('settings.company.edit')
  purchasingPointsOfSale(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PurchasingPointsOfSaleSchema)) b: z.infer<typeof PurchasingPointsOfSaleSchema>) {
    return this.settings.setPurchasingPointsOfSale(ctx, b);
  }

  @Post('uoms')
  @RequirePermissions('settings.master.manage')
  uom(@Ctx() ctx: RequestContext, @Body(new ZodPipe(UomCreateSchema)) b: z.infer<typeof UomCreateSchema>) {
    return this.settings.createUom(ctx, b);
  }

  @Post('uom-conversions')
  @RequirePermissions('settings.master.manage')
  conversion(@Ctx() ctx: RequestContext, @Body(new ZodPipe(UomConversionCreateSchema)) b: z.infer<typeof UomConversionCreateSchema>) {
    return this.settings.createConversion(ctx, b);
  }

  @Post('colors')
  @RequirePermissions('settings.master.manage')
  color(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ColorCreateSchema)) b: z.infer<typeof ColorCreateSchema>) {
    return this.settings.createColor(ctx, b);
  }

  @Post('size-scales')
  @RequirePermissions('settings.master.manage')
  sizeScale(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SizeScaleCreateSchema)) b: z.infer<typeof SizeScaleCreateSchema>) {
    return this.settings.createSizeScale(ctx, b);
  }

  @Post('size-scales/:id/sizes')
  @RequirePermissions('settings.master.manage')
  addSizes(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SizesSchema)) b: z.infer<typeof SizesSchema>,
  ) {
    return this.settings.addSizes(ctx, id, b.sizes);
  }

  @Post('categories')
  @RequirePermissions('settings.master.manage')
  category(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CategoryCreateSchema)) b: z.infer<typeof CategoryCreateSchema>) {
    return this.settings.createCategory(ctx, b);
  }

  @Post('seasons')
  @RequirePermissions('settings.master.manage')
  season(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SeasonCreateSchema)) b: z.infer<typeof SeasonCreateSchema>) {
    return this.settings.createSeason(ctx, b);
  }

  @Post('collections')
  @RequirePermissions('settings.master.manage')
  collection(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CollectionSchema)) b: z.infer<typeof CollectionSchema>) {
    return this.settings.createCollection(ctx, b);
  }

  @Post('warehouses')
  @RequirePermissions('settings.master.manage')
  warehouse(@Ctx() ctx: RequestContext, @Body(new ZodPipe(WarehouseCreateSchema)) b: z.infer<typeof WarehouseCreateSchema>) {
    return this.settings.createWarehouse(ctx, b);
  }

  @Post('warehouses/:id/deactivate')
  @RequirePermissions('settings.master.manage')
  deactivateWarehouse(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.setWarehouseActive(ctx, id, false);
  }

  @Post('payment-terms')
  @RequirePermissions('settings.master.manage')
  paymentTerm(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PaymentTermSchema)) b: z.infer<typeof PaymentTermSchema>) {
    return this.settings.createPaymentTerm(ctx, b);
  }

  @Post('zones')
  @RequirePermissions('settings.master.manage')
  zone(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ZoneSchema)) b: z.infer<typeof ZoneSchema>) {
    return this.settings.createZone(ctx, b);
  }

  @Post('cost-centers')
  @RequirePermissions('settings.master.manage')
  costCenter(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CostCenterCreateSchema)) b: z.infer<typeof CostCenterCreateSchema>) {
    return this.settings.createCostCenter(ctx, b);
  }

  @Get('audit')
  @RequirePermissions('audit.view')
  audit(@Ctx() ctx: RequestContext, @Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.settings.auditLog(ctx, q);
  }
}
