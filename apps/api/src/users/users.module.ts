import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { ALL_PERMISSIONS, PasswordPolicy, PERMISSIONS } from '@erp/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { hashPassword } from '../auth/auth.service';

const UserCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1),
  password: PasswordPolicy,
  roleIds: z.array(z.string().uuid()).min(1, 'Asigná al menos un rol'),
});
const UserRolesSchema = z.object({ roleIds: z.array(z.string().uuid()).min(1) });
const RoleUpsertSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/, 'Código: letras, números y guion bajo'),
  name: z.string().trim().min(1),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const roles = await tx.userRole.findMany({ include: { role: { select: { id: true, code: true, name: true } } } });
      const members = await this.prisma.companyUser.findMany({
        where: { companyId: ctx.companyId },
        include: { user: { select: { id: true, email: true, name: true, isActive: true, lastLoginAt: true } } },
      });
      return members
        .map((m) => ({
          ...m.user,
          membershipActive: m.isActive,
          roles: roles.filter((r) => r.userId === m.userId).map((r) => r.role),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async create(ctx: RequestContext, input: z.infer<typeof UserCreateSchema>) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    const user =
      existing ??
      (await this.prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) },
      }));
    await this.prisma.companyUser.upsert({
      where: { companyId_userId: { companyId: ctx.companyId, userId: user.id } },
      create: { companyId: ctx.companyId, userId: user.id },
      update: { isActive: true },
    });
    return this.setRoles(ctx, user.id, input.roleIds, 'create');
  }

  setRoles(ctx: RequestContext, userId: string, roleIds: string[], action = 'set_roles') {
    return this.uow.run(ctx, async (tx) => {
      const roles = await tx.role.findMany({ where: { id: { in: roleIds } } });
      if (roles.length !== roleIds.length) throw new DomainError(ErrorCodes.VALIDACION, 'Hay roles inexistentes.');
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ companyId: ctx.companyId, userId, roleId })) });
      await this.audit.log(tx, ctx, { entity: 'user', entityId: userId, action, diff: { roles: roles.map((r) => r.code) } });
      return { userId, roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })) };
    });
  }

  async setActive(ctx: RequestContext, userId: string, isActive: boolean) {
    if (userId === ctx.userId && !isActive) {
      throw new DomainError(ErrorCodes.VALIDACION, 'No podés desactivar tu propio usuario.');
    }
    await this.prisma.companyUser.update({
      where: { companyId_userId: { companyId: ctx.companyId, userId } },
      data: { isActive },
    });
    if (!isActive) {
      await this.prisma.session.updateMany({ where: { userId, companyId: ctx.companyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.uow.run(ctx, (tx) =>
      this.audit.log(tx, ctx, { entity: 'user', entityId: userId, action: isActive ? 'activate' : 'deactivate' }),
    );
    return { userId, isActive };
  }

  roles(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const roles = await tx.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
      return {
        catalog: Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description, module: code.split('.')[0] })),
        roles: roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permissionCode), userCount: r._count.users })),
      };
    });
  }

  upsertRole(ctx: RequestContext, input: z.infer<typeof RoleUpsertSchema>) {
    if (input.code === 'SUPERADMIN') throw new DomainError(ErrorCodes.VALIDACION, 'El rol Superadministrador no se puede modificar.');
    return this.uow.run(ctx, async (tx) => {
      const role = await tx.role.upsert({
        where: { companyId_code: { companyId: ctx.companyId, code: input.code } },
        create: { companyId: ctx.companyId, code: input.code, name: input.name },
        update: { name: input.name },
      });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: input.permissions.map((p) => ({ roleId: role.id, permissionCode: p, companyId: ctx.companyId })),
      });
      await this.audit.log(tx, ctx, { entity: 'role', entityId: role.id, action: 'upsert', diff: input });
      return { ...role, permissions: input.permissions };
    });
  }
}

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermissions('users.view')
  list(@Ctx() ctx: RequestContext) {
    return this.users.list(ctx);
  }

  @Post('users')
  @RequirePermissions('users.manage')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(UserCreateSchema)) b: z.infer<typeof UserCreateSchema>) {
    return this.users.create(ctx, b);
  }

  @Put('users/:id/roles')
  @RequirePermissions('users.manage')
  setRoles(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UserRolesSchema)) b: z.infer<typeof UserRolesSchema>,
  ) {
    return this.users.setRoles(ctx, id, b.roleIds);
  }

  @Post('users/:id/deactivate')
  @RequirePermissions('users.manage')
  deactivate(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.setActive(ctx, id, false);
  }

  @Post('users/:id/activate')
  @RequirePermissions('users.manage')
  activate(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.setActive(ctx, id, true);
  }

  @Get('roles')
  @RequirePermissions('users.view')
  roles(@Ctx() ctx: RequestContext) {
    return this.users.roles(ctx);
  }

  @Put('roles')
  @RequirePermissions('roles.manage')
  upsertRole(@Ctx() ctx: RequestContext, @Body(new ZodPipe(RoleUpsertSchema)) b: z.infer<typeof RoleUpsertSchema>) {
    return this.users.upsertRole(ctx, b);
  }
}
