import { describe, expect, it } from 'vitest';
import { DomainError } from '@erp/domain-core';
import { applyMovement, assertCanReserve, assertSignMatchesType } from './index';

const empty = { onHand: '0', reserved: '0', avgCost: '0', allowNegative: false };

describe('applyMovement', () => {
  it('primera entrada fija el costo promedio', () => {
    const r = applyMovement(empty, { type: 'PURCHASE_RECEIPT', qty: '100', unitCost: '1500' });
    expect(r.onHand.toString()).toBe('100');
    expect(r.avgCost.toString()).toBe('1500');
  });

  it('recalcula el promedio ponderado con una segunda entrada', () => {
    const r = applyMovement(
      { onHand: '100', reserved: '0', avgCost: '1500', allowNegative: false },
      { type: 'PURCHASE_RECEIPT', qty: '50', unitCost: '1800' },
    );
    expect(r.onHand.toString()).toBe('150');
    expect(r.avgCost.toString()).toBe('1600');
  });

  it('las salidas se valorizan al promedio y no cambian el costo', () => {
    const r = applyMovement(
      { onHand: '150', reserved: '0', avgCost: '1600', allowNegative: false },
      { type: 'PROD_ISSUE', qty: '-40' },
    );
    expect(r.onHand.toString()).toBe('110');
    expect(r.unitCost.toString()).toBe('1600');
    expect(r.avgCost.toString()).toBe('1600');
  });

  it('no permite stock negativo', () => {
    expect(() =>
      applyMovement({ ...empty, onHand: '5', avgCost: '10' }, { type: 'ADJUSTMENT', qty: '-6' }),
    ).toThrow(DomainError);
  });

  it('no permite consumir stock reservado para otro documento', () => {
    expect(() =>
      applyMovement(
        { onHand: '10', reserved: '8', avgCost: '10', allowNegative: false },
        { type: 'SALE_DELIVERY', qty: '-3' },
      ),
    ).toThrow(/insuficiente/);
  });

  it('permite consumir la propia reserva', () => {
    const r = applyMovement(
      { onHand: '10', reserved: '8', avgCost: '10', allowNegative: false },
      { type: 'SALE_DELIVERY', qty: '-8' },
      { releasedReservation: '8' },
    );
    expect(r.onHand.toString()).toBe('2');
  });

  it('permite negativo solo si está configurado', () => {
    const r = applyMovement({ ...empty, allowNegative: true }, { type: 'ADJUSTMENT', qty: '-2' });
    expect(r.onHand.toString()).toBe('-2');
  });

  it('rechaza cantidad cero', () => {
    expect(() => applyMovement(empty, { type: 'ADJUSTMENT', qty: '0' })).toThrow(/cero/);
  });
});

describe('reservas', () => {
  it('reserva si hay disponible', () => {
    expect(assertCanReserve({ onHand: '10', reserved: '4', avgCost: '0', allowNegative: false }, '6').toString()).toBe(
      '6',
    );
  });
  it('rechaza si no hay disponible', () => {
    expect(() => assertCanReserve({ onHand: '10', reserved: '4', avgCost: '0', allowNegative: false }, '7')).toThrow(
      DomainError,
    );
  });
});

describe('signo según tipo', () => {
  it('valida signos', () => {
    expect(() => assertSignMatchesType('PURCHASE_RECEIPT', '-1')).toThrow();
    expect(() => assertSignMatchesType('SALE_DELIVERY', '1')).toThrow();
    expect(() => assertSignMatchesType('ADJUSTMENT', '-1')).not.toThrow();
  });
});
