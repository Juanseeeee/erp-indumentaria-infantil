import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import { ProfitabilityQuerySchema, REPORT_FORMATS, type ProfitabilityQuery, type ReportFormat } from '@erp/contracts';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { Ctx, RequirePermissions } from '../common/decorators';
import type { RequestContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { ExecutiveService } from './executive.service';
import { ProfitabilityService } from './profitability.service';
import { ReportsCenterService } from './reports-center.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly executive: ExecutiveService,
    private readonly profitability: ProfitabilityService,
    private readonly center: ReportsCenterService,
  ) {}

  @Get('executive')
  @RequirePermissions('executive.view')
  executiveDashboard(@Ctx() ctx: RequestContext) {
    return this.executive.dashboard(ctx);
  }

  /** Margen bruto estimado: requiere ver ventas y costos. */
  @Get('profitability')
  @RequirePermissions('sales.view', 'costs.view')
  profitabilityReport(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ProfitabilityQuerySchema)) query: ProfitabilityQuery) {
    return this.profitability.report(ctx, query);
  }

  /** Centro de reportes: solo los que el usuario puede abrir (cada uno define sus permisos en el catálogo). */
  @Get('catalog')
  catalog(@Ctx() ctx: RequestContext) {
    return this.center.catalog(ctx);
  }

  @Get('run/:code')
  run(@Ctx() ctx: RequestContext, @Param('code') code: string, @Query() query: Record<string, unknown>) {
    return this.center.run(ctx, code, query);
  }

  @Get('run/:code/export')
  @RequirePermissions('data.export')
  async export(@Ctx() ctx: RequestContext, @Param('code') code: string, @Query() query: Record<string, unknown>) {
    const { format, ...params } = query;
    if (!REPORT_FORMATS.includes(format as ReportFormat)) throw new DomainError(ErrorCodes.VALIDACION, 'Elegí el formato: xlsx o pdf.', 400);
    const file = await this.center.export(ctx, code, params, format as ReportFormat);
    return new StreamableFile(file.buffer, { type: file.type, disposition: `attachment; filename="${file.fileName}"`, length: file.buffer.length });
  }
}
