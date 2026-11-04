import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let customer: string;

/** Día calendario de negocio en formato AAAA-MM-DD, con desplazamiento. */
function day(offset = 0) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function balances() {
  const rows = (await admin.get('/treasury/accounts').expect(200)).body as { id: string; type: string; operationBalance: string; valueBalance: string }[];
  const byId = (id: string) => rows.find((r) => r.id === id)!;
  const portfolio = rows.find((r) => r.type === 'CHEQUE_PORTFOLIO');
  return { cash: byId(t.cashBoxId).operationBalance, bank: byId(t.bankId).operationBalance, portfolio: portfolio?.operationBalance, portfolioValue: portfolio?.valueBalance };
}

const ledgerBalance = async () => (await admin.get(`/accounts/${customer}?tipo=RECEIVABLE`).expect(200)).body.balance as string;
const chequeOf = async (receiptId: string, number: string) =>
  (await admin.get(`/sales/receipts/${receiptId}`).expect(200)).body.payments.find((p: { reference: string }) => p.reference === number).chequeId as string;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  customer = (
    await admin
      .post('/parties', { legalName: 'Bebés del Sur SA', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'] })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await app.close();
});

describe('cobros en tesorería y cartera de cheques', () => {
  let receiptId: string;

  it('cada medio del recibo entra en su cuenta; los cheques quedan en cartera', async () => {
    const r = (
      await admin
        .post('/sales/receipts', {
          customerId: customer,
          payments: [
            { method: 'CASH', amount: '1000' },
            { method: 'TRANSFER', amount: '2000', reference: 'TRF 1', cashAccountId: t.bankId },
            { method: 'CHEQUE', amount: '5000', bank: 'Banco Galicia', reference: '0001', dueDate: day(0) },
            { method: 'ECHEQ', amount: '3000', bank: 'Banco Macro', reference: 'E-77', dueDate: day(20), drawerName: 'Otra Empresa SRL', drawerTaxId: '30722222229' },
            { method: 'RETENTION', amount: '500', reference: 'IIBB 12' },
          ],
        })
        .expect(201)
    ).body;
    receiptId = r.id;
    expect(r.payments.find((p: { method: string }) => p.method === 'CASH').account).toBe('Caja principal');
    expect(r.payments.find((p: { method: string }) => p.method === 'RETENTION').account).toBeNull();
    expect(r.payments.find((p: { method: string }) => p.method === 'ECHEQ').chequeStatus).toBe('En cartera');

    // La cartera se crea sola; el e-cheq diferido todavía no cuenta a fecha valor.
    expect(await balances()).toEqual({ cash: '1000.00', bank: '2000.00', portfolio: '8000.00', portfolioValue: '5000.00' });
    expect(await ledgerBalance()).toBe('-11500.00');

    const echeq = (await admin.get(`/treasury/cheques/${await chequeOf(r.id, 'E-77')}`).expect(200)).body;
    expect(echeq).toMatchObject({ isEcheq: true, drawerName: 'Otra Empresa SRL', status: 'IN_PORTFOLIO', receivedFrom: { id: customer } });
    const cheque = (await admin.get(`/treasury/cheques/${await chequeOf(r.id, '0001')}`).expect(200)).body;
    expect(cheque.drawerName).toBe('Bebés del Sur SA'); // sin librador: es el mismo cliente
  });

  it('valida la cuenta de cada medio y no acepta un cheque vigente dos veces', async () => {
    await admin.post('/sales/receipts', { customerId: customer, payments: [{ method: 'CASH', amount: '10', cashAccountId: t.bankId }] }).expect(422);
    await admin
      .post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '10', bank: 'BANCO GALICIA', reference: '0001', dueDate: day(0) }] })
      .expect(409);
    await admin
      .post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '10', bank: 'Banco Galicia', reference: '0002', dueDate: day(400) }] })
      .expect(422); // pago diferido a más de 360 días
  });

  it('depósito y acreditación: recién acreditado suma al banco', async () => {
    const id = await chequeOf(receiptId, '0001');
    const sales = await login(app, t.users.SALES);
    await sales.post(`/treasury/cheques/${id}/deposit`, { bankAccountId: t.bankId }).expect(403);
    await admin.post(`/treasury/cheques/${id}/deposit`, { bankAccountId: t.cashBoxId }).expect(422);

    // Dos depósitos simultáneos del mismo cheque: uno solo prospera.
    const results = await Promise.all([
      admin.post(`/treasury/cheques/${id}/deposit`, { bankAccountId: t.bankId }),
      admin.post(`/treasury/cheques/${id}/deposit`, { bankAccountId: t.bankId }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 422]);
    expect(await balances()).toMatchObject({ bank: '2000.00', portfolio: '3000.00' });

    const credited = (await admin.post(`/treasury/cheques/${id}/credit`, {}).expect(201)).body;
    expect(credited.status).toBe('CREDITED');
    expect(credited.events.map((e: { event: string }) => e.event)).toEqual(['RECEIVE', 'DEPOSIT', 'CREDIT']);
    expect(await balances()).toMatchObject({ bank: '7000.00', portfolio: '3000.00' });
    await admin.post(`/treasury/cheques/${id}/reject`, { reason: 'Sin fondos' }).expect(422);
  });

  it('un cheque diferido no se deposita antes de su fecha; rechazado en cartera se debita al cliente', async () => {
    const id = await chequeOf(receiptId, 'E-77');
    await admin.post(`/treasury/cheques/${id}/deposit`, { bankAccountId: t.bankId }).expect(422);
    await admin.post(`/treasury/cheques/${id}/reject`, { reason: 'Firma no coincide', bankFee: '100' }).expect(422); // sin depositar no hay gasto bancario
    const rejected = (await admin.post(`/treasury/cheques/${id}/reject`, { reason: 'Firma no coincide' }).expect(201)).body;
    expect(rejected.status).toBe('REJECTED');
    expect(await balances()).toMatchObject({ portfolio: '0.00' });
    expect(await ledgerBalance()).toBe('-8500.00');
    // Rechazado: el número no queda libre (sigue siendo el mismo cheque).
    await admin
      .post('/sales/receipts', { customerId: customer, payments: [{ method: 'ECHEQ', amount: '3000', bank: 'Banco Macro', reference: 'E-77', dueDate: day(20) }] })
      .expect(409);
  });

  it('no se anula un recibo con cheques ya depositados', async () => {
    await admin.post(`/sales/receipts/${receiptId}/void`, { reason: 'Prueba' }).expect(422);
  });

  it('anular un recibo devuelve los fondos y los cheques en cartera', async () => {
    const before = await balances();
    const r = (
      await admin
        .post('/sales/receipts', {
          customerId: customer,
          payments: [
            { method: 'CASH', amount: '700' },
            { method: 'CHEQUE', amount: '4000', bank: 'Banco Credicoop', reference: '9001', dueDate: day(0) },
          ],
        })
        .expect(201)
    ).body;
    await admin.post(`/sales/receipts/${r.id}/void`, { reason: 'Se cargó al cliente equivocado' }).expect(201);
    expect(await balances()).toEqual(before);
    const cheque = (await admin.get(`/treasury/cheques/${await chequeOf(r.id, '9001')}`).expect(200)).body;
    expect(cheque.status).toBe('RETURNED');
    // Devuelto: puede volver a recibirse en el recibo correcto.
    await admin
      .post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '4000', bank: 'Banco Credicoop', reference: '9001', dueDate: day(0) }] })
      .expect(201);
  });

  it('rechazo de un cheque depositado: el gasto sale del banco y se traslada al cliente', async () => {
    const r = (
      await admin
        .post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '2500', bank: 'Banco Santander', reference: '555', dueDate: day(-3) }] })
        .expect(201)
    ).body;
    const id = await chequeOf(r.id, '555');
    await admin.post(`/treasury/cheques/${id}/deposit`, { bankAccountId: t.bankId }).expect(201);
    const bankBefore = (await balances()).bank;
    const ledgerBefore = await ledgerBalance();
    await admin.post(`/treasury/cheques/${id}/reject`, { reason: 'Sin fondos', bankFee: '350' }).expect(201);
    expect((await balances()).bank).toBe((Number(bankBefore) - 350).toFixed(2));
    expect(await ledgerBalance()).toBe((Number(ledgerBefore) + 2850).toFixed(2));

    const list = (await admin.get('/treasury/cheques?ownership=THIRD&status=REJECTED').expect(200)).body;
    expect(list.rows.map((c: { number: string }) => c.number).sort()).toEqual(['555', 'E-77']);
    expect(list.summary.find((s: { status: string }) => s.status === 'REJECTED').amount).toBe('5500.00');
  });

  it('los eventos de un cheque son inmutables', async () => {
    await expect(owner.chequeEvent.updateMany({ where: { companyId: t.companyId }, data: { notes: 'editado' } })).rejects.toThrow();
    await expect(owner.chequeEvent.deleteMany({ where: { companyId: t.companyId } })).rejects.toThrow();
  });
});
