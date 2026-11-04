import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from '../common/decorators';
import type { RequestContext } from '../common/context';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'erp_session';
export const CSRF_COOKIE = 'erp_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guard global: autenticación por cookie de sesión, CSRF (doble envío) en mutaciones
 * y verificación de permisos declarados con @RequirePermissions. Todo en backend.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    const session = await this.auth.resolve(req.cookies?.[SESSION_COOKIE]);

    if (!SAFE_METHODS.has(req.method)) {
      const header = String(req.headers['x-csrf-token'] ?? '');
      const a = Buffer.from(header);
      const b = Buffer.from(session.csrfToken);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new ForbiddenException('Token CSRF inválido. Recargá la página.');
      }
    }

    const permissions = await this.auth.permissionsFor(session.companyId, session.userId);
    const idempotencyKey = req.headers['idempotency-key'];
    req.ctx = {
      userId: session.userId,
      companyId: session.companyId,
      sessionId: session.sessionId,
      permissions,
      ip: req.ip,
      idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey.length <= 100 ? idempotencyKey : undefined,
      requestHash: createHash('sha256').update(`${req.method} ${req.path} ${JSON.stringify(req.body ?? {})}`).digest('hex'),
    };

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !permissions.has(p));
    if (missing.length) {
      throw new ForbiddenException(`No tenés permiso para esta acción (${missing.join(', ')}).`);
    }
    return true;
  }
}
