import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { RequestContext } from '../common/context';
import { Ctx } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AssistantService, ChatSchema, type AssistantEvent, type ChatInput } from './assistant.service';

/** Asistente de ayuda. Disponible para todo usuario autenticado; sus consultas respetan los permisos de cada uno. */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  status() {
    return this.assistant.status();
  }

  /** Respuesta en streaming (Server-Sent Events): eventos `text`, `tool`, `done` y `error`. */
  @Post('chat')
  async chat(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ChatSchema)) body: ChatInput, @Res() res: Response) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const emit = (e: AssistantEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    await this.assistant.chat(ctx, body, emit, abort.signal);
    res.end();
  }
}
