import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { secureCookies } from '../common/origin';
import type { Request, Response } from 'express';
import { DomainError } from '@erp/domain-core';
import { LoginInput, LoginSchema } from '@erp/contracts';
import { Ctx, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, SESSION_COOKIE } from './auth.guard';

/** Rate limit simple en memoria para login (por IP). En producción multi-instancia: mover a PostgreSQL. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const maxAttempts = () => Number(process.env.LOGIN_RATE_LIMIT ?? 20);

function rateLimit(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > maxAttempts()) {
    throw new DomainError('DEMASIADOS_INTENTOS', 'Demasiados intentos de ingreso. Esperá unos minutos.', 429);
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(LoginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    rateLimit(req.ip ?? 'unknown');
    const { token, csrfToken, expiresAt } = await this.auth.login(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const secure = secureCookies();
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: expiresAt });
    res.cookie(CSRF_COOKIE, csrfToken, { httpOnly: false, secure, sameSite: 'lax', path: '/', expires: expiresAt });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx);
  }

  @Get('sessions')
  sessions(@Ctx() ctx: RequestContext) {
    return this.auth.listSessions(ctx);
  }

  @Delete('sessions/:id')
  revoke(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSessions(ctx, id);
  }

  @Delete('sessions')
  revokeOthers(@Ctx() ctx: RequestContext) {
    return this.auth.revokeSessions(ctx);
  }
}
