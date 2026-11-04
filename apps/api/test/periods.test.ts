import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let accounting: Client;
let supplier: string;
let box: string;

const move = (client: Client, account: string, operationDate: string, amount = '100', direction: 'IN' | 'OUT' = 'IN') =>
  client.post(`/treasury/accounts/${account}/movements`, { direction, amount, operationDate, concept: `Movimiento ${operationDate}` });

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  accounting = await login(app, t.users.ACCOUNTING);
  supplier = (await admin.post('/parties', { legalName: 'Textil Norte SRL', taxIdType: 'CUIT', taxId: '30711111111', taxCondition: 'RI', roles: ['SUPPLIER'] }).expect(201)).body.id;
  box = (await admin.post('/treasury/accounts', { name: 'Caja septiembre', type: 'CASH_BOX' }).expect(201)).body.id;
  await move(admin, t.bankId, '2026-09-15', '50000').expect(201);
  await move(admin, box, '2026-09-10', '20000').expect(201);
});

afterAll(async () => {
  await app.close();
});

describe('cierre de período', () => {
  it('antes de cerrar avisa lo pendiente; cerrar solo avanza y nunca incluye hoy', async () => {
    const checklist = (await accounting.get('/periods/checklist?until=2026-09-30').expect(200)).body;
    expect(checklist.checks.find((c: { key: string }) => c.key === 'cash')).toMatchObject({ ok: false, detail: 'Sin arqueo: Caja septiembre' });

    const today = (await accounting.get('/periods').expect(200)).body.today;
    await accounting.post('/periods/close', { until: today }).expect(422);
    const closed = (await accounting.post('/periods/close', { until: '2026-09-30', notes: 'Cierre de septiembre' }).expect(201)).body;
    expect(closed.lockedUntil).toBe('2026-09-30');
    await accounting.post('/periods/close', { until: '2026-09-15' }).expect(422); // no retrocede
  });

  it('nada con fecha cerrada entra por ningún camino', async () => {
    const r = await move(admin, t.bankId, '2026-09-20');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'PERIODO_CERRADO', message: expect.stringContaining('cerrado hasta el 30/09/2026') });
    await move(admin, t.bankId, '2026-10-01').expect(201);

    const center = (await admin.post('/settings/cost-centers', { code: 'ADM', name: 'Administración' }).expect(201)).body.id;
    const category = (await admin.post('/settings/categories', { name: 'Librería', kind: 'EXPENSE' }).expect(201)).body.id;
    const expense = { categoryId: category, costCenterId: center, cashAccountId: t.bankId, description: 'Resmas', amount: '5000' };
    await admin.post('/treasury/expenses', { ...expense, date: '2026-09-29' }).expect(409);
    expect(await owner.expense.count({ where: { companyId: t.companyId } })).toBe(0); // la transacción completa se deshace
    await admin.post('/treasury/expenses', { ...expense, date: '2026-10-02' }).expect(201);

    await admin.post('/treasury/payments', { supplierId: supplier, date: '2026-09-10', payments: [{ method: 'TRANSFER', amount: '1000', cashAccountId: t.bankId }] }).expect(409);
    await admin.post('/treasury/cash-closings', { cashAccountId: box, date: '2026-09-30', counted: '20000' }).expect(409);
    await admin.post('/treasury/transfers', { fromAccountId: t.bankId, toAccountId: box, amount: '10', date: '2026-09-30' }).expect(409);

    // Defensa en profundidad: ni siquiera escribiendo directo en la base.
    await expect(
      owner.treasuryMovement.create({
        data: { companyId: t.companyId, cashAccountId: t.bankId, direction: 'IN', amount: '1', currency: 'ARS', operationDate: new Date('2026-09-01'), valueDate: new Date('2026-09-01'), concept: 'Directo', createdBy: randomUUID() },
      }),
    ).rejects.toThrow(/PERIODO_CERRADO/);
    await expect(
      owner.accountEntry.create({
        data: { companyId: t.companyId, partyId: supplier, accountType: 'PAYABLE', entryType: 'INVOICE', sourceDocType: 'TEST', sourceDocId: randomUUID(), description: 'Factura de septiembre', date: new Date('2026-09-05'), amount: '100', openAmount: '100', createdBy: randomUUID() },
      }),
    ).rejects.toThrow(/PERIODO_CERRADO/);
  });

  it('reabrir exige permiso y motivo; todo queda en el historial', async () => {
    await accounting.post('/periods/reopen', { until: '2026-08-31', reason: 'Falta cargar una factura de septiembre' }).expect(403);
    const direction = await login(app, t.users.OWNER);
    await direction.post('/periods/reopen', { until: '2026-08-31', reason: 'Corto' }).expect(400);
    await direction.post('/periods/reopen', { until: '2026-09-30', reason: 'Misma fecha que el cierre actual' }).expect(422);
    const reopened = (await direction.post('/periods/reopen', { until: '2026-08-31', reason: 'Falta cargar una factura de septiembre' }).expect(201)).body;
    expect(reopened.lockedUntil).toBe('2026-08-31');
    await move(admin, t.bankId, '2026-09-20').expect(201);
    await move(admin, t.bankId, '2026-08-20').expect(409);

    const sales = await login(app, t.users.SALES);
    const status = (await sales.get('/periods').expect(200)).body;
    expect(status.lockedUntil).toBe('2026-08-31');
    expect(status.history.map((h: { action: string; previousUntil: string; lockedUntil: string }) => [h.action, h.previousUntil, h.lockedUntil])).toEqual([
      ['REOPEN', '2026-09-30', '2026-08-31'],
      ['CLOSE', null, '2026-09-30'],
    ]);
    expect(status.history[0].by).toBeTruthy();
    await sales.post('/periods/close', { until: '2026-09-30' }).expect(403);
    await expect(owner.periodLock.updateMany({ where: { companyId: t.companyId }, data: { notes: 'editado' } })).rejects.toThrow();

    // Reabrir del todo.
    await direction.post('/periods/reopen', { until: null, reason: 'Se reabre todo por migración de saldos' }).expect(201);
    await move(admin, t.bankId, '2026-01-02').expect(201);
  });
});
