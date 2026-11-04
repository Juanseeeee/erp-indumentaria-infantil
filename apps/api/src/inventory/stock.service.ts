import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, StockMovementType } from '@prisma/client';
import { Dec, DomainError, ErrorCodes, dec, roundMoney, roundQty } from '@erp/domain-core';
import { applyMovement, assertCanReserve, assertSignMatchesType } from '@erp/domain-stock';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';

export interface MoveInput {
  itemId: string;
  warehouseId: string;
  lotId?: string | null;
  type: StockMovementType;
  /** Con signo, en unidad base. */
  qty: string;
  unitCost?: string | null;
  sourceDocType: string;
  sourceDocId: string;
  sourceLineId?: string | null;
  transferGroupId?: string | null;
  reason?: string | null;
  /** Reserva propia que este movimiento consume (p.ej. la OP consume la reserva de sus materiales). */
  reservationId?: string | null;
  occurredAt?: Date;
}

interface BalanceRow {
  id: string;
  on_hand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  avg_cost: Prisma.Decimal;
}

type Ctx = Pick<RequestContext, 'companyId' | 'userId'>;

/**
 * Motor de stock. ÚNICO punto que escribe stock_movements / stock_balances / stock_reservations.
 *
 * Modelo de saldos: por (artículo, depósito) hay una fila "cabecera" (lot_id NULL) y, si el artículo
 * se controla por lote, una fila por lote. Las reservas viven en la cabecera. El disponible de un
 * artículo en un depósito es Σ físico de todas sus filas − reservado.
 *
 * Concurrencia: toda operación bloquea primero la cabecera (FOR UPDATE). Eso serializa cualquier
 * cambio sobre el mismo artículo/depósito, incluidos los de distintos lotes.
 */
@Injectable()
export class StockService {
  private async lockRow(tx: Tx, companyId: string, itemId: string, warehouseId: string, lotId: string | null): Promise<BalanceRow> {
    await tx.$executeRaw`
      INSERT INTO stock_balances (id, company_id, item_id, warehouse_id, location_id, lot_id, on_hand, reserved, avg_cost)
      VALUES (gen_random_uuid(), ${companyId}::uuid, ${itemId}::uuid, ${warehouseId}::uuid, NULL, ${lotId}::uuid, 0, 0, 0)
      ON CONFLICT (company_id, item_id, warehouse_id, location_id, lot_id) DO NOTHING`;
    const rows = await tx.$queryRaw<BalanceRow[]>`
      SELECT id, on_hand, reserved, avg_cost FROM stock_balances
      WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid
        AND location_id IS NULL AND lot_id IS NOT DISTINCT FROM ${lotId}::uuid
      FOR UPDATE`;
    return rows[0]!;
  }

  /** Totales del artículo en el depósito (todas las filas). Llamar con la cabecera ya bloqueada. */
  private async totals(tx: Tx, itemId: string, warehouseId: string) {
    const rows = await tx.$queryRaw<{ on_hand: Prisma.Decimal | null; reserved: Prisma.Decimal | null }[]>`
      SELECT SUM(on_hand) AS on_hand, SUM(reserved) AS reserved FROM stock_balances
      WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
    return { onHand: dec(rows[0]?.on_hand?.toString() ?? '0'), reserved: dec(rows[0]?.reserved?.toString() ?? '0') };
  }

  private async loadItem(tx: Tx, itemId: string) {
    const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true, allowNegative: true, isActive: true, sku: true, name: true } });
    if (!item) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El artículo no existe.', 404);
    return item;
  }

  private async assertWarehouse(tx: Tx, warehouseId: string) {
    const wh = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { isActive: true } });
    if (!wh) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El depósito no existe.', 404);
    if (!wh.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'El depósito está inactivo.');
  }

  async move(tx: Tx, ctx: Ctx, input: MoveInput) {
    assertSignMatchesType(input.type, input.qty);
    const item = await this.loadItem(tx, input.itemId);
    await this.assertWarehouse(tx, input.warehouseId);
    const lotId = input.lotId ?? null;
    const qty = roundQty(input.qty);

    const header = await this.lockRow(tx, ctx.companyId, input.itemId, input.warehouseId, null);
    const row = lotId ? await this.lockRow(tx, ctx.companyId, input.itemId, input.warehouseId, lotId) : header;

    // Reserva propia que se consume con esta salida.
    let released = dec(0);
    let reservation: { id: string; qty: Prisma.Decimal; consumed_qty: Prisma.Decimal } | null = null;
    if (input.reservationId) {
      const rows = await tx.$queryRaw<{ id: string; qty: Prisma.Decimal; consumed_qty: Prisma.Decimal; status: string; item_id: string; warehouse_id: string }[]>`
        SELECT id, qty, consumed_qty, status, item_id, warehouse_id FROM stock_reservations
        WHERE id = ${input.reservationId}::uuid FOR UPDATE`;
      const r = rows[0];
      if (!r || r.item_id !== input.itemId || r.warehouse_id !== input.warehouseId) {
        throw new DomainError(ErrorCodes.RESERVA_INSUFICIENTE, 'La reserva no corresponde a este artículo y depósito.');
      }
      if (r.status === 'ACTIVE' && qty.isNegative()) {
        const pending = dec(r.qty.toString()).minus(r.consumed_qty.toString());
        released = pending.lt(qty.abs()) ? pending : qty.abs();
        reservation = r;
      }
    }

    const result = applyMovement(
      { onHand: row.on_hand.toString(), reserved: '0', avgCost: row.avg_cost.toString(), allowNegative: item.allowNegative },
      { type: input.type, qty: qty.toString(), unitCost: input.unitCost },
    );

    // Control agregado: lo reservado por otros documentos no se puede tocar.
    if (qty.isNegative() && !item.allowNegative) {
      const t = await this.totals(tx, input.itemId, input.warehouseId);
      const freeAfter = t.onHand.plus(qty).minus(t.reserved.minus(released));
      if (freeAfter.isNegative()) {
        const available = t.onHand.minus(t.reserved).plus(released);
        throw new DomainError(
          ErrorCodes.STOCK_INSUFICIENTE,
          `Stock insuficiente de ${item.sku}: disponible ${available.toString()}, se intenta descontar ${qty.abs().toString()}.`,
          409,
          { itemId: item.id, available: available.toString(), requested: qty.abs().toString() },
        );
      }
    }

    await tx.$executeRaw`
      UPDATE stock_balances SET on_hand = ${result.onHand.toString()}::numeric, avg_cost = ${result.avgCost.toString()}::numeric, updated_at = now()
      WHERE id = ${row.id}::uuid`;
    if (!released.isZero()) {
      await tx.$executeRaw`UPDATE stock_balances SET reserved = reserved - ${released.toString()}::numeric WHERE id = ${header.id}::uuid`;
      const consumed = dec(reservation!.consumed_qty.toString()).plus(released);
      await tx.stockReservation.update({
        where: { id: reservation!.id },
        data: { consumedQty: consumed.toString(), status: consumed.gte(reservation!.qty.toString()) ? 'CONSUMED' : 'ACTIVE' },
      });
    }

    return tx.stockMovement.create({
      data: {
        companyId: ctx.companyId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        lotId,
        type: input.type,
        qty: qty.toString(),
        unitCost: result.unitCost.toString(),
        totalCost: roundMoney(qty.times(result.unitCost)).toString(),
        balanceAfter: result.onHand.toString(),
        sourceDocType: input.sourceDocType,
        sourceDocId: input.sourceDocId,
        sourceLineId: input.sourceLineId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        reason: input.reason ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        createdBy: ctx.userId,
      },
    });
  }

  /**
   * Salida sin lote indicado: toma de las filas con stock en orden FIFO (primero lo sin lote,
   * luego los lotes más antiguos). Devuelve los movimientos generados.
   */
  async moveOutFifo(tx: Tx, ctx: Ctx, input: Omit<MoveInput, 'lotId'> & { qty: string }) {
    const total = dec(input.qty).abs();
    await this.lockRow(tx, ctx.companyId, input.itemId, input.warehouseId, null);
    const rows = await tx.$queryRaw<{ lot_id: string | null; on_hand: Prisma.Decimal }[]>`
      SELECT b.lot_id, b.on_hand FROM stock_balances b LEFT JOIN lots l ON l.id = b.lot_id
      WHERE b.item_id = ${input.itemId}::uuid AND b.warehouse_id = ${input.warehouseId}::uuid AND b.on_hand > 0
      ORDER BY b.lot_id IS NOT NULL, l.created_at, l.code`;
    const moves = [];
    let pending = total;
    for (const r of rows) {
      if (pending.lte(0)) break;
      const take = Prisma.Decimal.min(r.on_hand, pending.toString());
      moves.push(await this.move(tx, ctx, { ...input, lotId: r.lot_id, qty: dec(take.toString()).negated().toString() }));
      pending = pending.minus(take.toString());
    }
    if (pending.gt(0)) {
      // Lo que falte se intenta sobre la cabecera: falla con el mensaje de stock insuficiente (o queda negativo si se permite).
      moves.push(await this.move(tx, ctx, { ...input, lotId: null, qty: pending.negated().toString() }));
    }
    return moves;
  }

  /**
   * Transferencia entre depósitos conservando lote y costo (FIFO por lote si no se indica uno).
   * Devuelve los pares de movimientos.
   */
  async transfer(
    tx: Tx,
    ctx: Ctx,
    input: { itemId: string; fromWarehouseId: string; toWarehouseId: string; qty: string; lotId?: string | null; reservationId?: string | null; sourceDocType: string; sourceDocId: string; sourceLineId?: string | null; reason?: string | null },
  ) {
    const groupId = randomUUID();
    const base = { itemId: input.itemId, type: 'TRANSFER_OUT' as const, sourceDocType: input.sourceDocType, sourceDocId: input.sourceDocId, sourceLineId: input.sourceLineId, reason: input.reason, reservationId: input.reservationId, transferGroupId: groupId };
    const outs = input.lotId
      ? [await this.move(tx, ctx, { ...base, warehouseId: input.fromWarehouseId, lotId: input.lotId, qty: dec(input.qty).negated().toString() })]
      : await this.moveOutFifo(tx, ctx, { ...base, warehouseId: input.fromWarehouseId, qty: input.qty });
    const ins = [];
    for (const out of outs) {
      ins.push(
        await this.move(tx, ctx, {
          itemId: input.itemId,
          warehouseId: input.toWarehouseId,
          lotId: out.lotId,
          type: 'TRANSFER_IN',
          qty: out.qty.negated().toString(),
          unitCost: out.unitCost.toString(),
          sourceDocType: input.sourceDocType,
          sourceDocId: input.sourceDocId,
          sourceLineId: input.sourceLineId,
          transferGroupId: groupId,
          reason: input.reason,
        }),
      );
    }
    return { outs, ins };
  }

  /**
   * Bloquea de antemano las filas de saldo que tocará un documento, en orden determinista
   * (cabecera antes que lotes) para evitar interbloqueos entre documentos concurrentes.
   */
  async prelock(tx: Tx, companyId: string, keys: { itemId: string; warehouseId: string; lotId?: string | null }[]) {
    const all = keys.flatMap((k) => [{ ...k, lotId: null }, k]);
    const unique = new Map(all.map((k) => [`${k.itemId}|${k.warehouseId}|${k.lotId ?? ''}`, k]));
    for (const key of [...unique.keys()].sort()) {
      const k = unique.get(key)!;
      await this.lockRow(tx, companyId, k.itemId, k.warehouseId, k.lotId ?? null);
    }
  }

  /** Costo promedio vigente del artículo en el depósito (ponderado entre lotes si no se indica uno). */
  async currentAvgCost(tx: Tx, itemId: string, warehouseId: string, lotId: string | null = null): Promise<string> {
    if (lotId) {
      const b = await tx.stockBalance.findFirst({ where: { itemId, warehouseId, locationId: null, lotId }, select: { avgCost: true } });
      return b?.avgCost.toString() ?? '0';
    }
    const rows = await tx.$queryRaw<{ cost: Prisma.Decimal | null }[]>`
      SELECT CASE WHEN SUM(on_hand) > 0 THEN SUM(on_hand * avg_cost) / SUM(on_hand) ELSE MAX(avg_cost) END AS cost
      FROM stock_balances WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
    return rows[0]?.cost ? dec(rows[0].cost.toString()).toDecimalPlaces(6).toString() : '0';
  }

  /** Disponible (físico − reservado) del artículo en el depósito, sumando lotes. */
  async available(tx: Tx, itemId: string, warehouseId: string): Promise<Dec> {
    const t = await this.totals(tx, itemId, warehouseId);
    return t.onHand.minus(t.reserved);
  }

  async reserve(
    tx: Tx,
    ctx: Ctx,
    input: { itemId: string; warehouseId: string; qty: string; sourceDocType: string; sourceDocId: string; sourceLineId?: string },
  ) {
    const item = await this.loadItem(tx, input.itemId);
    const header = await this.lockRow(tx, ctx.companyId, input.itemId, input.warehouseId, null);
    const t = await this.totals(tx, input.itemId, input.warehouseId);
    const qty = assertCanReserve(
      { onHand: t.onHand.toString(), reserved: t.reserved.toString(), avgCost: '0', allowNegative: item.allowNegative },
      input.qty,
    );
    await tx.$executeRaw`UPDATE stock_balances SET reserved = reserved + ${qty.toString()}::numeric, updated_at = now() WHERE id = ${header.id}::uuid`;
    return tx.stockReservation.create({
      data: {
        companyId: ctx.companyId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        qty: qty.toString(),
        sourceDocType: input.sourceDocType,
        sourceDocId: input.sourceDocId,
        sourceLineId: input.sourceLineId ?? null,
        createdBy: ctx.userId,
      },
    });
  }

  /** Libera lo pendiente de una reserva. Idempotente si ya no está activa (devuelve null). */
  async release(tx: Tx, ctx: Pick<RequestContext, 'companyId'>, reservationId: string, opts: { strict?: boolean } = { strict: true }) {
    const rows = await tx.$queryRaw<{ id: string; qty: Prisma.Decimal; consumed_qty: Prisma.Decimal; status: string; item_id: string; warehouse_id: string }[]>`
      SELECT id, qty, consumed_qty, status, item_id, warehouse_id FROM stock_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
    const r = rows[0];
    if (!r) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La reserva no existe.', 404);
    if (r.status !== 'ACTIVE') {
      if (opts.strict) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La reserva ya fue consumida o liberada.');
      return null;
    }
    const pending = dec(r.qty.toString()).minus(r.consumed_qty.toString());
    const header = await this.lockRow(tx, ctx.companyId, r.item_id, r.warehouse_id, null);
    await tx.$executeRaw`UPDATE stock_balances SET reserved = reserved - ${pending.toString()}::numeric, updated_at = now() WHERE id = ${header.id}::uuid`;
    return tx.stockReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
  }

  /** Pendiente de una reserva (0 si no está activa). */
  async reservationPending(tx: Tx, reservationId: string | null): Promise<Dec> {
    if (!reservationId) return dec(0);
    const r = await tx.stockReservation.findUnique({ where: { id: reservationId } });
    if (!r || r.status !== 'ACTIVE') return dec(0);
    return dec(r.qty.toString()).minus(r.consumedQty.toString());
  }

  /**
   * Reconciliación: proyección de saldos vs suma de movimientos y de reservas activas.
   * Devuelve las diferencias (debería ser siempre vacío).
   */
  async reconcile(tx: Tx) {
    return tx.$queryRaw<{ item_id: string; warehouse_id: string; on_hand: string; movements: string; reserved: string; reservations: string }[]>`
      WITH m AS (
        SELECT item_id, warehouse_id, lot_id, SUM(qty) AS movements FROM stock_movements GROUP BY 1, 2, 3
      ), r AS (
        SELECT item_id, warehouse_id, SUM(qty - consumed_qty) AS reservations
        FROM stock_reservations WHERE status = 'ACTIVE' GROUP BY 1, 2
      )
      SELECT b.item_id, b.warehouse_id, b.on_hand::text, COALESCE(m.movements, 0)::text AS movements,
             b.reserved::text, COALESCE(r.reservations, 0)::text AS reservations
      FROM stock_balances b
      LEFT JOIN m ON m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id AND m.lot_id IS NOT DISTINCT FROM b.lot_id
      LEFT JOIN r ON r.item_id = b.item_id AND r.warehouse_id = b.warehouse_id AND b.lot_id IS NULL
      WHERE b.on_hand <> COALESCE(m.movements, 0)
         OR (b.lot_id IS NULL AND b.reserved <> COALESCE(r.reservations, 0))
         OR (b.lot_id IS NOT NULL AND b.reserved <> 0)`;
  }
}
