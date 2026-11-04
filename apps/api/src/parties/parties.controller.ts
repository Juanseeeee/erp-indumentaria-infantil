import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { PartyListQuerySchema, PartyUpsertInput, PartyUpsertSchema } from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { PartiesService } from './parties.service';

@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  @RequirePermissions('parties.view')
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(PartyListQuerySchema)) q: z.infer<typeof PartyListQuerySchema>) {
    return this.parties.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('parties.view')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.parties.get(ctx, id);
  }

  @Post()
  @RequirePermissions('parties.create')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PartyUpsertSchema)) body: PartyUpsertInput) {
    return this.parties.create(ctx, body);
  }

  @Put(':id')
  @RequirePermissions('parties.edit')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PartyUpsertSchema)) body: PartyUpsertInput,
  ) {
    return this.parties.update(ctx, id, body);
  }

  @Post(':id/deactivate')
  @RequirePermissions('parties.edit')
  deactivate(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.parties.setActive(ctx, id, false);
  }

  @Post(':id/activate')
  @RequirePermissions('parties.edit')
  activate(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.parties.setActive(ctx, id, true);
  }
}
