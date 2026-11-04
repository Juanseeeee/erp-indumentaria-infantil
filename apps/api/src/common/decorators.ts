import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@erp/contracts';
import type { RequestContext } from './context';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
/** El usuario necesita TODOS los permisos indicados. */
export const RequirePermissions = (...perms: PermissionCode[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export const Ctx = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestContext => {
  return ctx.switchToHttp().getRequest().ctx;
});
