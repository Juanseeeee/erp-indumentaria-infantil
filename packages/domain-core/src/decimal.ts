import Decimal from 'decimal.js';

/**
 * Aritmética decimal exacta para dinero y cantidades.
 * Nunca usar `number` para importes: toda entrada/salida pasa por string o Decimal.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalLike = Decimal | string | number;
export { D as Dec };
export type Dec = Decimal;

export const MONEY_SCALE = 2;
export const QTY_SCALE = 4;
export const UNIT_COST_SCALE = 6;

export function dec(value: DecimalLike): Decimal {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('Valor numérico inválido');
  }
  return new D(value);
}

/** Redondeo comercial (half-up) a 2 decimales. */
export function roundMoney(value: DecimalLike): Decimal {
  return dec(value).toDecimalPlaces(MONEY_SCALE, D.ROUND_HALF_UP);
}

export function roundQty(value: DecimalLike): Decimal {
  return dec(value).toDecimalPlaces(QTY_SCALE, D.ROUND_HALF_UP);
}

export function roundUnitCost(value: DecimalLike): Decimal {
  return dec(value).toDecimalPlaces(UNIT_COST_SCALE, D.ROUND_HALF_UP);
}

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), dec(0));
}

/**
 * Prorratea `total` según `weights`, redondeando a `scale` decimales.
 * El residuo de redondeo se asigna a la última parte con peso no nulo,
 * de modo que la suma de las partes es exactamente igual al total.
 */
export function allocate(total: DecimalLike, weights: DecimalLike[], scale = MONEY_SCALE): Decimal[] {
  const t = dec(total);
  const w = weights.map(dec);
  if (w.some((x) => x.isNegative())) throw new RangeError('Los pesos no pueden ser negativos');
  const totalWeight = sum(w);
  if (totalWeight.isZero()) {
    if (t.isZero()) return w.map(() => dec(0));
    throw new RangeError('No se puede prorratear sobre pesos nulos');
  }
  const parts = w.map((x) => t.times(x).div(totalWeight).toDecimalPlaces(scale, D.ROUND_HALF_UP));
  const residue = t.minus(sum(parts));
  if (!residue.isZero()) {
    let last = -1;
    w.forEach((x, i) => {
      if (!x.isZero()) last = i;
    });
    parts[last] = parts[last]!.plus(residue);
  }
  return parts;
}

/** Formato argentino: "$ 1.234,56". Solo para presentación. */
export function formatMoneyAR(value: DecimalLike, currencySymbol = '$'): string {
  const v = roundMoney(value);
  const negative = v.isNegative();
  const [intPart, frac] = v.abs().toFixed(MONEY_SCALE).split('.');
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${currencySymbol} ${grouped},${frac}`;
}
