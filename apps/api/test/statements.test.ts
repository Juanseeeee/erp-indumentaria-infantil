import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let bank: string;
let statementId: string;

interface Line {
  id: string;
  description: string;
  amount: string;
  status: string;
  movement: { id: string } | null;
  suggestions: { id: string; amount: string }[];
}

const CSV = [
  'Fecha;Concepto;Débito;Crédito;Comprobante',
  '28/10/2026;Transferencia recibida;;157.711,40;TRF991',
  '29/10/2026;Comisión mantenimiento;4.500,00;;',
  '29/10/2026;Impuesto Ley 25.413;945,30;;',
  '29/10/2026;Impuesto Ley 25.413;945,30;;',
  '30/10/2026;Pago proveedor;12.000,00;;',
  'xx;Línea ilegible;1;;',
].join('\n');

const move = (direction: 'IN' | 'OUT', amount: string, date: string, concept: string) =>
  admin.post(`/treasury/accounts/${bank}/movements`, { direction, amount, operationDate: date, valueDate: date, concept }).expect(201);
const detail = async () => (await admin.get(`/treasury/statements/${statementId}`).expect(200)).body;
const line = (d: { lines: Line[] }, description: string, n = 0) => d.lines.filter((l) => l.description === description)[n]!;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  bank = (await admin.post('/treasury/accounts', { name: 'Banco conciliación', type: 'BANK' }).expect(201)).body.id;
  await move('IN', '200000', '2026-10-01', 'Saldo inicial');
  await move('IN', '157711.40', '2026-10-27', 'Cobro Bebés del Sur · Transferencia TRF991');
  await move('OUT', '12000', '2026-10-29', 'Pago Textil Norte');
  await move('OUT', '12000', '2026-10-30', 'Pago Avíos SA');
  await move('OUT', '25000', '2026-10-29', 'Cheque propio 000123');
});

afterAll(async () => {
  await app.close();
});

describe('extractos bancarios', () => {
  it('importa el CSV, informa líneas ilegibles y no vuelve a cargar lo ya importado', async () => {
    const r = (await admin.post(`/treasury/accounts/${bank}/statements`, { fileName: 'octubre.csv', content: CSV }).expect(201)).body;
    statementId = r.id;
    expect(r).toMatchObject({ lineCount: 5, skippedCount: 0, summary: { lines: 5, pending: 5, bankTotal: '139320.80' } });
    expect(r.periodFrom.slice(0, 10)).toBe('2026-10-28');
    expect(r.errors).toEqual([{ line: 7, message: expect.stringMatching(/Fecha ilegible/) }]);

    await admin.post(`/treasury/accounts/${bank}/statements`, { fileName: 'octubre-otra-vez.csv', content: CSV }).expect(409);
    const extended = `${CSV}\n31/10/2026;Intereses;;12,50;`;
    const r2 = (await admin.post(`/treasury/accounts/${bank}/statements`, { fileName: 'octubre-completo.csv', content: extended }).expect(201)).body;
    expect(r2).toMatchObject({ lineCount: 1, skippedCount: 5 });

    await admin.post(`/treasury/accounts/${t.cashBoxId}/statements`, { fileName: 'x.csv', content: CSV }).expect(422);
    await admin.post(`/treasury/accounts/${bank}/statements`, { fileName: 'x.csv', content: 'sin;columnas\n1;2' }).expect(422);
    const list = (await admin.get(`/treasury/statements?cashAccountId=${bank}`).expect(200)).body;
    expect(list.map((s: { fileName: string; pending: number }) => [s.fileName, s.pending])).toEqual([['octubre-completo.csv', 1], ['octubre.csv', 5]]);
  });

  it('sugiere por importe y fecha y concilia solo lo inequívoco', async () => {
    let d = await detail();
    expect(line(d, 'Transferencia recibida').suggestions.map((s) => s.amount)).toEqual(['157711.40']);
    expect(line(d, 'Pago proveedor').suggestions).toHaveLength(2); // dos pagos de 12.000: lo decide una persona
    // El cobro del 27 queda fuera del período del extracto (28 al 30), pero se sugiere igual por la tolerancia de días.
    expect(d.systemOnly.map((m: { amount: string }) => m.amount).sort()).toEqual(['-12000.00', '-12000.00', '-25000.00']);

    const auto = (await admin.post(`/treasury/statements/${statementId}/auto-match`).expect(201)).body;
    expect(auto.matched).toBe(1);
    d = auto.statement;
    expect(line(d, 'Transferencia recibida').status).toBe('MATCHED');
    expect(d.summary.pending).toBe(4);
  });

  it('concilia a mano, registra lo que solo está en el banco e ignora con motivo', async () => {
    let d = await detail();
    const pago = line(d, 'Pago proveedor');
    const transfer = line(d, 'Transferencia recibida').movement!.id;
    await admin.post(`/treasury/statement-lines/${pago.id}/match`, { movementId: transfer }).expect(409); // ya conciliado
    await admin.post(`/treasury/statement-lines/${line(d, 'Comisión mantenimiento').id}/match`, { movementId: pago.suggestions[0]!.id }).expect(422); // otro importe
    d = (await admin.post(`/treasury/statement-lines/${pago.id}/match`, { movementId: pago.suggestions[1]!.id }).expect(201)).body;
    expect(line(d, 'Pago proveedor').status).toBe('MATCHED');
    await admin.post(`/treasury/statement-lines/${pago.id}/ignore`, { reason: 'Ya resuelta' }).expect(422);

    // La comisión, como gasto con categoría y centro de costo; el impuesto, como egreso simple.
    const center = (await admin.post('/settings/cost-centers', { code: 'ADM', name: 'Administración' }).expect(201)).body.id;
    const category = (await admin.post('/settings/categories', { name: 'Gastos bancarios', kind: 'EXPENSE' }).expect(201)).body.id;
    const comision = line(d, 'Comisión mantenimiento');
    await admin.post(`/treasury/statement-lines/${comision.id}/create`, { concept: 'Comisión', categoryId: category }).expect(400); // falta el centro
    d = (await admin.post(`/treasury/statement-lines/${comision.id}/create`, { concept: 'Comisión mantenimiento de cuenta', categoryId: category, costCenterId: center }).expect(201)).body;
    expect(line(d, 'Comisión mantenimiento').status).toBe('CREATED');
    const expenses = (await admin.get(`/treasury/expenses?costCenterId=${center}`).expect(200)).body;
    expect(expenses.rows[0]).toMatchObject({ amount: '4500', date: expect.stringMatching(/^2026-10-29/), account: 'Banco conciliación' });

    const [imp1, imp2] = [line(d, 'Impuesto Ley 25.413', 0), line(d, 'Impuesto Ley 25.413', 1)];
    d = (await admin.post(`/treasury/statement-lines/${imp1.id}/create`, { concept: 'Impuesto a los débitos y créditos' }).expect(201)).body;
    d = (await admin.post(`/treasury/statement-lines/${imp2.id}/ignore`, { reason: 'Lo revisa el contador' }).expect(201)).body;
    expect(d.summary.pending).toBe(0);
    expect(d.systemOnly.map((m: { amount: string }) => m.amount).sort()).toEqual(['-12000.00', '-25000.00']);

    // Deshacer: lo ignorado y lo conciliado vuelven a pendiente; lo registrado desde el extracto no.
    d = (await admin.post(`/treasury/statement-lines/${imp2.id}/undo`).expect(201)).body;
    expect(line(d, 'Impuesto Ley 25.413', 1).status).toBe('PENDING');
    await admin.post(`/treasury/statement-lines/${imp1.id}/undo`).expect(422);
    d = (await admin.post(`/treasury/statement-lines/${pago.id}/undo`).expect(201)).body;
    expect(line(d, 'Pago proveedor')).toMatchObject({ status: 'PENDING', movement: null });

    const movements = (await admin.get(`/treasury/accounts/${bank}/movements`).expect(200)).body.rows as { concept: string; reconciled: boolean }[];
    expect(movements.find((m) => m.concept.includes('TRF991'))!.reconciled).toBe(true);
    expect(movements.find((m) => m.concept === 'Pago Avíos SA')!.reconciled).toBe(false);
  });

  it('permisos: el auditor consulta pero no importa ni concilia', async () => {
    const auditor = await login(app, t.users.AUDITOR);
    await auditor.get(`/treasury/statements/${statementId}`).expect(200);
    await auditor.post(`/treasury/accounts/${bank}/statements`, { fileName: 'x.csv', content: CSV }).expect(403);
    await auditor.post(`/treasury/statements/${statementId}/auto-match`).expect(403);
    const sales = await login(app, t.users.SALES);
    await sales.get('/treasury/statements').expect(403);
  });
});
