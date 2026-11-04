import type { PermissionCode } from '@erp/contracts';

/** Contexto de la request autenticada. Se arma en AuthGuard y viaja explícito a los servicios. */
export interface RequestContext {
  userId: string;
  companyId: string;
  sessionId: string;
  permissions: ReadonlySet<string>;
  ip?: string;
  idempotencyKey?: string;
  requestHash?: string;
}

export function can(ctx: RequestContext, permission: PermissionCode): boolean {
  return ctx.permissions.has(permission);
}
