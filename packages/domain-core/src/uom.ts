import { Dec, DecimalLike, dec, roundQty } from './decimal';
import { DomainError, ErrorCodes } from './errors';

export type UomDimension = 'UNIT' | 'LENGTH' | 'MASS' | 'AREA';

export interface Uom {
  id: string;
  code: string;
  dimension: UomDimension;
}

export interface UomConversion {
  fromUomId: string;
  toUomId: string;
  factor: DecimalLike;
  /** null = conversión universal (m ↔ cm); con valor = específica de ese item (rollo → m de esta tela). */
  itemId: string | null;
}

/**
 * Convierte una cantidad entre unidades.
 * Prioridad: conversión específica del item → conversión universal → inversa de cualquiera.
 * Unidades de distinta dimensión solo se convierten con una conversión específica del item.
 */
export function convertQty(
  qty: DecimalLike,
  from: Uom,
  to: Uom,
  conversions: UomConversion[],
  itemId?: string,
): Dec {
  if (from.id === to.id) return dec(qty);

  const find = (a: string, b: string) =>
    conversions.find((c) => c.fromUomId === a && c.toUomId === b && itemId && c.itemId === itemId) ??
    conversions.find((c) => c.fromUomId === a && c.toUomId === b && c.itemId === null);

  const direct = find(from.id, to.id);
  const inverse = direct ? undefined : find(to.id, from.id);
  const conv = direct ?? inverse;

  if (!conv || (from.dimension !== to.dimension && conv.itemId === null)) {
    throw new DomainError(
      ErrorCodes.CONVERSION_INCOMPATIBLE,
      `No hay una conversión definida de ${from.code} a ${to.code}${itemId ? ' para este artículo' : ''}.`,
    );
  }
  const factor = dec(conv.factor);
  if (factor.lte(0)) {
    throw new DomainError(ErrorCodes.CONVERSION_INCOMPATIBLE, 'El factor de conversión debe ser positivo.');
  }
  return roundQty(direct ? dec(qty).times(factor) : dec(qty).div(factor));
}
