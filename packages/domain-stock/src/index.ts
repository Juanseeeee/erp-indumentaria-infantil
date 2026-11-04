import { Dec, DecimalLike, DomainError, ErrorCodes, dec, roundQty, roundUnitCost } from '@erp/domain-core';

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
  'SALE_DELIVERY',
  'SALE_RETURN',
  'PROD_ISSUE',
  'PROD_RETURN',
  'PROD_OUTPUT',
  'PROD_SCRAP',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
  'COUNT_ADJUSTMENT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Tipos de movimiento que valorizan entradas con su propio costo (afectan el costo promedio). */
const COST_SETTING_INBOUND: ReadonlySet<MovementType> = new Set([
  'OPENING',
  'PURCHASE_RECEIPT',
  'PROD_OUTPUT',
  'PROD_RETURN',
  'SALE_RETURN',
  'ADJUSTMENT',
  'COUNT_ADJUSTMENT',
  'TRANSFER_IN',
]);

export interface BalanceSnapshot {
  onHand: DecimalLike;
  reserved: DecimalLike;
  avgCost: DecimalLike;
  allowNegative: boolean;
}

export interface MovementInput {
  type: MovementType;
  /** Cantidad con signo en la unidad base. */
  qty: DecimalLike;
  /** Costo unitario de la entrada; si se omite en una entrada se usa el costo promedio vigente. */
  unitCost?: DecimalLike | null;
}

export interface MovementResult {
  onHand: Dec;
  avgCost: Dec;
  /** Costo unitario con el que se registra el movimiento. */
  unitCost: Dec;
}

export function available(b: Pick<BalanceSnapshot, 'onHand' | 'reserved'>): Dec {
  return dec(b.onHand).minus(dec(b.reserved));
}

/**
 * Aplica un movimiento a un saldo y devuelve el nuevo saldo y el costo promedio ponderado.
 * Reglas:
 *  - Las salidas no pueden dejar el físico por debajo de lo reservado, salvo que lo consuman
 *    (eso lo controla `consumeReservation` antes de llamar acá) ni en negativo sin permiso.
 *  - Las entradas recalculan el costo promedio ponderado.
 *  - Las salidas se valorizan al costo promedio vigente.
 */
export function applyMovement(
  balance: BalanceSnapshot,
  move: MovementInput,
  opts: { releasedReservation?: DecimalLike } = {},
): MovementResult {
  const qty = roundQty(move.qty);
  if (qty.isZero()) {
    throw new DomainError(ErrorCodes.CANTIDAD_INVALIDA, 'La cantidad del movimiento no puede ser cero.');
  }
  const onHand = dec(balance.onHand);
  const avgCost = dec(balance.avgCost);
  const newOnHand = onHand.plus(qty);

  if (qty.isNegative()) {
    const reservedAfter = dec(balance.reserved).minus(dec(opts.releasedReservation ?? 0));
    const freeAfter = newOnHand.minus(reservedAfter);
    if (!balance.allowNegative && (newOnHand.isNegative() || freeAfter.isNegative())) {
      throw new DomainError(
        ErrorCodes.STOCK_INSUFICIENTE,
        `Stock insuficiente: disponible ${available(balance).toString()}, se intenta descontar ${qty.abs().toString()}.`,
        409,
        { available: available(balance).toString(), requested: qty.abs().toString() },
      );
    }
    return { onHand: newOnHand, avgCost, unitCost: avgCost };
  }

  const inboundCost =
    move.unitCost !== undefined && move.unitCost !== null && COST_SETTING_INBOUND.has(move.type)
      ? dec(move.unitCost)
      : avgCost;
  if (inboundCost.isNegative()) {
    throw new DomainError(ErrorCodes.VALIDACION, 'El costo unitario no puede ser negativo.');
  }

  // Si el saldo previo es ≤ 0, el promedio se reinicia con el costo de la entrada.
  const newAvg = onHand.lte(0)
    ? inboundCost
    : onHand.times(avgCost).plus(qty.times(inboundCost)).div(newOnHand);

  return { onHand: newOnHand, avgCost: roundUnitCost(newAvg), unitCost: roundUnitCost(inboundCost) };
}

/** Valida que se pueda reservar `qty` sobre el saldo. */
export function assertCanReserve(balance: BalanceSnapshot, qty: DecimalLike): Dec {
  const q = roundQty(qty);
  if (q.lte(0)) throw new DomainError(ErrorCodes.CANTIDAD_INVALIDA, 'La cantidad a reservar debe ser positiva.');
  const free = available(balance);
  if (free.lt(q)) {
    throw new DomainError(
      ErrorCodes.STOCK_INSUFICIENTE,
      `No hay disponible suficiente para reservar: disponible ${free.toString()}, pedido ${q.toString()}.`,
      409,
      { available: free.toString(), requested: q.toString() },
    );
  }
  return q;
}

export function isInbound(type: MovementType): boolean {
  return ['OPENING', 'PURCHASE_RECEIPT', 'SALE_RETURN', 'PROD_OUTPUT', 'PROD_RETURN', 'TRANSFER_IN'].includes(type);
}

export function isOutbound(type: MovementType): boolean {
  return ['PURCHASE_RETURN', 'SALE_DELIVERY', 'PROD_ISSUE', 'PROD_SCRAP', 'TRANSFER_OUT'].includes(type);
}

/** Verifica que el signo de la cantidad sea coherente con el tipo de movimiento. */
export function assertSignMatchesType(type: MovementType, qty: DecimalLike): void {
  const q = dec(qty);
  if ((isInbound(type) && q.lte(0)) || (isOutbound(type) && q.gte(0))) {
    throw new DomainError(
      ErrorCodes.VALIDACION,
      `El signo de la cantidad no corresponde al tipo de movimiento ${type}.`,
    );
  }
}
