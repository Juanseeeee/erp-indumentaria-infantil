import { describe, expect, it } from 'vitest';
import { DomainError } from '@erp/domain-core';
import {
  adjustPrice,
  applyPromotions,
  type PromotionRule,
  buildFeCaeDetail,
  commissionOnCollection,
  creditCheck,
  derivedPrice,
  invoiceLetter,
  netUnitPrice,
  orderStatusFromLines,
  receivableSign,
  salesTotals,
  suggestAllocation,
} from './index';

describe('letra del comprobante', () => {
  it('RI emite A a inscriptos y monotributistas, B a consumidor final y exentos', () => {
    expect(invoiceLetter('RI', 'RI')).toBe('A');
    expect(invoiceLetter('RI', 'MONOTRIBUTO')).toBe('A');
    expect(invoiceLetter('RI', 'CONSUMIDOR_FINAL')).toBe('B');
    expect(invoiceLetter('RI', 'EXENTO')).toBe('B');
  });
  it('monotributo emite C', () => expect(invoiceLetter('MONOTRIBUTO', 'RI')).toBe('C'));
  it('las notas de crédito restan en la cuenta corriente', () => {
    expect(receivableSign('NCA')).toBe(-1);
    expect(receivableSign('FB')).toBe(1);
    expect(receivableSign('NDB')).toBe(1);
  });
});

describe('precios', () => {
  it('quita el IVA de una lista con IVA incluido', () => {
    expect(netUnitPrice('12100', true, '21').toString()).toBe('10000');
    expect(netUnitPrice('9999', false, '21').toString()).toBe('9999');
  });
  it('lista derivada y actualización con redondeo a múltiplo', () => {
    expect(derivedPrice('10000', '-10').toString()).toBe('9000');
    expect(adjustPrice('10450', '8').toString()).toBe('11286');
    expect(adjustPrice('10450', '8', '100').toString()).toBe('11300');
  });
  it('totales con descuento por línea y redondeo por línea', () => {
    // 7 × 3.333,33 con 5 % = 22.166,6445 → 22.166,64; IVA 21 % = 4.654,99
    const t = salesTotals([{ qty: '7', unitPrice: '3333.33', discountPct: '5', vatRate: '21' }]);
    expect(t.netTotal.toString()).toBe('22166.64');
    expect(t.vatTotal.toString()).toBe('4654.99');
    expect(t.total.toString()).toBe('26821.63');
  });
  it('rechaza descuentos fuera de rango', () => {
    expect(() => salesTotals([{ qty: '1', unitPrice: '10', discountPct: '100', vatRate: '21' }])).toThrow(DomainError);
  });
});

describe('crédito', () => {
  it('suma saldo, pedidos abiertos y el pedido nuevo', () => {
    const r = creditCheck({ limit: '1000000', balance: '600000', openOrders: '250000', order: '200000' });
    expect(r.exceeded).toBe(true);
    expect(r.excess.toString()).toBe('50000');
  });
  it('sin límite no bloquea', () => expect(creditCheck({ limit: null, balance: '9', openOrders: '9', order: '9' }).exceeded).toBe(false));
});

describe('imputación sugerida', () => {
  it('imputa FIFO por vencimiento y deja el resto sin imputar', () => {
    const r = suggestAllocation(
      [
        { id: 'b', openAmount: '500', dueDate: '2026-11-30', date: '2026-10-01' },
        { id: 'a', openAmount: '300', dueDate: '2026-10-31', date: '2026-10-15' },
        { id: 'c', openAmount: '0', dueDate: '2026-09-30', date: '2026-09-01' },
      ],
      '600',
    );
    expect(r.map((x) => [x.id, x.amount.toString()])).toEqual([['a', '300'], ['b', '300']]);
  });
});

describe('comisión sobre lo cobrado', () => {
  it('base neta proporcional a lo cobrado', () => {
    // Factura 121.000 (neto 100.000). Cobro de 60.500 → base 50.000 → 5 % = 2.500
    const c = commissionOnCollection({ allocated: '60500', docTotal: '121000', docNet: '100000', pct: '5', base: 'NET' });
    expect(c.base.toString()).toBe('50000');
    expect(c.amount.toString()).toBe('2500');
  });
  it('la reversa da la comisión negativa exacta', () => {
    const c = commissionOnCollection({ allocated: '-60500', docTotal: '121000', docNet: '100000', pct: '5', base: 'NET' });
    expect(c.amount.toString()).toBe('-2500');
  });
  it('base total', () => {
    expect(commissionOnCollection({ allocated: '1000', docTotal: '1210', docNet: '1000', pct: '3', base: 'TOTAL' }).amount.toString()).toBe('30');
  });
});

describe('estado del pedido', () => {
  it('se deriva de lo entregado y lo cancelado', () => {
    expect(orderStatusFromLines([{ qty: '10', deliveredQty: '0', cancelledQty: '0' }])).toBe('CONFIRMED');
    expect(orderStatusFromLines([{ qty: '10', deliveredQty: '4', cancelledQty: '0' }])).toBe('PARTIALLY_DELIVERED');
    expect(orderStatusFromLines([{ qty: '10', deliveredQty: '4', cancelledQty: '6' }])).toBe('DELIVERED');
    expect(orderStatusFromLines([{ qty: '10', deliveredQty: '0', cancelledQty: '10' }])).toBe('CANCELLED');
  });
});

describe('pedido de CAE (WSFEv1)', () => {
  const base = {
    pointOfSale: 3,
    number: 125,
    issueDate: new Date('2026-10-29T00:00:00Z'),
    receiver: { taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI' as const },
    otherTaxes: '0',
    lines: [
      { vatRate: '21', net: '1000', vat: '210' },
      { vatRate: '21', net: '500.5', vat: '105.11' },
      { vatRate: '10.5', net: '200', vat: '21' },
    ],
    netTotal: '1700.5',
    vatTotal: '336.11',
    total: '2036.61',
  };
  it('arma la factura A con IVA agrupado por alícuota y condición del receptor', () => {
    const r = buildFeCaeDetail({ ...base, docType: 'FA' });
    expect(r.FeCabReq).toEqual({ CantReg: 1, PtoVta: 3, CbteTipo: 1 });
    expect(r.FECAEDetRequest).toMatchObject({
      DocTipo: 80,
      DocNro: 30700000016,
      CbteDesde: 125,
      CbteFch: '20261029',
      ImpNeto: 1700.5,
      ImpIVA: 336.11,
      ImpTotal: 2036.61,
      CondicionIVAReceptorId: 1,
      Iva: { AlicIva: [{ Id: 4, BaseImp: 200, Importe: 21 }, { Id: 5, BaseImp: 1500.5, Importe: 315.11 }] },
    });
  });
  it('rechaza totales inconsistentes', () => {
    expect(() => buildFeCaeDetail({ ...base, docType: 'FA', total: '2036.6' })).toThrow(/no coincide/);
  });
  it('la nota de crédito exige comprobante asociado', () => {
    expect(() => buildFeCaeDetail({ ...base, docType: 'NCA' })).toThrow(/asociado/);
    const r = buildFeCaeDetail({
      ...base,
      docType: 'NCA',
      associated: { docType: 'FA', pointOfSale: 3, number: 120, issuerCuit: '30711111110', issueDate: new Date('2026-10-20') },
    });
    expect(r.FECAEDetRequest.CbtesAsoc?.CbteAsoc[0]).toMatchObject({ Tipo: 1, Nro: 120 });
  });
  it('factura B a consumidor final sin identificar', () => {
    const r = buildFeCaeDetail({ ...base, docType: 'FB', receiver: { taxIdType: 'OTHER', taxId: '', taxCondition: 'CONSUMIDOR_FINAL' } });
    expect(r.FECAEDetRequest).toMatchObject({ DocTipo: 99, DocNro: 0, CondicionIVAReceptorId: 5 });
  });
});

describe('promociones', () => {
  const d = (v: string) => new Date(`${v}T00:00:00.000Z`);
  const promo = (over: Partial<PromotionRule>): PromotionRule => ({
    id: 'p', name: 'Promo', discountPct: '10', minQty: '0', scope: 'ALL', targetIds: [], customerIds: [], priceListIds: [],
    validFrom: d('2026-11-01'), validTo: d('2026-11-30'), isActive: true, ...over,
  });
  const body = (itemId: string, qty: string) => ({ itemId, qty, productId: 'BODY', categoryId: 'BEBES', collectionId: 'VERANO' });
  const hat = { itemId: 'h1', qty: '4', productId: 'GORRO', categoryId: 'ACCESORIOS', collectionId: 'INVIERNO' };
  const run = (promotions: PromotionRule[], over: Partial<Parameters<typeof applyPromotions>[0]> = {}) =>
    applyPromotions({ lines: [body('b1', '6'), body('b2', '6'), hat], promotions, customerId: 'C1', priceListId: 'L1', customerDiscountPct: '5', date: d('2026-11-15'), ...over })
      .map((l) => [l.itemId, l.discountPct.toString(), l.promotionName]);

  it('sin promociones rige el descuento del cliente', () => {
    expect(run([])).toEqual([['b1', '5', null], ['b2', '5', null], ['h1', '5', null]]);
  });

  it('por volumen: cuenta todas las variantes del alcance', () => {
    const vol = promo({ name: '12 bodies', discountPct: '12', minQty: '12', scope: 'PRODUCTS', targetIds: ['BODY'] });
    expect(run([vol])).toEqual([['b1', '12', '12 bodies'], ['b2', '12', '12 bodies'], ['h1', '5', null]]);
    // Con 11 unidades no llega al mínimo.
    expect(run([vol], { lines: [body('b1', '6'), body('b2', '5')] })).toEqual([['b1', '5', null], ['b2', '5', null]]);
  });

  it('gana la mejor y nunca se acumula con la del cliente', () => {
    const coll = promo({ id: 'c', name: 'Verano', discountPct: '8', scope: 'COLLECTIONS', targetIds: ['VERANO'] });
    const cat = promo({ id: 'k', name: 'Accesorios', discountPct: '15', scope: 'CATEGORIES', targetIds: ['ACCESORIOS'] });
    const low = promo({ id: 'l', name: 'Todo 3 %', discountPct: '3' });
    expect(run([coll, cat, low])).toEqual([['b1', '8', 'Verano'], ['b2', '8', 'Verano'], ['h1', '15', 'Accesorios']]);
    // Un cliente con 20 % general no recibe la promoción menor.
    expect(run([coll, cat], { customerDiscountPct: '20' })).toEqual([['b1', '20', null], ['b2', '20', null], ['h1', '20', null]]);
  });

  it('respeta vigencia, estado, clientes y listas de precios', () => {
    const p = promo({ discountPct: '10' });
    expect(run([p], { date: d('2026-10-31') })[0]![2]).toBeNull();
    expect(run([p], { date: d('2026-11-30') })[0]![2]).toBe('Promo'); // el último día cuenta
    expect(run([p], { date: d('2026-12-01') })[0]![2]).toBeNull();
    expect(run([promo({ validTo: null })], { date: d('2027-06-01') })[0]![2]).toBe('Promo');
    expect(run([promo({ isActive: false })])[0]![2]).toBeNull();
    expect(run([promo({ customerIds: ['C2'] })])[0]![2]).toBeNull();
    expect(run([promo({ customerIds: ['C1'] })])[0]![2]).toBe('Promo');
    expect(run([promo({ priceListIds: ['L2'] })])[0]![2]).toBeNull();
  });
});
