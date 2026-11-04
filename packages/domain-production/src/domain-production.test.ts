import { describe, expect, it } from 'vitest';
import { DomainError, computeInvoiceTotals, priceDeviationPct } from '@erp/domain-core';
import { actualUnitCost, assertTransition, estimateUnitCost, explodeBom, shortages, type BomLine } from './index';

// Body manga larga: tela según color, 0,45 m (RN) a 0,62 m (9-12), 8 % de merma; 3 broches; 1 etiqueta.
const bom: BomLine[] = [
  {
    materialItemId: null,
    byGarmentColor: true,
    colorMap: { rosa: 'tela-rosa', blanco: 'tela-blanca' },
    qtyPerUnit: '0.5',
    sizeQty: { rn: '0.45', '9-12': '0.62' },
    wastePct: '8',
  },
  { materialItemId: 'broche', byGarmentColor: false, colorMap: {}, qtyPerUnit: '3', sizeQty: {}, wastePct: '0' },
  { materialItemId: 'etiqueta', byGarmentColor: false, colorMap: {}, qtyPerUnit: '1', sizeQty: {}, wastePct: '2' },
];

describe('explosión de la ficha técnica', () => {
  it('calcula tela por color y talle con merma, y avíos totales', () => {
    const req = explodeBom(bom, [
      { variantItemId: 'v1', sizeId: 'rn', colorId: 'rosa', qty: '100' },
      { variantItemId: 'v2', sizeId: '3-6', colorId: 'rosa', qty: '100' },
      { variantItemId: 'v3', sizeId: '9-12', colorId: 'blanco', qty: '50' },
    ]);
    // rosa: 100 × 0,45 × 1,08 + 100 × 0,5 × 1,08 = 48,6 + 54 = 102,6
    expect(req.get('tela-rosa')!.toString()).toBe('102.6');
    // blanco: 50 × 0,62 × 1,08 = 33,48
    expect(req.get('tela-blanca')!.toString()).toBe('33.48');
    expect(req.get('broche')!.toString()).toBe('750');
    expect(req.get('etiqueta')!.toString()).toBe('255');
  });

  it('falla si falta el material para un color de la prenda', () => {
    expect(() => explodeBom(bom, [{ variantItemId: 'x', sizeId: 'rn', colorId: 'celeste', qty: '1' }], { celeste: 'Celeste' })).toThrow(
      /color Celeste/,
    );
  });

  it('detecta faltantes contra el disponible', () => {
    const req = explodeBom(bom, [{ variantItemId: 'v', sizeId: '3-6', colorId: 'rosa', qty: '500' }]);
    const s = shortages(req, { 'tela-rosa': '200', broche: '5000', etiqueta: '100' });
    expect(s.find((x) => x.materialItemId === 'tela-rosa')!.shortage.toString()).toBe('70');
    expect(s.find((x) => x.materialItemId === 'broche')!.shortage.toString()).toBe('0');
    expect(s.find((x) => x.materialItemId === 'etiqueta')!.shortage.toString()).toBe('410');
  });

  it('costo estimado = materiales + tarifa del taller por prenda', () => {
    const c = estimateUnitCost(bom, { sizeId: '3-6', colorId: 'rosa' }, { 'tela-rosa': '5000', broche: '20', etiqueta: '40' }, '1800');
    // 0,54 × 5000 + 3 × 20 + 1,02 × 40 = 2700 + 60 + 40,8 = 2800,8
    expect(c.materials.toString()).toBe('2800.8');
    expect(c.total.toString()).toBe('4600.8');
  });

  it('costo real reparte el total sobre las unidades aprobadas', () => {
    const r = actualUnitCost({ materials: '270000', workshop: '171000', overhead: '0', goodUnits: '95' });
    expect(r.total.toFixed(2)).toBe('441000.00');
    expect(r.unitCost.toString()).toBe('4642.105263');
  });

  it('valida transiciones de estado de la orden', () => {
    expect(() => assertTransition('DRAFT', 'RELEASED')).not.toThrow();
    expect(() => assertTransition('CLOSED', 'IN_PROGRESS')).toThrow(DomainError);
    expect(() => assertTransition('CANCELLED', 'RELEASED')).toThrow(/no puede pasar/);
  });
});

describe('comprobantes', () => {
  it('totales con redondeo por línea y percepciones', () => {
    const t = computeInvoiceTotals(
      [
        { qty: '320', unitPrice: '4850', vatRate: '21' },
        { qty: '3', unitPrice: '33.33', vatRate: '10.5' },
      ],
      '1552',
    );
    expect(t.netTotal.toFixed(2)).toBe('1552099.99');
    expect(t.vatTotal.toFixed(2)).toBe('325930.50');
    expect(t.total.toFixed(2)).toBe('1879582.49');
  });

  it('rechaza alícuotas inexistentes', () => {
    expect(() => computeInvoiceTotals([{ qty: '1', unitPrice: '1', vatRate: '19' }])).toThrow(/Alícuota/);
  });

  it('desvío de precio porcentual', () => {
    expect(priceDeviationPct('5335', '4850').toString()).toBe('10');
  });
});
