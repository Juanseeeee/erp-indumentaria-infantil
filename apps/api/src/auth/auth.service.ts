import { Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DomainError } from '@erp/domain-core';
import type { LoginInput } from '@erp/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import type { RequestContext } from '../common/context';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

export interface SessionInfo {
  sessionId: string;
  userId: string;
  companyId: string;
  csrfToken: string;
}

@Injectable()
export class AuthService {
  private readonly ttlHours = Number(process.env.SESSION_TTL_HOURS ?? 12);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { where: { isActive: true } } },
    });
    const invalid = () => new DomainError('CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.', 401);
    if (!user || !user.isActive) {
      // Mitiga enumeración de usuarios por tiempo de respuesta.
      await verify('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$5e1hX8T0RWh0bnrb7r9MeQ', input.password).catch(() => false);
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new DomainError(
        'USUARIO_BLOQUEADO',
        'El usuario está bloqueado temporalmente por intentos fallidos. Probá de nuevo en unos minutos.',
        423,
      );
    }
    const ok = await verify(user.passwordHash, input.password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw invalid();
    }
    const membership = user.memberships[0];
    if (!membership) throw new DomainError('SIN_EMPRESA', 'El usuario no tiene acceso a ninguna empresa.', 403);

    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        companyId: membership.companyId,
        tokenHash: sha256(token),
        csrfToken,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
        expiresAt: new Date(Date.now() + this.ttlHours * 3_600_000),
      },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.uow.run({ companyId: membership.companyId, userId: user.id }, (tx) =>
      this.audit.log(tx, { companyId: membership.companyId, userId: user.id, ip: meta.ip }, {
        entity: 'session',
        entityId: session.id,
        action: 'login',
      }),
    );
    return { token, csrfToken, expiresAt: session.expiresAt };
  }

  /** Resuelve la sesión a partir del token de la cookie. Renueva la expiración (sliding). */
  async resolve(token: string | undefined): Promise<SessionInfo> {
    if (!token) throw new UnauthorizedException('Sesión no iniciada');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { isActive: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('La sesión expiró. Volvé a ingresar.');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId: session.companyId, userId: session.userId } },
    });
    if (!membership?.isActive) throw new UnauthorizedException('Sin acceso a la empresa.');

    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + this.ttlHours * 3_600_000) },
      });
    }
    return { sessionId: session.id, userId: session.userId, companyId: session.companyId, csrfToken: session.csrfToken };
  }

  async permissionsFor(companyId: string, userId: string): Promise<Set<string>> {
    const rows = await this.uow.run({ companyId, userId }, (tx) =>
      tx.rolePermission.findMany({
        where: { role: { users: { some: { userId, companyId } } } },
        select: { permissionCode: true },
      }),
    );
    return new Set(rows.map((r) => r.permissionCode));
  }

  async me(ctx: RequestContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { id: true, email: true, name: true },
    });
    const company = await this.uow.run(ctx, (tx) =>
      tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { id: true, legalName: true, tradeName: true } }),
    );
    const roles = await this.uow.run(ctx, (tx) =>
      tx.userRole.findMany({ where: { userId: ctx.userId }, select: { role: { select: { code: true, name: true } } } }),
    );
    return { user, company, roles: roles.map((r) => r.role), permissions: [...ctx.permissions].sort() };
  }

  async logout(ctx: RequestContext) {
    await this.prisma.session.update({ where: { id: ctx.sessionId }, data: { revokedAt: new Date() } });
  }

  listSessions(ctx: RequestContext) {
    return this.prisma.session.findMany({
      where: { userId: ctx.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /** Cierre remoto: revoca una sesión propia, o todas menos la actual. */
  async revokeSessions(ctx: RequestContext, sessionId?: string) {
    const where = sessionId
      ? { id: sessionId, userId: ctx.userId }
      : { userId: ctx.userId, id: { not: ctx.sessionId } };
    const { count } = await this.prisma.session.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: count };
  }
}
