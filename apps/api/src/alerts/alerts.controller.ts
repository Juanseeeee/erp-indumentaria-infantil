import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AlertQuerySchema, AlertResolveSchema, AlertRuleUpdateSchema, type AlertQuery, type AlertRuleUpdateInput } from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import type { RequestContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { AlertsService } from './alerts.service';
import { EmailDispatcher } from './email-dispatcher';

/** Cada usuario ve las alertas dirigidas a sus roles; configurar y ver las de todos requiere `alerts.manage`. */
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly mailer: EmailDispatcher,
  ) {}

  @Get()
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(AlertQuerySchema)) q: AlertQuery) {
    return this.alerts.list(ctx, q);
  }

  @Get('summary')
  summary(@Ctx() ctx: RequestContext) {
    return this.alerts.summary(ctx);
  }

  @Post(':id/seen')
  seen(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.markSeen(ctx, id);
  }

  @Post(':id/resolve')
  resolve(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AlertResolveSchema)) body: { note?: string | null }) {
    return this.alerts.resolve(ctx, id, body.note);
  }

  @Get('rules')
  @RequirePermissions('alerts.manage')
  rules(@Ctx() ctx: RequestContext) {
    return this.alerts.rules(ctx);
  }

  @Put('rules/:code')
  @RequirePermissions('alerts.manage')
  updateRule(@Ctx() ctx: RequestContext, @Param('code') code: string, @Body(new ZodPipe(AlertRuleUpdateSchema)) body: AlertRuleUpdateInput) {
    return this.alerts.updateRule(ctx, code, body);
  }

  /** Evaluar ahora (además de la evaluación periódica) y despachar los correos pendientes. */
  @Post('evaluate')
  @RequirePermissions('alerts.manage')
  async evaluate(@Ctx() ctx: RequestContext) {
    const result = await this.alerts.evaluate(ctx);
    const email = await this.mailer.dispatch(ctx);
    return { ...result, email };
  }
}
