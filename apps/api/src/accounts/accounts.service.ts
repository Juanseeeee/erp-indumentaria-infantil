import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { z } from 'zod';
import { AllocateInput, AllocateSchema, VoidSchema } from '@erp/contracts';
import { DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import type { Tx } from '../prisma/prisma.service';
import { can, type RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { businessDate } from '../common/dates';
import { AllocationsService } from './allocations.service';

export interface PostEntryInput {
  partyId: string;
  accountType: AccountType;
  entryType: string;
  sourceDocType: string;
  sourceDocId: string;
  description: string;
  date: Date;
  dueDate?: Date | null;
  /** Con signo: positivo aumenta la deuda. */
  amount: string;
}

/**
 * Cuentas corrientes. Fuente de verdad: account_entries (amount inmutable, sin borrado).
 * Las imputaciones (AllocationsService) solo modifican open_amount.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly allocations: AllocationsService,
  ) {}

  post(tx: Tx, ctx: Pick<RequestContext, 'companyId' | 'userId'>, input: PostEntryInput) {
    const amount = roundMoney(input.amount).toString();
    return tx.accountEntry.create({
      data: {
        companyId: ctx.companyId,
        partyId: input.partyId,
        accountType: input.accountType,
        entryType: input.entryType,
        sourceDocType: input.sourceDocType,
        sourceDocId: input.sourceDocId,
        description: input.description,
        date: input.date,
        dueDate: input.dueDate ?? null,
        amount,
        openAmount: amount,
        createdBy: ctx.userId,
      },
    });
  }

  /** Vencimiento por defecto según la condición de pago del proveedor o del cliente (primera cuota). */
  async defaultDueDate(tx: Tx, partyId: string, issueDate: Date, side: 'SUPPLIER' | 'CUSTOMER' = 'SUPPLIER', paymentTermId?: string | null): Promise<Date> {
    let termId = paymentTermId ?? null;
    if (!termId) {
      const profile = side === 'SUPPLIER' ? await tx.supplierProfile.findUnique({ where: { partyId } }) : await tx.customerProfile.findUnique({ where: { partyId } });
      termId = profile?.paymentTermId ?? null;
    }
    const term = termId ? await tx.paymentTerm.findUnique({ where: { id: termId } }) : null;
    const days = term?.days[0] ?? 0;
    return new Date(issueDate.getTime() + days * 86_400_000);
  }

  /** Saldo de la cuenta corriente (positivo = nos debe / le debemos). */
  async balanceOf(tx: Tx, partyId: string, accountType: AccountType) {
    const r = await tx.accountEntry.aggregate({ where: { partyId, accountType }, _sum: { amount: true } });
    return dec(r._sum.amount?.toString() ?? '0');
  }

  ledger(ctx: RequestContext, partyId: string, accountType: AccountType) {
    return this.uow.run(ctx, async (tx) => {
      const party = await tx.party.findUnique({ where: { id: partyId }, select: { id: true, code: true, legalName: true, taxId: true, taxIdType: true } });
      if (!party) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El tercero no existe.', 404);
      const rows = await tx.accountEntry.findMany({ where: { partyId, accountType }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
      let balance = dec(0);
      const allocations = await this.allocations.forParty(tx, rows);
      const today = businessDate();
      const aging = { current: dec(0), d30: dec(0), d60: dec(0), d90: dec(0), over90: dec(0) };
      for (const r of rows) {
        const open = dec(r.openAmount.toString());
        if (open.lte(0)) continue;
        const days = r.dueDate ? Math.floor((today.getTime() - r.dueDate.getTime()) / 86_400_000) : 0;
        const k = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'over90';
        aging[k] = aging[k].plus(open);
      }
      return {
        party,
        entries: rows.map((r) => {
          balance = balance.plus(r.amount.toString());
          return { ...r, amount: r.amount.toString(), openAmount: r.openAmount.toString(), balance: balance.toFixed(2) };
        }),
        allocations,
        balance: balance.toFixed(2),
        unappliedCredits: rows.reduce((a, r) => (dec(r.openAmount.toString()).lt(0) ? a.plus(r.openAmount.toString()) : a), dec(0)).abs().toFixed(2),
        aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, v.toFixed(2)])),
      };
    });
  }

  /** Saldos por tercero con antigüedad de lo vencido. */
  balances(ctx: RequestContext, accountType: AccountType) {
    const today = businessDate();
    return this.uow.run(ctx, async (tx) => {
      return tx.$queryRaw<{ party_id: string; legal_name: string; code: string; balance: string; overdue: string; over60: string; credits: string; next_due: Date | null }[]>`
        SELECT e.party_id, p.legal_name, p.code,
               SUM(e.amount)::text AS balance,
               COALESCE(SUM(e.open_amount) FILTER (WHERE e.open_amount > 0 AND e.due_date < ${today}::date), 0)::text AS overdue,
               COALESCE(SUM(e.open_amount) FILTER (WHERE e.open_amount > 0 AND e.due_date < ${today}::date - 60), 0)::text AS over60,
               COALESCE(-SUM(e.open_amount) FILTER (WHERE e.open_amount < 0), 0)::text AS credits,
               MIN(e.due_date) FILTER (WHERE e.open_amount > 0 AND e.due_date >= ${today}::date) AS next_due
        FROM account_entries e JOIN parties p ON p.id = e.party_id
        WHERE e.account_type = ${accountType}::"AccountType"
        GROUP BY e.party_id, p.legal_name, p.code
        HAVING SUM(e.amount) <> 0 OR SUM(e.open_amount) <> 0
        ORDER BY SUM(e.amount) DESC`;
    });
  }

  /** Comprobantes con saldo pendiente y saldos a favor sin imputar (para cobrar o imputar). */
  openItems(ctx: RequestContext, partyId: string, accountType: AccountType) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.accountEntry.findMany({
        where: { partyId, accountType, NOT: { openAmount: 0 } },
        orderBy: [{ dueDate: 'asc' }, { date: 'asc' }],
      });
      const map = (r: (typeof rows)[number]) => ({ ...r, amount: r.amount.toString(), openAmount: r.openAmount.toString() });
      return { debits: rows.filter((r) => r.amount.gt(0)).map(map), credits: rows.filter((r) => r.amount.lt(0)).map(map) };
    });
  }
}

const TypeQuery = z.object({ tipo: z.enum(['PAYABLE', 'RECEIVABLE']).default('PAYABLE') });

function assertCanView(ctx: RequestContext, type: AccountType) {
  const perm = type === 'RECEIVABLE' ? 'accounts.receivable.view' : 'accounts.payable.view';
  if (!can(ctx, perm)) throw new DomainError(ErrorCodes.SIN_PERMISO, `No tenés permiso para esta acción (${perm}).`, 403);
}

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly allocations: AllocationsService,
  ) {}

  @Get('balances')
  balances(@Ctx() ctx: RequestContext, @Query(new ZodPipe(TypeQuery)) q: z.infer<typeof TypeQuery>) {
    assertCanView(ctx, q.tipo);
    return this.accounts.balances(ctx, q.tipo);
  }

  /** Por ahora solo se imputa en clientes (los pagos a proveedores llegan en la Fase 4). */
  @Post('allocations')
  @RequirePermissions('receivables.collect')
  allocate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(AllocateSchema)) b: AllocateInput) {
    return this.allocations.allocate(ctx, b);
  }

  @Post('allocations/:id/reverse')
  @RequirePermissions('receivables.collect')
  reverse(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VoidSchema)) b: { reason: string }) {
    return this.allocations.reverse(ctx, id, b.reason);
  }

  @Get(':partyId/open')
  open(@Ctx() ctx: RequestContext, @Param('partyId', ParseUUIDPipe) partyId: string, @Query(new ZodPipe(TypeQuery)) q: z.infer<typeof TypeQuery>) {
    assertCanView(ctx, q.tipo);
    return this.accounts.openItems(ctx, partyId, q.tipo);
  }

  @Get(':partyId')
  ledger(@Ctx() ctx: RequestContext, @Param('partyId', ParseUUIDPipe) partyId: string, @Query(new ZodPipe(TypeQuery)) q: z.infer<typeof TypeQuery>) {
    assertCanView(ctx, q.tipo);
    return this.accounts.ledger(ctx, partyId, q.tipo);
  }
}
