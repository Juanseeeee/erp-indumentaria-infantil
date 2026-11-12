import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { PartyListQuerySchema, PartyUpsertInput } from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService, shallowDiff } from '../common/common.service';

const include = {
  roles: { select: { role: true } },
  addresses: true,
  contacts: true,
  customerProfile: true,
  supplierProfile: true,
} satisfies Prisma.PartyInclude;

type PartyWithRelations = Prisma.PartyGetPayload<{ include: typeof include }>;

@Injectable()
export class PartiesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private present(ctx: RequestContext, p: PartyWithRelations) {
    const showCredit = can(ctx, 'parties.credit.view');
    return {
      ...p,
      roles: p.roles.map((r) => r.role),
      customerProfile: p.customerProfile
        ? {
            ...p.customerProfile,
            creditLimit: showCredit ? (p.customerProfile.creditLimit?.toString() ?? null) : undefined,
            discountPct: showCredit ? p.customerProfile.discountPct.toString() : undefined,
          }
        : null,
    };
  }

  list(ctx: RequestContext, q: z.infer<typeof PartyListQuerySchema>) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.PartyWhereInput = {
        ...(q.includeInactive ? {} : { isActive: true }),
        ...(q.role ? { roles: { some: { role: q.role } } } : {}),
        ...(q.q
          ? {
              OR: [
                { legalName: { contains: q.q, mode: 'insensitive' } },
                { tradeName: { contains: q.q, mode: 'insensitive' } },
                { taxId: { contains: q.q.replace(/[\s.-]/g, '') } },
                { code: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.party.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { legalName: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.party.count({ where }),
      ]);
      return { total, rows: rows.map((p) => this.present(ctx, p)) };
    });
  }

  get(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const p = await tx.party.findUnique({ where: { id }, include });
      if (!p) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El tercero no existe.', 404);
      return this.present(ctx, p);
    });
  }

  create(ctx: RequestContext, input: PartyUpsertInput) {
    this.assertCreditPermission(ctx, input);
    return this.uow.run(
      ctx,
      async (tx) => {
        await this.assertUniqueTaxId(tx, input);
        const code = input.code || `T-${await this.numbering.next(tx, ctx.companyId, 'PARTY', '', 5)}`;
        const party = await tx.party.create({
          data: {
            companyId: ctx.companyId,
            code,
            legalName: input.legalName,
            tradeName: input.tradeName,
            taxIdType: input.taxIdType,
            taxId: input.taxId,
            taxCondition: input.taxCondition,
            email: input.email ?? null,
            phone: input.phone,
            notes: input.notes,
            createdBy: ctx.userId,
            roles: { create: input.roles.map((role) => ({ role, companyId: ctx.companyId })) },
          },
        });
        await this.syncChildren(tx, ctx, party.id, input);
        await this.audit.log(tx, ctx, { entity: 'party', entityId: party.id, action: 'create', diff: input });
        return this.present(ctx, await tx.party.findUniqueOrThrow({ where: { id: party.id }, include }));
      },
      { idempotent: true },
    );
  }

  update(ctx: RequestContext, id: string, input: PartyUpsertInput) {
    this.assertCreditPermission(ctx, input);
    return this.uow.run(ctx, async (tx) => {
      const before = await tx.party.findUnique({ where: { id } });
      if (!before) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El tercero no existe.', 404);
      await this.assertUniqueTaxId(tx, input, id);
      const data = {
        legalName: input.legalName,
        tradeName: input.tradeName,
        taxIdType: input.taxIdType,
        taxId: input.taxId,
        taxCondition: input.taxCondition,
        email: input.email ?? null,
        phone: input.phone,
        notes: input.notes,
      };
      // Bloqueo optimista: si otro usuario guardó antes, 409.
      const res = await tx.party.updateMany({
        where: { id, version: input.version ?? before.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (res.count === 0) {
        throw new DomainError(ErrorCodes.CONFLICTO_VERSION, 'Otro usuario modificó este registro. Recargá para ver los cambios.', 409);
      }
      await tx.partyRole.deleteMany({ where: { partyId: id, role: { notIn: input.roles } } });
      for (const role of input.roles) {
        await tx.partyRole.upsert({
          where: { partyId_role: { partyId: id, role } },
          create: { partyId: id, role, companyId: ctx.companyId },
          update: {},
        });
      }
      await this.syncChildren(tx, ctx, id, input);
      await this.audit.log(tx, ctx, { entity: 'party', entityId: id, action: 'update', diff: shallowDiff(before, data) });
      return this.present(ctx, await tx.party.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  setActive(ctx: RequestContext, id: string, isActive: boolean) {
    return this.uow.run(ctx, async (tx) => {
      await tx.party.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { entity: 'party', entityId: id, action: isActive ? 'activate' : 'deactivate' });
      return { id, isActive };
    });
  }

  private assertCreditPermission(ctx: RequestContext, input: PartyUpsertInput) {
    const c = input.customer;
    if (c && (c.creditLimit || (c.discountPct && c.discountPct !== '0')) && !can(ctx, 'parties.credit.view')) {
      throw new DomainError(ErrorCodes.SIN_PERMISO, 'No tenés permiso para definir condiciones de crédito.', 403);
    }
  }

  private async assertUniqueTaxId(tx: Tx, input: PartyUpsertInput, excludeId?: string) {
    const dup = await tx.party.findFirst({
      where: { taxIdType: input.taxIdType, taxId: input.taxId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, legalName: true },
    });
    if (dup) {
      throw new DomainError(ErrorCodes.DUPLICADO, `Ya existe ${dup.legalName} con ese ${input.taxIdType}.`, 409, { existingId: dup.id });
    }
  }

  private async syncChildren(tx: Tx, ctx: RequestContext, partyId: string, input: PartyUpsertInput) {
    if (input.address) {
      const existing = await tx.partyAddress.findFirst({ where: { partyId, type: 'FISCAL' } });
      const data = { street: input.address.street, city: input.address.city, province: input.address.province, zip: input.address.zip };
      if (existing) await tx.partyAddress.update({ where: { id: existing.id }, data });
      else await tx.partyAddress.create({ data: { ...data, partyId, companyId: ctx.companyId, type: 'FISCAL', isDefault: true } });
    }
    if (input.roles.includes('CUSTOMER')) {
      const c = input.customer ?? { discountPct: '0' };
      const credit = can(ctx, 'parties.credit.view')
        ? { creditLimit: c.creditLimit ?? null, discountPct: c.discountPct ?? '0' }
        : {};
      // Lista de precios y vendedor solo se tocan si vienen en el pedido (formularios viejos no los envían).
      const commercial = {
        ...('priceListId' in c && c.priceListId !== undefined ? { priceListId: c.priceListId } : {}),
        ...('sellerUserId' in c && c.sellerUserId !== undefined ? { sellerUserId: c.sellerUserId } : {}),
      };
      await tx.customerProfile.upsert({
        where: { partyId },
        create: { partyId, companyId: ctx.companyId, paymentTermId: c.paymentTermId ?? null, zoneId: c.zoneId ?? null, ...credit, ...commercial },
        update: { paymentTermId: c.paymentTermId ?? null, zoneId: c.zoneId ?? null, ...credit, ...commercial },
      });
    }
    if (input.roles.includes('SUPPLIER') || input.roles.includes('WORKSHOP')) {
      await tx.supplierProfile.upsert({ where: { partyId }, create: { partyId, companyId: ctx.companyId }, update: {} });
    }
    if (input.roles.includes('WORKSHOP')) {
      // Cada taller tiene un depósito virtual: el stock en su poder es un saldo más.
      const wh = await tx.warehouse.findUnique({ where: { partyId } });
      if (!wh) {
        const party = await tx.party.findUniqueOrThrow({ where: { id: partyId }, select: { code: true, legalName: true } });
        await tx.warehouse.create({
          data: { companyId: ctx.companyId, code: `TALLER-${party.code}`, name: `Taller ${party.legalName}`, type: 'WORKSHOP', partyId },
        });
      }
    }
  }
}
