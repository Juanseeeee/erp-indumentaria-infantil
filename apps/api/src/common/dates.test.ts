import { describe, expect, it } from 'vitest';
import { businessDate } from './dates';

describe('fecha de negocio (Buenos Aires)', () => {
  it('a las 21:30 de Buenos Aires sigue siendo el mismo día aunque en UTC ya sea mañana', () => {
    const now = new Date('2026-10-29T00:30:00Z'); // 28/10 21:30 ART
    expect(businessDate(0, now).toISOString()).toBe('2026-10-28T00:00:00.000Z');
    expect(businessDate(-1, now).toISOString()).toBe('2026-10-27T00:00:00.000Z');
  });
  it('a las 01:00 de Buenos Aires ya es el día siguiente', () => {
    expect(businessDate(0, new Date('2026-10-29T04:00:00Z')).toISOString()).toBe('2026-10-29T00:00:00.000Z');
  });
});
