import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { PeriodCloseInput, PeriodCloseSchema, PeriodReopenInput, PeriodReopenSchema } from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { PeriodsService } from './periods.service';

const ChecklistQuery = z.object({ until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@Controller('periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  /** La fecha de cierre la necesita cualquier usuario autenticado (los formularios la respetan). */
  @Get()
  status(@Ctx() ctx: RequestContext) {
    return this.periods.status(ctx);
  }

  @Get('checklist')
  @RequirePermissions('periods.close')
  checklist(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ChecklistQuery)) q: { until: string }) {
    return this.periods.checklist(ctx, q.until);
  }

  @Post('close')
  @RequirePermissions('periods.close')
  close(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PeriodCloseSchema)) body: PeriodCloseInput) {
    return this.periods.close(ctx, body);
  }

  @Post('reopen')
  @RequirePermissions('periods.reopen')
  reopen(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PeriodReopenSchema)) body: PeriodReopenInput) {
    return this.periods.reopen(ctx, body);
  }
}
