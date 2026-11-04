import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
});

afterAll(async () => {
  await app.close();
});

const newAccount = async (name: string, type: string) => (await admin.post('/treasury/accounts', { name, type }).expect(201)).body.id as string;
const balance = async (id: string) => {
  const accounts = (await admin.get('/treasury/accounts').expect(200)).body as { id: string; operationBalance: string; valueBalance: string }[];
  const a = accounts.find((x) => x.id === id)!;
  return { op: a.operationBalance, value: a.valueBalance };
};
const deposit = (id: string, amount: string, operationDate: string) =>
  admin.post(`/treasury/accounts/${id}/movements`, { direction: 'IN', amount, operationDate, concept: 'Saldo inicial' }).expect(201);

describe('transferencias entre cuentas', () => {
  it('extracción del banco a la caja y acreditación de tarjetas con comisión y fecha de valor', async () => {
    const bank = await newAccount('Banco transferencias', 'BANK');
    const cash = await newAccount('Caja transferencias', 'CASH_BOX');
    const cards = await newAccount('Tarjetas transferencias', 'CARD_CLEARING');
    await deposit(bank, '50000', '2026-09-01');
    await deposit(cards, '10000', '2026-09-01');

    const tr = (await admin.post('/treasury/transfers', { fromAccountId: bank, toAccountId: cash, amount: '8000', date: '2026-09-02' }).expect(201)).body;
    expect(tr).toMatchObject({ number: expect.stringMatching(/^TR-\d{8}$/), from: 'Banco transferencias', to: 'Caja transferencias', received: '8000' });
    await admin
      .post('/treasury/transfers', { fromAccountId: cards, toAccountId: bank, amount: '10000', fee: '350.50', date: '2026-09-02', valueDate: '2099-01-01', concept: 'Liquidación Visa' })
      .expect(201);

    expect(await balance(cash)).toEqual({ op: '8000.00', value: '8000.00' });
    expect(await balance(cards)).toEqual({ op: '0.00', value: '0.00' });
    // Lo acreditado por la tarjeta todavía no está disponible a fecha de valor.
    expect(await balance(bank)).toEqual({ op: '51649.50', value: '42000.00' });
    const movements = (await admin.get(`/treasury/accounts/${cards}/movements`).expect(200)).body.rows as { concept: string; amount: string }[];
    expect(movements.map((m) => m.amount).sort()).toEqual(['10000', '350.5', '9649.5']);

    const list = (await admin.get('/treasury/transfers?from=2026-09-01&to=2026-09-30').expect(200)).body;
    expect(list.total).toBe(2);
  });

  it('rechaza transferencias inválidas y no saca de la caja más de lo que hay', async () => {
    const cash = await newAccount('Caja sin fondos', 'CASH_BOX');
    await deposit(cash, '100', '2026-09-01');
    await admin.post('/treasury/transfers', { fromAccountId: cash, toAccountId: t.bankId, amount: '100.01' }).expect(422);
    await admin.post('/treasury/transfers', { fromAccountId: cash, toAccountId: cash, amount: '10' }).expect(422);
    await admin.post('/treasury/transfers', { fromAccountId: cash, toAccountId: t.bankId, amount: '10', fee: '10' }).expect(422);
    expect(await balance(cash)).toEqual({ op: '100.00', value: '100.00' });
    // Movimientos manuales también: la caja no queda negativa.
    await admin.post(`/treasury/accounts/${cash}/movements`, { direction: 'OUT', amount: '150', concept: 'Retiro' }).expect(422);

    const sales = await login(app, t.users.SALES);
    await sales.post('/treasury/transfers', { fromAccountId: t.bankId, toAccountId: cash, amount: '1' }).expect(403);
  });

  it('anular devuelve el dinero; no se anula si el destino ya lo gastó', async () => {
    const bank = await newAccount('Banco anulación', 'BANK');
    const cash = await newAccount('Caja anulación', 'CASH_BOX');
    await deposit(bank, '1000', '2026-09-01');
    const a = (await admin.post('/treasury/transfers', { fromAccountId: bank, toAccountId: cash, amount: '600' }).expect(201)).body;
    const voided = (await admin.post(`/treasury/transfers/${a.id}/void`, { reason: 'Cuenta equivocada' }).expect(201)).body;
    expect(voided.status).toBe('VOIDED');
    expect(await balance(bank)).toMatchObject({ op: '1000.00' });
    expect(await balance(cash)).toMatchObject({ op: '0.00' });
    await admin.post(`/treasury/transfers/${a.id}/void`, { reason: 'Otra vez' }).expect(422);

    const b = (await admin.post('/treasury/transfers', { fromAccountId: bank, toAccountId: cash, amount: '600' }).expect(201)).body;
    await admin.post(`/treasury/accounts/${cash}/movements`, { direction: 'OUT', amount: '500', concept: 'Pago en efectivo' }).expect(201);
    await admin.post(`/treasury/transfers/${b.id}/void`, { reason: 'Error' }).expect(422);
  });
});

describe('arqueo de caja', () => {
  it('registra la diferencia, deja la caja cerrada hacia atrás y es inmutable', async () => {
    const cash = await newAccount('Caja arqueo', 'CASH_BOX');
    await deposit(cash, '15000.50', '2026-09-10');
    await admin.post(`/treasury/accounts/${cash}/movements`, { direction: 'OUT', amount: '500.50', operationDate: '2026-09-12', concept: 'Flete' }).expect(201);

    const preview = (await admin.get(`/treasury/accounts/${cash}/closing-preview?date=2026-09-15`).expect(200)).body;
    expect(preview).toMatchObject({ expected: '14500.00', lastClosing: null, incomeSinceLast: '15000.50', outcomeSinceLast: '500.50', movementsSinceLast: 2 });

    const closing = (await admin.post('/treasury/cash-closings', { cashAccountId: cash, date: '2026-09-15', counted: '14400', notes: 'Conteo de cierre' }).expect(201)).body;
    expect(closing).toMatchObject({ expected: '14500', counted: '14400', difference: '-100' });
    expect(closing.adjustmentMovementId).toBeTruthy();
    expect(await balance(cash)).toMatchObject({ op: '14400.00' });

    // Cerrada hacia atrás: ni movimientos ni arqueos con fecha anterior.
    await admin.post(`/treasury/accounts/${cash}/movements`, { direction: 'IN', amount: '10', operationDate: '2026-09-14', concept: 'Tarde' }).expect(422);
    await admin.post('/treasury/cash-closings', { cashAccountId: cash, date: '2026-09-14', counted: '1' }).expect(422);
    await admin.post(`/treasury/accounts/${cash}/movements`, { direction: 'IN', amount: '600', operationDate: '2026-09-15', concept: 'Venta del día' }).expect(201);

    // Segundo arqueo del mismo día: cuadra, sin ajuste; lo movido desde el anterior excluye su ajuste.
    const p2 = (await admin.get(`/treasury/accounts/${cash}/closing-preview?date=2026-09-15`).expect(200)).body;
    expect(p2).toMatchObject({ expected: '15000.00', incomeSinceLast: '600.00', outcomeSinceLast: '0.00', lastClosing: { counted: '14400' } });
    const c2 = (await admin.post('/treasury/cash-closings', { cashAccountId: cash, date: '2026-09-15', counted: '15000' }).expect(201)).body;
    expect(c2).toMatchObject({ difference: '0', adjustmentMovementId: null });

    const list = (await admin.get(`/treasury/cash-closings?cashAccountId=${cash}`).expect(200)).body;
    expect(list.total).toBe(2);
    expect(list.rows[0].closedBy).toBeTruthy();
    await expect(owner.cashClosing.updateMany({ where: { companyId: t.companyId }, data: { counted: '1' } })).rejects.toThrow();
  });

  it('solo sobre cajas, sin fechas futuras ni conteos negativos; auditor consulta pero no arquea', async () => {
    await admin.post('/treasury/cash-closings', { cashAccountId: t.bankId, counted: '0' }).expect(422);
    await admin.post('/treasury/cash-closings', { cashAccountId: t.cashBoxId, date: '2099-01-01', counted: '0' }).expect(422);
    await admin.post('/treasury/cash-closings', { cashAccountId: t.cashBoxId, counted: '-1' }).expect(400);
    const auditor = await login(app, t.users.AUDITOR);
    await auditor.get('/treasury/cash-closings').expect(200);
    await auditor.post('/treasury/cash-closings', { cashAccountId: t.cashBoxId, counted: '0' }).expect(403);
  });
});

describe('gastos con centro de costo', () => {
  let centers: Record<string, string>;
  let categories: Record<string, string>;
  let cash: string;

  beforeAll(async () => {
    centers = {
      ADM: (await admin.post('/settings/cost-centers', { code: 'adm', name: 'Administración' }).expect(201)).body.id,
      PRO: (await admin.post('/settings/cost-centers', { code: 'PRO', name: 'Producción' }).expect(201)).body.id,
    };
    categories = {
      flete: (await admin.post('/settings/categories', { name: 'Fletes', kind: 'EXPENSE' }).expect(201)).body.id,
      luz: (await admin.post('/settings/categories', { name: 'Energía', kind: 'EXPENSE' }).expect(201)).body.id,
      producto: (await admin.post('/settings/categories', { name: 'Bodies gasto', kind: 'PRODUCT' }).expect(201)).body.id,
    };
    cash = await newAccount('Caja gastos', 'CASH_BOX');
    await deposit(cash, '20000', '2026-10-01');
  });

  it('el gasto sale de la cuenta y se resume por centro de costo y categoría', async () => {
    const md = (await admin.get('/settings/master-data').expect(200)).body;
    expect(md.costCenters.map((c: { code: string }) => c.code)).toEqual(['ADM', 'PRO']);
    await admin.post('/settings/cost-centers', { code: 'ADM', name: 'Duplicado' }).expect(409);

    const e1 = (
      await admin
        .post('/treasury/expenses', { date: '2026-10-02', categoryId: categories.flete, costCenterId: centers.PRO, cashAccountId: cash, description: 'Flete a taller', documentReference: 'Ticket 0001-00012345', amount: '3500' })
        .expect(201)
    ).body;
    expect(e1).toMatchObject({ number: expect.stringMatching(/^GA-\d{8}$/), category: 'Fletes', costCenter: 'PRO · Producción', account: 'Caja gastos', amount: '3500' });
    const mov = (await admin.get(`/treasury/accounts/${cash}/movements`).expect(200)).body.rows[0];
    expect(mov).toMatchObject({ direction: 'OUT', paymentMethod: 'CASH', sourceDocType: 'EXPENSE', sourceDocId: e1.id });
  });

  it('valida categoría, cuenta y fondos; anular devuelve el dinero y sale de los totales', async () => {
    const base = { date: '2026-10-05', costCenterId: centers.ADM, cashAccountId: cash, description: 'Librería', amount: '1000' };
    await admin.post('/treasury/expenses', { ...base, categoryId: categories.producto }).expect(422);
    const portfolio = await newAccount('Cartera gastos', 'CHEQUE_PORTFOLIO');
    await admin.post('/treasury/expenses', { ...base, categoryId: categories.flete, cashAccountId: portfolio }).expect(422);
    await admin.post('/treasury/expenses', { ...base, categoryId: categories.flete, amount: '999999' }).expect(422);

    const e = (await admin.post('/treasury/expenses', { ...base, categoryId: categories.luz }).expect(201)).body;
    let list = (await admin.get('/treasury/expenses?from=2026-10-01&to=2026-10-31').expect(200)).body;
    expect(list.totalAmount).toBe('4500.00');
    expect(list.byCostCenter).toEqual([
      { id: centers.PRO, code: 'PRO', name: 'Producción', total: '3500.00' },
      { id: centers.ADM, code: 'ADM', name: 'Administración', total: '1000.00' },
    ]);
    expect(list.byCategory.map((c: { name: string }) => c.name)).toEqual(['Fletes', 'Energía']);
    expect(await balance(cash)).toMatchObject({ op: '15500.00' });

    await admin.post(`/treasury/expenses/${e.id}/void`, { reason: 'Cargado dos veces' }).expect(201);
    await admin.post(`/treasury/expenses/${e.id}/void`, { reason: 'Otra vez' }).expect(422);
    list = (await admin.get(`/treasury/expenses?costCenterId=${centers.ADM}`).expect(200)).body;
    expect(list.total).toBe(1);
    expect(list.rows[0].status).toBe('VOIDED');
    expect(list.totalAmount).toBe('0.00');
    expect(await balance(cash)).toMatchObject({ op: '16500.00' });
  });

  it('dos gastos simultáneos no dejan la caja negativa; permisos', async () => {
    const box = await newAccount('Caja concurrencia', 'CASH_BOX');
    await deposit(box, '1000', '2026-10-01');
    const body = { date: '2026-10-06', categoryId: categories.flete, costCenterId: centers.ADM, cashAccountId: box, description: 'Moto', amount: '700' };
    const results = await Promise.all([admin.post('/treasury/expenses', body), admin.post('/treasury/expenses', body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await balance(box)).toMatchObject({ op: '300.00' });

    const sales = await login(app, t.users.SALES);
    await sales.get('/treasury/expenses').expect(403);
    const auditor = await login(app, t.users.AUDITOR);
    await auditor.get('/treasury/expenses').expect(200);
    await auditor.post('/treasury/expenses', body).expect(403);
    await auditor.post('/settings/cost-centers', { code: 'X', name: 'X' }).expect(403);
  });
});
