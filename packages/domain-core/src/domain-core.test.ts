import { describe, expect, it } from 'vitest';
import {
  allocate,
  buildInternalEan13,
  buildSku,
  convertQty,
  dec,
  DomainError,
  formatMoneyAR,
  roundMoney,
  sum,
} from './index';

describe('decimal', () => {
  it('suma exacta (0,1 + 0,2 = 0,3)', () => {
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3');
  });

  it('redondeo half-up a 2 decimales', () => {
    expect(roundMoney('2.345').toFixed(2)).toBe('2.35');
    expect(roundMoney('-2.345').toFixed(2)).toBe('-2.35');
  });

  it('IVA 10,5 % sobre $33,33', () => {
    expect(roundMoney(dec('33.33').times('0.105')).toFixed(2)).toBe('3.50');
  });

  it('prorratea $100 en 3 partes iguales sin perder centavos', () => {
    const parts = allocate('100', [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
    expect(sum(parts).toFixed(2)).toBe('100.00');
  });

  it('prorratea asignando el residuo a la última parte con peso', () => {
    const parts = allocate('10', [1, 2, 0]);
    expect(sum(parts).toFixed(2)).toBe('10.00');
    expect(parts[2]!.toFixed(2)).toBe('0.00');
  });

  it('formatea moneda argentina', () => {
    expect(formatMoneyAR('1234567.5')).toBe('$ 1.234.567,50');
    expect(formatMoneyAR('-12')).toBe('-$ 12,00');
  });
});

describe('unidades', () => {
  const m = { id: 'm', code: 'm', dimension: 'LENGTH' as const };
  const cm = { id: 'cm', code: 'cm', dimension: 'LENGTH' as const };
  const kg = { id: 'kg', code: 'kg', dimension: 'MASS' as const };
  const rollo = { id: 'rollo', code: 'rollo', dimension: 'UNIT' as const };
  const convs = [
    { fromUomId: 'm', toUomId: 'cm', factor: '100', itemId: null },
    { fromUomId: 'rollo', toUomId: 'm', factor: '50', itemId: 'interlock' },
  ];

  it('convierte con conversión universal y su inversa', () => {
    expect(convertQty('1.5', m, cm, convs).toString()).toBe('150');
    expect(convertQty('250', cm, m, convs).toString()).toBe('2.5');
  });

  it('convierte rollo → metros con factor específico del artículo', () => {
    expect(convertQty('3', rollo, m, convs, 'interlock').toString()).toBe('150');
  });

  it('rechaza conversiones sin factor (kg ↔ m)', () => {
    expect(() => convertQty('1', kg, m, convs)).toThrow(DomainError);
    expect(() => convertQty('1', rollo, m, convs, 'otra-tela')).toThrow(/conversión/);
  });
});

describe('sku y códigos de barras', () => {
  it('normaliza partes del SKU', () => {
    expect(buildSku('{MODEL}-{COLOR}-{SIZE}', { model: 'body ml', color: 'Rosa', size: '3-6' })).toBe(
      'BODY-ML-ROSA-3-6',
    );
    expect(buildSku('{MODEL}-{COLOR}-{SIZE}', { model: 'Enterito', color: 'Algodón crudo', size: 'RN' })).toBe(
      'ENTERITO-ALGODON-CRUDO-RN',
    );
  });

  it('genera EAN-13 interno con dígito verificador', () => {
    expect(buildInternalEan13(1)).toBe('2000000000015');
    expect(buildInternalEan13(1)).toHaveLength(13);
  });
});
