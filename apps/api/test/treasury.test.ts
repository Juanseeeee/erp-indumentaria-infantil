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

describe('tesorería', () => {
  it('registra movimientos inmutables y calcula saldos por fecha de operación y valor', async () => {
    const account = (await admin.post('/treasury/accounts', {
      name: 'Banco de prueba',
      type: 'BANK',
      bank: 'Banco Demo',
      currency: 'ARS',
    }).expect(201)).body;

    await admin.post(`/treasury/accounts/${account.id}/movements`, {
      direction: 'IN',
      amount: '50000',
      operationDate: '2026-01-05',
      valueDate: '2026-01-05',
      concept: 'Saldo inicial importado',
    }).expect(201);
    await admin.post(`/treasury/accounts/${account.id}/movements`, {
      direction: 'OUT',
      amount: '12000',
      operationDate: '2026-01-06',
      valueDate: '2099-01-06',
      concept: 'Cheque diferido',
    }).expect(201);

    const accounts = (await admin.get('/treasury/accounts').expect(200)).body;
    const row = accounts.find((a: { id: string }) => a.id === account.id);
    expect(row.operationBalance).toBe('38000.00');
    expect(row.valueBalance).toBe('50000.00');

    const movements = (await admin.get(`/treasury/accounts/${account.id}/movements`).expect(200)).body;
    expect(movements.total).toBe(2);
    expect(movements.rows[0].concept).toBe('Cheque diferido');
    await expect(owner.treasuryMovement.updateMany({ where: { companyId: t.companyId }, data: { concept: 'editado' } })).rejects.toThrow();
    expect(await owner.treasuryMovement.count({ where: { companyId: t.companyId } })).toBe(2);
  });

  it('aplica permisos de tesorería y valida fechas y montos', async () => {
    const sales = await login(app, t.users.SALES);
    await sales.get('/treasury/accounts').expect(403);
    await sales.post('/treasury/accounts', { name: 'No autorizada', type: 'CASH_BOX' }).expect(403);

    const treasury = await login(app, t.users.TREASURY);
    const account = (await treasury.post('/treasury/accounts', {
      name: 'Caja mostrador',
      type: 'CASH_BOX',
    }).expect(201)).body;
    await treasury.post(`/treasury/accounts/${account.id}/movements`, {
      direction: 'IN',
      amount: '0',
      concept: 'Importe inválido',
    }).expect(400);
    await treasury.post(`/treasury/accounts/${account.id}/movements`, {
      direction: 'OUT',
      amount: '15',
      operationDate: '2026-02-31',
      concept: 'Fecha inválida',
    }).expect(400);
  });
});
