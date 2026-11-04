import { Injectable } from '@nestjs/common';
import { AccountEntry, Prisma } from '@prisma/client';
import { DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { CommissionsService } from '../sales/commissions.service';

type Ctx = Pick<RequestContext, 'companyId' | 'userId' | 'ip'>;

/**
 * Imputaciones N:M entre movimientos deudores (facturas, débitos: importe positivo) y acreedores
 * (cobros, pagos, créditos: importe negativo) del mismo tercero y la misma cuenta.
 * Solo cambian `open_amount`; la imputación es append-only y se revierte con otra fila.
 */
@Injectable()
export class AllocationsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly commissions: CommissionsService,
  ) {}

  /** Bloquea los movimientos en orden de id (evita interbloqueos entre imputaciones concurrentes). */
  private async lockEntries(tx: Tx, ids: string[]) {
    const sorted = [...new Set(ids)].sort();
    await tx.$queryRaw`SELECT id FROM account_entries WHERE id IN (${Prisma.join(sorted.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
    const rows = await tx.accountEntry.findMany({ where: { id: { in: sorted } } });
    if (rows.length !== sorted.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'Hay movimientos de cuenta corriente inexistentes.', 404);
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Imputa un acreedor contra varios deudores. Usar dentro de la transacción del documento que lo origina. */
  async allocateInTx(tx: Tx, ctx: Ctx, creditEntryId: string, lines: { entryId: string; amount: string }[], reason?: string) {
    if (!lines.length) return [];
    const entries = await this.lockEntries(tx, [creditEntryId, ...lines.map((l) => l.entryId)]);
    const credit = entries.get(creditEntryId)!;
    if (dec(credit.amount.toString()).gte(0)) throw new DomainError(ErrorCodes.VALIDACION, 'El movimiento a imputar no es un cobro, pago ni crédito.');
    let creditOpen = dec(credit.openAmount.toString()).abs();
    const out = [];
    for (const l of lines) {
      const debit = entries.get(l.entryId)!;
      const amount = roundMoney(l.amount);
      if (debit.partyId !== credit.partyId || debit.accountType !== credit.accountType) {
        throw new DomainError(ErrorCodes.VALIDACION, 'Solo se imputan movimientos del mismo tercero y la misma cuenta.');
      }
      if (dec(debit.amount.toString()).lte(0)) throw new DomainError(ErrorCodes.VALIDACION, `${debit.description} no es un comprobante deudor.`);
      const debitOpen = dec(debit.openAmount.toString());
      if (amount.gt(debitOpen)) {
        throw new DomainError(ErrorCodes.VALIDACION, `${debit.description}: se imputan ${amount.toFixed(2)} y quedan ${debitOpen.toFixed(2)} pendientes.`, 409);
      }
      if (amount.gt(creditOpen)) {
        throw new DomainError(ErrorCodes.VALIDACION, `Se imputa más de lo disponible (${creditOpen.toFixed(2)}).`, 409);
      }
      creditOpen = creditOpen.minus(amount);
      const newDebitOpen = debitOpen.minus(amount);
      await tx.accountEntry.update({ where: { id: debit.id }, data: { openAmount: newDebitOpen.toString() } });
      entries.set(debit.id, { ...debit, openAmount: new Prisma.Decimal(newDebitOpen.toString()) });
      const alloc = await tx.accountAllocation.create({
        data: { companyId: ctx.companyId, debitEntryId: debit.id, creditEntryId, amount: amount.toString(), reason: reason ?? null, createdBy: ctx.userId },
      });
      await this.commissions.onAllocation(tx, ctx, alloc, debit, credit, 1);
      out.push(alloc);
    }
    await tx.accountEntry.update({ where: { id: credit.id }, data: { openAmount: creditOpen.negated().toString() } });
    return out;
  }

  allocate(ctx: RequestContext, input: { creditEntryId: string; allocations: { entryId: string; amount: string }[] }) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const credit = await tx.accountEntry.findUnique({ where: { id: input.creditEntryId }, select: { accountType: true } });
        if (credit?.accountType !== 'RECEIVABLE') throw new DomainError(ErrorCodes.VALIDACION, 'Por ahora solo se imputan saldos de clientes (pagos a proveedores: Fase 4).');
        const rows = await this.allocateInTx(tx, ctx, input.creditEntryId, input.allocations);
        await this.audit.log(tx, ctx, {
          entity: 'account_entry',
          entityId: input.creditEntryId,
          action: 'allocate',
          diff: input.allocations,
        });
        return rows.map((r) => ({ ...r, amount: r.amount.toString() }));
      },
      { idempotent: true },
    );
  }

  /** Revierte una imputación: devuelve los saldos abiertos y genera la comisión negativa si correspondía. */
  reverse(ctx: RequestContext, allocationId: string, reason: string) {
    return this.uow.run(ctx, (tx) => this.reverseInTx(tx, ctx, allocationId, reason));
  }

  async reverseInTx(tx: Tx, ctx: Ctx, allocationId: string, reason: string) {
    await tx.$queryRaw`SELECT id FROM account_allocations WHERE id = ${allocationId}::uuid FOR UPDATE`;
    const orig = await tx.accountAllocation.findUnique({ where: { id: allocationId } });
    if (!orig) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La imputación no existe.', 404);
    if (orig.reversalOfId) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Una reversa no se puede revertir.');
    const already = await tx.accountAllocation.findUnique({ where: { reversalOfId: orig.id } });
    if (already) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La imputación ya fue revertida.');
    const entries = await this.lockEntries(tx, [orig.debitEntryId, orig.creditEntryId]);
    const debit = entries.get(orig.debitEntryId)!;
    const credit = entries.get(orig.creditEntryId)!;
    if (debit.entryType === 'REVERSAL') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Es la compensación de un documento anulado: no se revierte.');
    const amount = dec(orig.amount.toString());
    await tx.accountEntry.update({ where: { id: debit.id }, data: { openAmount: dec(debit.openAmount.toString()).plus(amount).toString() } });
    await tx.accountEntry.update({ where: { id: credit.id }, data: { openAmount: dec(credit.openAmount.toString()).minus(amount).toString() } });
    const rev = await tx.accountAllocation.create({
      data: { companyId: ctx.companyId, debitEntryId: debit.id, creditEntryId: credit.id, amount: orig.amount, reversalOfId: orig.id, reason, createdBy: ctx.userId },
    });
    await this.commissions.onAllocation(tx, ctx, rev, debit, credit, -1);
    await this.audit.log(tx, ctx, { entity: 'account_allocation', entityId: orig.id, action: 'reverse', reason });
    return { ...rev, amount: rev.amount.toString() };
  }

  /** Revierte todas las imputaciones vigentes de un movimiento (p.ej. al anular el recibo). */
  async reverseAllForEntry(tx: Tx, ctx: Ctx, entryId: string, reason: string) {
    const active = await this.activeFor(tx, entryId);
    for (const a of active) await this.reverseInTx(tx, ctx, a.id, reason);
    return active.length;
  }

  /** Imputaciones vigentes (no revertidas) en las que participa el movimiento. */
  async activeFor(tx: Tx, entryId: string) {
    const rows = await tx.accountAllocation.findMany({
      where: { reversalOfId: null, OR: [{ debitEntryId: entryId }, { creditEntryId: entryId }] },
      orderBy: { createdAt: 'asc' },
    });
    const reversed = await tx.accountAllocation.findMany({ where: { reversalOfId: { in: rows.map((r) => r.id) } }, select: { reversalOfId: true } });
    const set = new Set(reversed.map((r) => r.reversalOfId));
    return rows.filter((r) => !set.has(r.id));
  }

  /** Imputaciones vigentes de un tercero, con la descripción de ambos lados (para el estado de cuenta). */
  async forParty(tx: Tx, entries: AccountEntry[]) {
    const ids = entries.map((e) => e.id);
    if (!ids.length) return [];
    const rows = await tx.accountAllocation.findMany({ where: { reversalOfId: null, debitEntryId: { in: ids } }, orderBy: { createdAt: 'asc' } });
    const reversed = await tx.accountAllocation.findMany({ where: { reversalOfId: { in: rows.map((r) => r.id) } }, select: { reversalOfId: true } });
    const set = new Set(reversed.map((r) => r.reversalOfId));
    const byId = new Map(entries.map((e) => [e.id, e]));
    return rows
      .filter((r) => !set.has(r.id))
      .map((r) => ({
        id: r.id,
        debitEntryId: r.debitEntryId,
        creditEntryId: r.creditEntryId,
        amount: r.amount.toString(),
        createdAt: r.createdAt,
        debit: byId.get(r.debitEntryId)?.description,
        credit: byId.get(r.creditEntryId)?.description,
      }));
  }
}
