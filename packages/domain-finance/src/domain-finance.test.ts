import { describe, expect, it } from 'vitest';
import { DomainError, dec } from '@erp/domain-core';
import {
  accountTypesFor,
  allowedChequeEvents,
  assertAccountForMethod,
  assertCanDeposit,
  assertCashAvailable,
  assertCashBoxOpen,
  assertChequeData,
  assertTransfer,
  assertPeriodMove,
  assertPeriodOpen,
  cashClosing,
  chequeTransition,
  matchCandidates,
  parseAmountAR,
  parseDateAR,
  parseStatementCsv,
  pendingRecurring,
  pickAutoMatches,
  projectCashflow,
  signedAmount,
  statementKey,
  suggestCheques,
} from './index';

describe('cheques', () => {
  it('ciclo de un cheque de tercero', () => {
    expect(chequeTransition('THIRD', 'IN_PORTFOLIO', 'DEPOSIT')).toBe('DEPOSITED');
    expect(chequeTransition('THIRD', 'DEPOSITED', 'CREDIT')).toBe('CREDITED');
    expect(chequeTransition('THIRD', 'IN_PORTFOLIO', 'ENDORSE')).toBe('DELIVERED');
    expect(chequeTransition('THIRD', 'DELIVERED', 'REJECT')).toBe('REJECTED');
  });
  it('no admite operaciones incompatibles', () => {
    expect(() => chequeTransition('THIRD', 'DELIVERED', 'DEPOSIT')).toThrow(DomainError);
    expect(() => chequeTransition('THIRD', 'CREDITED', 'REJECT')).toThrow(DomainError);
    expect(() => chequeTransition('OWN', 'DEBITED', 'VOID')).toThrow(DomainError);
    expect(allowedChequeEvents('THIRD', 'CREDITED')).toEqual([]);
  });
  it('propio: emitido → debitado o anulado', () => {
    expect(chequeTransition('OWN', 'ISSUED', 'DEBIT')).toBe('DEBITED');
    expect(chequeTransition('OWN', 'ISSUED', 'VOID')).toBe('VOIDED');
  });
  it('plazo máximo de 360 días', () => {
    expect(() => assertChequeData({ issueDate: new Date('2026-01-01'), paymentDate: new Date('2027-01-15'), amount: '10' })).toThrow(/360/);
  });
  it('sugiere cheques por vencimiento sin pasarse del importe', () => {
    const r = suggestCheques(
      [
        { id: 'c', amount: '50000', paymentDate: '2026-12-01' },
        { id: 'a', amount: '30000', paymentDate: '2026-11-01' },
        { id: 'b', amount: '80000', paymentDate: '2026-11-15' },
      ],
      '100000',
    );
    expect(r.map((x) => x.id)).toEqual(['a', 'c']);
  });
});

describe('arqueo', () => {
  it('calcula la diferencia', () => {
    expect(cashClosing('15000.50', '14900').difference.toString()).toBe('-100.5');
  });
  it('una caja arqueada no admite fechas anteriores y no queda negativa', () => {
    const closed = new Date('2026-10-28T00:00:00.000Z');
    expect(() => assertCashBoxOpen(new Date('2026-10-27T00:00:00.000Z'), closed, 'Caja')).toThrow(/arqueo al 28\/10\/2026/);
    expect(() => assertCashBoxOpen(closed, closed, 'Caja')).not.toThrow();
    expect(() => assertCashBoxOpen(new Date('2020-01-01'), null, 'Caja')).not.toThrow();
    expect(() => assertCashAvailable('100', '100.00', 'Caja')).not.toThrow();
    expect(() => assertCashAvailable('100', '100.01', 'Caja')).toThrow(/tiene \$ 100.00/);
  });
});

describe('transferencias', () => {
  const bank = { id: 'b', type: 'BANK' as const, currency: 'ARS' };
  const cash = { id: 'c', type: 'CASH_BOX' as const, currency: 'ARS' };
  const cards = { id: 't', type: 'CARD_CLEARING' as const, currency: 'ARS' };
  it('descuenta la comisión de lo que llega', () => {
    expect(assertTransfer(cards, bank, '1000', '35.5').received.toString()).toBe('964.5');
    expect(assertTransfer(cash, bank, '500').fee.toString()).toBe('0');
  });
  it('rechaza combinaciones inválidas', () => {
    expect(() => assertTransfer(bank, bank, '10')).toThrow(/misma/);
    expect(() => assertTransfer(bank, { id: 'p', type: 'CHEQUE_PORTFOLIO', currency: 'ARS' }, '10')).toThrow(/cheques/);
    expect(() => assertTransfer(bank, cards, '10')).toThrow(/tarjeta/);
    expect(() => assertTransfer(bank, { ...cash, currency: 'USD' }, '10')).toThrow(/moneda/);
    expect(() => assertTransfer(cash, bank, '10', '10')).toThrow(/comisión/);
  });
});

describe('extractos', () => {
  it('lee importes y fechas en formato argentino', () => {
    expect(parseAmountAR('1.234,56').toString()).toBe('1234.56');
    expect(parseAmountAR('-1.234,5').toString()).toBe('-1234.5');
    expect(parseAmountAR('(500,00)').toString()).toBe('-500');
    expect(parseAmountAR('$ 1,234.56').toString()).toBe('1234.56');
    expect(parseDateAR('29/10/26').toISOString().slice(0, 10)).toBe('2026-10-29');
    expect(() => parseDateAR('31/02/2026')).toThrow();
  });
  it('lee CSV con débito y crédito separados y reporta líneas con error', () => {
    const csv = 'Fecha;Concepto;Débito;Crédito;Comprobante\n28/10/2026;Transferencia recibida;;157.711,40;TRF991\n29/10/2026;Comisión mantenimiento;4.500,00;;\nxx;Basura;1;;\n';
    const r = parseStatementCsv(csv);
    expect(r.rows.map((x) => x.amount.toString())).toEqual(['157711.4', '-4500']);
    expect(r.rows[0]!.reference).toBe('TRF991');
    expect(r.errors).toHaveLength(1);
    expect(statementKey(r.rows[1]!, 0)).toBe('2026-10-29|-4500.00|comisión mantenimiento||0');
  });
  it('sugiere movimientos por importe y fecha cercana', () => {
    const line = { date: new Date('2026-10-29'), amount: dec('1000'), reference: 'X1' };
    const r = matchCandidates(line, [
      { id: 'lejos', amount: '1000', valueDate: '2026-10-10' },
      { id: 'cerca', amount: '1000', valueDate: '2026-10-27' },
      { id: 'ref', amount: '1000', valueDate: '2026-10-25', reference: 'pago X1' },
      { id: 'otro', amount: '999', valueDate: '2026-10-29' },
    ]);
    expect(r.map((x) => x.id)).toEqual(['ref', 'cerca']);
  });
  it('concilia solo lo inequívoco', () => {
    const candidates: Record<string, { id: string }[]> = {
      a: [{ id: 'm1' }], // único y nadie más lo reclama → se concilia
      b: [{ id: 'm2' }], // único, pero c también lo reclama → a mano
      c: [{ id: 'm2' }, { id: 'm3' }],
      d: [], // sin candidatos
    };
    const r = pickAutoMatches(['a', 'b', 'c', 'd'].map((id) => ({ id })), (l) => candidates[l.id]!);
    expect(r).toEqual([{ lineId: 'a', movementId: 'm1' }]);
    expect(signedAmount('OUT', '10.5').toString()).toBe('-10.5');
  });
});

describe('flujo proyectado', () => {
  it('agrupa por semana con saldo acumulado y lo vencido en la primera', () => {
    const b = projectCashflow(
      '1000',
      [
        { date: new Date('2026-10-20'), amount: '500', kind: 'CXC' },
        { date: new Date('2026-11-04'), amount: '-300', kind: 'CHEQUE_PROPIO' },
      ],
      new Date('2026-10-29'),
      3,
    );
    expect(b[0]!.from.toISOString().slice(0, 10)).toBe('2026-10-26');
    expect(b.map((x) => x.balance.toString())).toEqual(['1500', '1200', '1200']);
  });
});

describe('cierre de período', () => {
  it('bloquea fechas cerradas', () => {
    expect(() => assertPeriodOpen(new Date('2026-09-30'), '2026-09-30')).toThrow(/cerrado/);
    expect(() => assertPeriodOpen(new Date('2026-10-01'), '2026-09-30')).not.toThrow();
  });
  it('cerrar solo avanza y no alcanza hoy; reabrir solo retrocede', () => {
    const today = '2026-10-29';
    expect(() => assertPeriodMove('CLOSE', null, '2026-09-30', today)).not.toThrow();
    expect(() => assertPeriodMove('CLOSE', null, today, today)).toThrow(/hasta ayer/);
    expect(() => assertPeriodMove('CLOSE', '2026-09-30', '2026-09-30', today)).toThrow(/reabrilo/);
    expect(() => assertPeriodMove('REOPEN', '2026-09-30', '2026-08-31', today)).not.toThrow();
    expect(() => assertPeriodMove('REOPEN', '2026-09-30', null, today)).not.toThrow();
    expect(() => assertPeriodMove('REOPEN', '2026-09-30', '2026-10-15', today)).toThrow(/anterior/);
    expect(() => assertPeriodMove('REOPEN', null, null, today)).toThrow(/ningún/);
  });
});

describe('medios de cobro', () => {
  it('cada medio entra en el tipo de cuenta que corresponde', () => {
    expect(accountTypesFor('CASH')).toEqual(['CASH_BOX']);
    expect(accountTypesFor('ECHEQ')).toEqual(['CHEQUE_PORTFOLIO']);
    expect(accountTypesFor('RETENTION')).toEqual([]);
    expect(() => assertAccountForMethod('TRANSFER', 'BANK')).not.toThrow();
    expect(() => assertAccountForMethod('CASH', 'BANK')).toThrow(DomainError);
    expect(() => assertAccountForMethod('RETENTION', 'CASH_BOX')).toThrow(/retenciones/);
    expect(() => accountTypesFor('BITCOIN')).toThrow(DomainError);
  });
});

describe('depósito de cheques', () => {
  const pay = new Date('2026-11-10T00:00:00.000Z');
  it('desde la fecha de pago y hasta 30 días después', () => {
    expect(() => assertCanDeposit(pay, new Date('2026-11-09T00:00:00.000Z'))).toThrow(/desde el 10\/11\/2026/);
    expect(() => assertCanDeposit(pay, pay)).not.toThrow();
    expect(() => assertCanDeposit(pay, new Date('2026-12-10T00:00:00.000Z'))).not.toThrow();
    expect(() => assertCanDeposit(pay, new Date('2026-12-11T00:00:00.000Z'))).toThrow(/plazo de presentación/);
  });
});

describe('pagos con cheques', () => {
  it('un endoso se recupera a cartera; los propios salen de un banco', () => {
    expect(chequeTransition('THIRD', 'DELIVERED', 'RECOVER')).toBe('IN_PORTFOLIO');
    expect(() => chequeTransition('THIRD', 'DEPOSITED', 'RECOVER')).toThrow(DomainError);
    expect(accountTypesFor('OWN_ECHEQ')).toEqual(['BANK']);
    expect(() => assertAccountForMethod('OWN_CHEQUE', 'CASH_BOX')).toThrow(DomainError);
  });
});

describe('gastos recurrentes', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  it('lista los meses pendientes desde el inicio hasta el horizonte, sin los ya registrados', () => {
    const rent = { id: 'alquiler', dayOfMonth: 10, startsOn: d('2026-08-15') };
    const r = pendingRecurring([rent], new Set(['alquiler|2026-09']), d('2026-10-29'), d('2026-12-31'));
    // Agosto empieza el 15: el vencimiento del 10 queda antes del inicio.
    expect(r.map((x) => [x.period, x.dueDate.toISOString().slice(0, 10)])).toEqual([
      ['2026-10', '2026-10-10'],
      ['2026-11', '2026-11-10'],
      ['2026-12', '2026-12-10'],
    ]);
  });
  it('no va más de 12 meses atrás', () => {
    const r = pendingRecurring([{ id: 'luz', dayOfMonth: 5, startsOn: d('2020-01-01') }], new Set(), d('2026-10-29'), d('2026-10-31'));
    expect(r[0]!.period).toBe('2025-10');
    expect(r).toHaveLength(13);
  });
});
