import { Dec, DecimalLike, DomainError, ErrorCodes, computeInvoiceTotals, dec, roundMoney, roundUnitCost, sum } from '@erp/domain-core';

/**
 * Reglas de ventas sin dependencias de infraestructura: letra de comprobante, precios,
 * descuentos, crédito, imputación sugerida, comisiones y armado del pedido de CAE.
 */

export type TaxCond = 'RI' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL' | 'NO_ALCANZADO';
export type InvoiceLetter = 'A' | 'B' | 'C';
export type SalesDocKind = 'F' | 'NC' | 'ND';

// ─── Comprobantes ───

/**
 * Letra según la condición frente al IVA de quien emite y de quien recibe.
 * Un responsable inscripto emite A a otro inscripto o a un monotributista (RG 5003) y B al resto.
 * Monotributistas y exentos emiten C.
 */
export function invoiceLetter(issuer: string, receiver: TaxCond): InvoiceLetter {
  if (issuer === 'MONOTRIBUTO' || issuer === 'EXENTO') return 'C';
  if (issuer !== 'RI') throw new DomainError(ErrorCodes.VALIDACION, 'La condición fiscal de la empresa no permite emitir comprobantes.');
  return receiver === 'RI' || receiver === 'MONOTRIBUTO' ? 'A' : 'B';
}

export const salesDocType = (kind: SalesDocKind, letter: InvoiceLetter) => `${kind}${letter}`;
export const docKind = (docType: string): SalesDocKind => (docType.startsWith('NC') ? 'NC' : docType.startsWith('ND') ? 'ND' : 'F');
export const docLetter = (docType: string) => docType.slice(-1) as InvoiceLetter;

/** Signo en la cuenta corriente del cliente: facturas y débitos aumentan la deuda, créditos la reducen. */
export const receivableSign = (docType: string) => (docKind(docType) === 'NC' ? -1 : 1);

export const SALES_DOC_LABELS: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'Nota de crédito A', NCB: 'Nota de crédito B', NCC: 'Nota de crédito C',
  NDA: 'Nota de débito A', NDB: 'Nota de débito B', NDC: 'Nota de débito C',
};

// ─── Precios y descuentos ───

/** Precio unitario neto de IVA (6 decimales) a partir del precio de lista. */
export function netUnitPrice(listPrice: DecimalLike, includesVat: boolean, vatRate: DecimalLike): Dec {
  const p = dec(listPrice);
  return includesVat ? roundUnitCost(p.div(dec(1).plus(dec(vatRate).div(100)))) : roundUnitCost(p);
}

/** Precio de una lista derivada: base ± porcentaje, redondeado a centavos. */
export function derivedPrice(basePrice: DecimalLike, markupPct: DecimalLike): Dec {
  return roundMoney(dec(basePrice).times(dec(1).plus(dec(markupPct).div(100))));
}

/**
 * Actualización masiva: aplica el porcentaje y redondea hacia arriba al múltiplo indicado
 * (p.ej. 10 o 100 para listas minoristas). Sin múltiplo, redondea a centavos.
 */
export function adjustPrice(price: DecimalLike, pct: DecimalLike, roundTo?: DecimalLike | null): Dec {
  const raw = dec(price).times(dec(1).plus(dec(pct).div(100)));
  if (!roundTo || dec(roundTo).lte(0)) return roundMoney(raw);
  const step = dec(roundTo);
  return raw.div(step).ceil().times(step);
}

export interface SalesLine {
  qty: DecimalLike;
  /** Neto de IVA, antes del descuento. */
  unitPrice: DecimalLike;
  discountPct?: DecimalLike;
  vatRate: DecimalLike;
}

function assertDiscount(d: Dec) {
  if (d.isNegative() || d.gte(100)) throw new DomainError(ErrorCodes.VALIDACION, 'El descuento debe estar entre 0 y 99,99 %.');
}

/** Totales con descuento por línea. Redondeo por línea, igual que el resto de los comprobantes. */
export interface Totals {
  lines: { net: Dec; vat: Dec }[];
  netTotal: Dec;
  vatTotal: Dec;
  otherTaxes: Dec;
  total: Dec;
}

export function salesTotals(lines: SalesLine[], otherTaxes: DecimalLike = 0): Totals {
  return computeInvoiceTotals(
    lines.map((l) => {
      const d = dec(l.discountPct ?? 0);
      assertDiscount(d);
      return { qty: l.qty, unitPrice: dec(l.unitPrice).times(dec(1).minus(d.div(100))), vatRate: l.vatRate };
    }),
    otherTaxes,
  );
}

/** Totales en la forma que se informa a ARCA: base e IVA agrupados por alícuota. */
export function vatBreakdown(lines: { vatRate: DecimalLike; net: DecimalLike; vat: DecimalLike }[]) {
  const map = new Map<string, { rate: string; base: Dec; amount: Dec }>();
  for (const l of lines) {
    const rate = dec(l.vatRate).toString();
    const cur = map.get(rate) ?? { rate, base: dec(0), amount: dec(0) };
    cur.base = cur.base.plus(l.net);
    cur.amount = cur.amount.plus(l.vat);
    map.set(rate, cur);
  }
  return [...map.values()].sort((a, b) => dec(a.rate).cmp(b.rate));
}

// ─── Crédito ───

export interface CreditInput {
  /** null = sin límite. */
  limit: DecimalLike | null;
  /** Saldo de la cuenta corriente (positivo = nos debe). */
  balance: DecimalLike;
  /** Pendiente de entregar de otros pedidos confirmados, con IVA. */
  openOrders: DecimalLike;
  /** Total con IVA del pedido que se confirma. */
  order: DecimalLike;
}

export function creditCheck(input: CreditInput): { exposure: Dec; exceeded: boolean; excess: Dec; limit: Dec | null } {
  const exposure = dec(input.balance).plus(input.openOrders).plus(input.order);
  if (input.limit === null) return { exposure, exceeded: false, excess: dec(0), limit: null as Dec | null };
  const limit = dec(input.limit);
  const excess = exposure.minus(limit);
  return { exposure, exceeded: excess.gt(0), excess: excess.gt(0) ? excess : dec(0), limit };
}

// ─── Imputación ───

export interface OpenDebit {
  id: string;
  openAmount: DecimalLike;
  dueDate: Date | string | null;
  date: Date | string;
}

/** Sugerencia FIFO por vencimiento (sin vencimiento, por fecha). Devuelve solo las imputaciones con importe. */
export function suggestAllocation(debits: OpenDebit[], amount: DecimalLike): { id: string; amount: Dec }[] {
  let pending = dec(amount);
  if (pending.lte(0)) return [];
  const key = (d: OpenDebit) => new Date(d.dueDate ?? d.date).getTime();
  const sorted = [...debits].filter((d) => dec(d.openAmount).gt(0)).sort((a, b) => key(a) - key(b) || new Date(a.date).getTime() - new Date(b.date).getTime());
  const out: { id: string; amount: Dec }[] = [];
  for (const d of sorted) {
    if (pending.lte(0)) break;
    const take = Dec.min(pending, dec(d.openAmount));
    out.push({ id: d.id, amount: take });
    pending = pending.minus(take);
  }
  return out;
}

// ─── Comisiones (confirmado: sobre lo cobrado) ───

export type CommissionBase = 'NET' | 'TOTAL';

/**
 * Comisión que genera un cobro imputado a un comprobante. Con base NET se descuenta la
 * proporción de IVA y otros impuestos del comprobante (cobrar el 50 % de la factura = 50 % del neto).
 * Una reversa se calcula con importe negativo y da la comisión negativa exacta.
 */
export function commissionOnCollection(input: { allocated: DecimalLike; docTotal: DecimalLike; docNet: DecimalLike; pct: DecimalLike; base: CommissionBase }): { base: Dec; amount: Dec } {
  const allocated = dec(input.allocated);
  const total = dec(input.docTotal);
  if (total.isZero()) return { base: dec(0), amount: dec(0) };
  const base = roundMoney(input.base === 'NET' ? allocated.times(input.docNet).div(total) : allocated);
  return { base, amount: roundMoney(base.times(input.pct).div(100)) };
}

// ─── Estados del pedido ───

// ─── Promociones ───

export type PromotionScope = 'ALL' | 'PRODUCTS' | 'CATEGORIES' | 'COLLECTIONS';

export interface PromotionRule {
  id: string;
  name: string;
  discountPct: DecimalLike;
  /** Unidades mínimas del pedido dentro del alcance (0 = sin mínimo). Es un descuento por volumen. */
  minQty: DecimalLike;
  scope: PromotionScope;
  /** Modelos, categorías o colecciones según el alcance. */
  targetIds: string[];
  /** Vacío = todos los clientes / todas las listas. */
  customerIds: string[];
  priceListIds: string[];
  validFrom: Date;
  /** Inclusive; null = sin vencimiento. */
  validTo: Date | null;
  isActive: boolean;
}

export interface PromotionLine {
  itemId: string;
  qty: DecimalLike;
  productId: string;
  categoryId: string | null;
  collectionId: string | null;
}

export interface LineDiscount {
  itemId: string;
  discountPct: Dec;
  /** Promoción aplicada; null si rige el descuento del cliente. */
  promotionId: string | null;
  promotionName: string | null;
}

function inScope(p: PromotionRule, l: PromotionLine) {
  if (p.scope === 'ALL') return true;
  const key = p.scope === 'PRODUCTS' ? l.productId : p.scope === 'CATEGORIES' ? l.categoryId : l.collectionId;
  return !!key && p.targetIds.includes(key);
}

/**
 * Descuento de cada línea del pedido: el mejor entre el descuento general del cliente y las promociones
 * vigentes que le corresponden. No se acumulan. Una promoción con mínimo de unidades cuenta todas las
 * líneas del pedido dentro de su alcance (12 bodies de cualquier talle y color, por ejemplo).
 */
export function applyPromotions(input: { lines: PromotionLine[]; promotions: PromotionRule[]; customerId: string; priceListId: string; customerDiscountPct: DecimalLike; date: Date }): LineDiscount[] {
  const t = input.date.getTime();
  const eligible = input.promotions.filter(
    (p) =>
      p.isActive &&
      p.validFrom.getTime() <= t &&
      (!p.validTo || p.validTo.getTime() >= t) &&
      (!p.customerIds.length || p.customerIds.includes(input.customerId)) &&
      (!p.priceListIds.length || p.priceListIds.includes(input.priceListId)) &&
      // Volumen: suma de unidades del pedido dentro del alcance.
      sum(input.lines.filter((l) => inScope(p, l)).map((l) => l.qty)).gte(dec(p.minQty)),
  );
  const base = dec(input.customerDiscountPct);
  return input.lines.map((l) => {
    const best = eligible
      .filter((p) => inScope(p, l))
      .sort((a, b) => dec(b.discountPct).comparedTo(dec(a.discountPct)) || a.name.localeCompare(b.name))[0];
    return best && dec(best.discountPct).gt(base)
      ? { itemId: l.itemId, discountPct: dec(best.discountPct), promotionId: best.id, promotionName: best.name }
      : { itemId: l.itemId, discountPct: base, promotionId: null, promotionName: null };
  });
}

export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_DELIVERED' | 'DELIVERED' | 'CLOSED' | 'CANCELLED';

const ORDER_TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED', 'CONFIRMED'],
  PARTIALLY_DELIVERED: ['PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'CONFIRMED'],
  DELIVERED: ['PARTIALLY_DELIVERED', 'CONFIRMED', 'DELIVERED', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function assertOrderTransition(from: SalesOrderStatus, to: SalesOrderStatus) {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `El pedido no puede pasar de ${from} a ${to}.`);
  }
}

/** Estado según lo entregado y lo cancelado de cada línea. */
export function orderStatusFromLines(lines: { qty: DecimalLike; deliveredQty: DecimalLike; cancelledQty: DecimalLike }[]): SalesOrderStatus {
  const delivered = sum(lines.map((l) => l.deliveredQty));
  const pending = sum(lines.map((l) => dec(l.qty).minus(l.deliveredQty).minus(l.cancelledQty)));
  if (pending.lte(0)) return delivered.gt(0) ? 'DELIVERED' : 'CANCELLED';
  return delivered.gt(0) ? 'PARTIALLY_DELIVERED' : 'CONFIRMED';
}

// ─── ARCA: Web Service de Factura Electrónica (WSFEv1) ───

export const ARCA_CBTE_TIPO: Record<string, number> = { FA: 1, NDA: 2, NCA: 3, FB: 6, NDB: 7, NCB: 8, FC: 11, NDC: 12, NCC: 13 };
export const ARCA_IVA_ID: Record<string, number> = { '0': 3, '10.5': 4, '21': 5, '27': 6, '5': 8, '2.5': 9 };
export const ARCA_DOC_TIPO: Record<string, number> = { CUIT: 80, CUIL: 86, DNI: 96, OTHER: 99 };
/** Condición frente al IVA del receptor (RG 5616). */
export const ARCA_COND_IVA_RECEPTOR: Record<TaxCond, number> = { RI: 1, EXENTO: 4, CONSUMIDOR_FINAL: 5, MONOTRIBUTO: 6, NO_ALCANZADO: 15 };

export interface WsfeInput {
  docType: string;
  pointOfSale: number;
  number: number;
  issueDate: Date;
  receiver: { taxIdType: string; taxId: string; taxCondition: TaxCond };
  netTotal: DecimalLike;
  vatTotal: DecimalLike;
  otherTaxes: DecimalLike;
  total: DecimalLike;
  lines: { vatRate: DecimalLike; net: DecimalLike; vat: DecimalLike }[];
  /** Comprobante asociado (obligatorio en notas de crédito y débito). */
  associated?: { docType: string; pointOfSale: number; number: number; issuerCuit: string; issueDate: Date } | null;
}

const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
const n2 = (v: DecimalLike) => Number(roundMoney(v).toFixed(2));

/**
 * Detalle de FECAESolicitar para un comprobante de productos (Concepto 1) en pesos.
 * Valida las sumas que ARCA rechaza (ImpTotal, Σ IVA) antes de enviar.
 */
export function buildFeCaeDetail(input: WsfeInput) {
  const cbteTipo = ARCA_CBTE_TIPO[input.docType];
  if (!cbteTipo) throw new DomainError(ErrorCodes.VALIDACION, `Tipo de comprobante sin código ARCA: ${input.docType}.`);
  const letter = docLetter(input.docType);
  const finalConsumer = input.receiver.taxCondition === 'CONSUMIDOR_FINAL' && input.receiver.taxIdType !== 'CUIT';
  const docTipo = finalConsumer && !input.receiver.taxId ? 99 : (ARCA_DOC_TIPO[input.receiver.taxIdType] ?? 99);
  const docNro = docTipo === 99 ? 0 : Number(input.receiver.taxId);
  if (letter === 'A' && docTipo !== 80) throw new DomainError(ErrorCodes.VALIDACION, 'Un comprobante A requiere el CUIT del cliente.');

  const iva = letter === 'C' ? [] : vatBreakdown(input.lines).map((v) => {
    const id = ARCA_IVA_ID[v.rate];
    if (!id) throw new DomainError(ErrorCodes.VALIDACION, `Alícuota sin código ARCA: ${v.rate} %.`);
    return { Id: id, BaseImp: n2(v.base), Importe: n2(v.amount) };
  });
  const impNeto = letter === 'C' ? dec(input.netTotal).plus(input.vatTotal) : dec(input.netTotal);
  const impIva = letter === 'C' ? dec(0) : dec(input.vatTotal);
  const expected = impNeto.plus(impIva).plus(input.otherTaxes);
  if (!expected.eq(input.total)) {
    throw new DomainError(ErrorCodes.VALIDACION, `El total (${dec(input.total).toFixed(2)}) no coincide con neto + IVA + tributos (${expected.toFixed(2)}).`);
  }
  if (letter !== 'C' && !sum(iva.map((i) => String(i.Importe))).eq(impIva)) {
    throw new DomainError(ErrorCodes.VALIDACION, 'La suma del IVA por alícuota no coincide con el IVA total.');
  }
  if (docKind(input.docType) !== 'F' && !input.associated) {
    throw new DomainError(ErrorCodes.VALIDACION, 'Las notas de crédito y débito deben indicar el comprobante asociado.');
  }

  return {
    FeCabReq: { CantReg: 1, PtoVta: input.pointOfSale, CbteTipo: cbteTipo },
    FECAEDetRequest: {
      Concepto: 1,
      DocTipo: docTipo,
      DocNro: docNro,
      CbteDesde: input.number,
      CbteHasta: input.number,
      CbteFch: yyyymmdd(input.issueDate),
      ImpTotal: n2(input.total),
      ImpTotConc: 0,
      ImpNeto: n2(impNeto),
      ImpOpEx: 0,
      ImpTrib: n2(input.otherTaxes),
      ImpIVA: n2(impIva),
      MonId: 'PES',
      MonCotiz: 1,
      CondicionIVAReceptorId: ARCA_COND_IVA_RECEPTOR[input.receiver.taxCondition],
      ...(iva.length ? { Iva: { AlicIva: iva } } : {}),
      ...(input.associated
        ? {
            CbtesAsoc: {
              CbteAsoc: [{
                Tipo: ARCA_CBTE_TIPO[input.associated.docType],
                PtoVta: input.associated.pointOfSale,
                Nro: input.associated.number,
                Cuit: input.associated.issuerCuit,
                CbteFch: yyyymmdd(input.associated.issueDate),
              }],
            },
          }
        : {}),
    },
  };
}
