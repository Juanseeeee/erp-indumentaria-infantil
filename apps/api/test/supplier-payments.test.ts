import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let customer: string;
let supplier: string;
let invoiceEntry: string;
let chequeA: string;

function day(offset = 0) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function balances() {
  const rows = (await admin.get('/treasury/accounts').expect(200)).body as { id: string; type: string; operationBalance: string; valueBalance: string }[];
  const byId = (id: string) => rows.find((r) => r.id === id)!;
  return {
    cash: byId(t.cashBoxId).operationBalance,
    bank: byId(t.bankId).operationBalance,
    bankValue: byId(t.bankId).valueBalance,
    portfolio: rows.find((r) => r.type === 'CHEQUE_PORTFOLIO')!.operationBalance,
  };
}
const balanceOf = async (party: string, tipo: 'PAYABLE' | 'RECEIVABLE') => (await admin.get(`/accounts/${party}?tipo=${tipo}`).expect(200)).body.balance as string;
const cheque = async (id: string) => (await admin.get(`/treasury/cheques/${id}`).expect(200)).body;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  customer = (await admin.post('/parties', { legalName: 'Bebés del Sur SA', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'] }).expect(201)).body.id;
  supplier = (await admin.post('/parties', { legalName: 'Textil SA', taxIdType: 'CUIT', taxId: '30700000083', taxCondition: 'RI', roles: ['SUPPLIER'] }).expect(201)).body.id;
  await admin
    .post('/purchasing/invoices', { supplierId: supplier, docType: 'FA', pointOfSale: 3, number: 77, issueDate: day(-5), lines: [{ description: 'Tela', qty: '1', unitPrice: '100000', vatRate: '21' }] })
    .expect(201);
  const open = (await admin.get(`/accounts/${supplier}/open?tipo=PAYABLE`).expect(200)).body;
  invoiceEntry = open.debits[0].id;
  const r = (
    await admin
      .post('/sales/receipts', {
        customerId: customer,
        payments: [
          { method: 'CASH', amount: '200000' },
          { method: 'CHEQUE', amount: '30000', bank: 'Banco Galicia', reference: 'A-1', dueDate: day(0) },
          { method: 'CHEQUE', amount: '20000', bank: 'Banco Galicia', reference: 'B-2', dueDate: day(10) },
        ],
      })
      .expect(201)
  ).body;
  chequeA = r.payments.find((p: { reference: string }) => p.reference === 'A-1').chequeId;
});

afterAll(async () => {
  await app.close();
});

describe('órdenes de pago', () => {
  let paymentId: string;

  it('paga una factura con endoso, cheque propio, efectivo y retención', async () => {
    const p = (
      await admin
        .post('/treasury/payments', {
          supplierId: supplier,
          payments: [
            { method: 'THIRD_CHEQUE', chequeId: chequeA },
            { method: 'OWN_CHEQUE', amount: '40000', cashAccountId: t.bankId, reference: '100001', paymentDate: day(15) },
            { method: 'CASH', amount: '41000' },
            { method: 'RETENTION', amount: '10000', reference: 'Cert. ganancias 15' },
          ],
          allocations: [{ entryId: invoiceEntry, amount: '121000' }],
        })
        .expect(201)
    ).body;
    paymentId = p.id;
    expect(p.number).toMatch(/^OP-/);
    expect(p.total).toBe('121000');
    expect(p.unapplied).toBe('0');
    expect(await balanceOf(supplier, 'PAYABLE')).toBe('0.00');
    // El cheque propio baja el saldo del banco ya, pero a fecha valor recién el día de pago.
    expect(await balances()).toEqual({ cash: '159000.00', bank: '-40000.00', bankValue: '0.00', portfolio: '20000.00' });

    const endorsed = await cheque(chequeA);
    expect(endorsed).toMatchObject({ status: 'DELIVERED', deliveredTo: { id: supplier } });
    const own = await cheque(p.lines.find((l: { method: string }) => l.method === 'OWN_CHEQUE').chequeId);
    expect(own).toMatchObject({ ownership: 'OWN', status: 'ISSUED', bank: 'Banco Nación', number: '100001' });
  });

  it('no endosa un cheque que ya salió ni repite un cheque propio', async () => {
    await admin.post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'THIRD_CHEQUE', chequeId: chequeA }] }).expect(409);
    await admin
      .post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'OWN_CHEQUE', amount: '5', cashAccountId: t.bankId, reference: '100001', paymentDate: day(1) }] })
      .expect(409);
    await admin.post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'OWN_CHEQUE', amount: '5', cashAccountId: t.cashBoxId, reference: '9', paymentDate: day(1) }] }).expect(422);
    await admin.post('/treasury/payments', { supplierId: customer, payments: [{ method: 'CASH', amount: '5' }] }).expect(422);
    await admin
      .post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'CASH', amount: '5' }], allocations: [{ entryId: invoiceEntry, amount: '10' }] })
      .expect(422);
  });

  it('permisos: compras consulta pagos pero no paga', async () => {
    const purchasing = await login(app, t.users.PURCHASING);
    await purchasing.get('/treasury/payments').expect(200);
    await purchasing.post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'CASH', amount: '5' }] }).expect(403);
  });

  it('anular el pago devuelve los fondos, recupera el endoso y anula el cheque propio', async () => {
    const p = (await admin.post(`/treasury/payments/${paymentId}/void`, { reason: 'Se pagó la factura equivocada' }).expect(201)).body;
    expect(p.status).toBe('VOIDED');
    expect(await balances()).toEqual({ cash: '200000.00', bank: '0.00', bankValue: '0.00', portfolio: '50000.00' });
    expect(await balanceOf(supplier, 'PAYABLE')).toBe('121000.00');
    expect((await cheque(chequeA)).status).toBe('IN_PORTFOLIO');
    expect((await cheque(p.lines.find((l: { method: string }) => l.method === 'OWN_CHEQUE').chequeId)).status).toBe('VOIDED');
    await admin.post(`/treasury/payments/${paymentId}/void`, { reason: 'otra vez' }).expect(422);
  });

  it('un cheque propio debitado impide anular; un endoso rechazado revive ambas deudas', async () => {
    const p = (
      await admin
        .post('/treasury/payments', {
          supplierId: supplier,
          payments: [
            { method: 'THIRD_CHEQUE', chequeId: chequeA },
            { method: 'OWN_ECHEQ', amount: '91000', cashAccountId: t.bankId, reference: 'EQ-1', paymentDate: day(0) },
          ],
          allocations: [{ entryId: invoiceEntry, amount: '121000' }],
        })
        .expect(201)
    ).body;
    const echeq = p.lines.find((l: { method: string }) => l.method === 'OWN_ECHEQ').chequeId;
    await admin.post(`/treasury/cheques/${echeq}/debit`, {}).expect(201);
    expect((await cheque(echeq)).status).toBe('DEBITED');
    await admin.post(`/treasury/payments/${p.id}/void`, { reason: 'Prueba' }).expect(422);

    const customerBefore = Number(await balanceOf(customer, 'RECEIVABLE'));
    await admin.post(`/treasury/cheques/${chequeA}/reject`, { reason: 'Sin fondos' }).expect(201);
    expect(await balanceOf(supplier, 'PAYABLE')).toBe('30000.00');
    expect(await balanceOf(customer, 'RECEIVABLE')).toBe((customerBefore + 30000).toFixed(2));
    expect((await balances()).portfolio).toBe('20000.00'); // el endoso ya lo había sacado de cartera

    const own = (await admin.get('/treasury/cheques?ownership=OWN').expect(200)).body;
    expect(own.rows.map((c: { number: string; status: string }) => `${c.number}:${c.status}`).sort()).toEqual(['100001:VOIDED', 'EQ-1:DEBITED']);
  });
});
