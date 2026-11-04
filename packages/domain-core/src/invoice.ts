import { Dec, DecimalLike, dec, roundMoney, sum } from './decimal';
import { DomainError, ErrorCodes } from './errors';

export interface InvoiceLineInput {
  qty: DecimalLike;
  unitPrice: DecimalLike;
  vatRate: DecimalLike;
}

export const VAT_RATES = ['0', '2.5', '5', '10.5', '21', '27'] as const;

/**
 * Totales de un comprobante. Redondeo por línea (criterio de ARCA para comprobantes
 * con detalle de ítems): neto y IVA de cada línea a 2 decimales, luego se suman.
 */
export function computeInvoiceTotals(lines: InvoiceLineInput[], otherTaxes: DecimalLike = 0) {
  const detail = lines.map((l) => {
    const rate = dec(l.vatRate);
    if (!VAT_RATES.some((r) => dec(r).eq(rate))) {
      throw new DomainError(ErrorCodes.VALIDACION, `Alícuota de IVA inválida: ${rate.toString()}%.`);
    }
    const net = roundMoney(dec(l.qty).times(l.unitPrice));
    const vat = roundMoney(net.times(rate).div(100));
    return { net, vat };
  });
  const net = sum(detail.map((d) => d.net));
  const vat = sum(detail.map((d) => d.vat));
  const other = roundMoney(otherTaxes);
  return { lines: detail, netTotal: net, vatTotal: vat, otherTaxes: other, total: net.plus(vat).plus(other) as Dec };
}

/** Diferencia porcentual de precio respecto de una referencia (para controles de compras). */
export function priceDeviationPct(actual: DecimalLike, reference: DecimalLike): Dec {
  const ref = dec(reference);
  if (ref.isZero()) return dec(0);
  return dec(actual).minus(ref).div(ref).times(100).toDecimalPlaces(2);
}
