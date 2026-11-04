import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let treasury: Client;
let direction: Client;
let supplier: string;
let invoice: string;

/** Día calendario de negocio (AAAA-MM-DD) con desplazamiento. */
function day(offset = 0) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
/** Mes (AAAA-MM) relativo al actual. */
function month(offset = 0) {
  const [y, m] = day().split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + offset, 1)).toISOString().slice(0, 7);
}

const balance = async (id: string) =>
  ((await admin.get('/treasury/accounts').expect(200)).body as { id: string; operationBalance: string }[]).find((a) => a.id === id)!.operationBalance;
const openOf = async (entryId: string) => (await owner.accountEntry.findUniqueOrThrow({ where: { id: entryId } })).openAmount.toString();

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  treasury = await login(app, t.users.TREASURY);
  direction = await login(app, t.users.OWNER);
  supplier = (await admin.post('/parties', { legalName: 'Textil Norte SRL', taxIdType: 'CUIT', taxId: '30711111111', taxCondition: 'RI', roles: ['SUPPLIER'] }).expect(201)).body.id;
  invoice = (
    await owner.accountEntry.create({
      data: {
        companyId: t.companyId,
        partyId: supplier,
        accountType: 'PAYABLE',
        entryType: 'INVOICE',
        sourceDocType: 'TEST',
        sourceDocId: randomUUID(),
        description: 'Factura A 0003-00000456',
        date: new Date(`${day(-10)}T00:00:00.000Z`),
        dueDate: new Date(`${day(5)}T00:00:00.000Z`),
        amount: '300000',
        openAmount: '300000',
        createdBy: randomUUID(),
      },
    })
  ).id;
  await admin.post(`/treasury/accounts/${t.bankId}/movements`, { direction: 'IN', amount: '1000000', concept: 'Saldo inicial' }).expect(201);
  await admin.post(`/treasury/accounts/${t.cashBoxId}/movements`, { direction: 'IN', amount: '200000', concept: 'Saldo inicial' }).expect(201);
  await admin.put('/settings/approval-rules', { actionCode: 'payables.payment', threshold: '100000' }).expect(200);
});

afterAll(async () => {
  await app.close();
});

describe('aprobación de órdenes de pago', () => {
  it('sobre el umbral queda pendiente sin mover nada; Dirección la aprueba y recién ahí se paga', async () => {
    const big = (
      await treasury
        .post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'TRANSFER', amount: '250000', cashAccountId: t.bankId }], allocations: [{ entryId: invoice, amount: '250000' }] })
        .expect(201)
    ).body;
    expect(big).toMatchObject({ status: 'PENDING_APPROVAL', plannedAllocations: [{ document: 'Factura A 0003-00000456', amount: '250000.00' }], allocations: [] });
    expect(await balance(t.bankId)).toBe('1000000.00');
    expect(await openOf(invoice)).toBe('300000');
    expect(await owner.accountEntry.count({ where: { sourceDocId: big.id } })).toBe(0);

    // Por debajo del umbral se paga en el acto.
    const small = (await treasury.post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'TRANSFER', amount: '50000', cashAccountId: t.bankId }] }).expect(201)).body;
    expect(small.status).toBe('POSTED');
    expect(await balance(t.bankId)).toBe('950000.00');

    const pendingList = (await treasury.get('/treasury/payments?status=PENDING_APPROVAL').expect(200)).body;
    expect(pendingList.rows.map((r: { id: string }) => r.id)).toEqual([big.id]);

    await treasury.post(`/treasury/payments/${big.id}/approve`).expect(403); // Tesorería paga pero no aprueba
    await treasury.post(`/treasury/payments/${big.id}/void`, { reason: 'Prueba' }).expect(422); // pendiente: se rechaza, no se anula
    const approved = (await direction.post(`/treasury/payments/${big.id}/approve`).expect(201)).body;
    expect(approved).toMatchObject({ status: 'POSTED', approvedByName: expect.any(String), allocations: [{ amount: '250000' }] });
    expect(await balance(t.bankId)).toBe('700000.00');
    expect(await openOf(invoice)).toBe('50000');
    await direction.post(`/treasury/payments/${big.id}/approve`).expect(422);
  });

  it('cheques: el propio se emite al aprobar y el de cartera queda reservado mientras está pendiente', async () => {
    const own = (
      await treasury
        .post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'OWN_CHEQUE', amount: '120000', cashAccountId: t.bankId, reference: '000900', paymentDate: day(30) }] })
        .expect(201)
    ).body;
    expect(own.status).toBe('PENDING_APPROVAL');
    expect(await owner.cheque.count({ where: { companyId: t.companyId, ownership: 'OWN' } })).toBe(0);
    const approved = (await direction.post(`/treasury/payments/${own.id}/approve`).expect(201)).body;
    expect(approved.lines[0].cheque).toMatchObject({ number: '000900', status: 'ISSUED' });

    const customer = (await admin.post('/parties', { legalName: 'Bebés del Sur SA', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'] }).expect(201)).body.id;
    const receipt = (
      await admin.post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '150000', bank: 'Banco Galicia', reference: '7777', dueDate: day(10) }] }).expect(201)
    ).body;
    const chequeId = receipt.payments[0].chequeId as string;
    const endorse = { supplierId: supplier, payments: [{ method: 'THIRD_CHEQUE', chequeId }] };
    const first = (await treasury.post('/treasury/payments', endorse).expect(201)).body;
    expect(first.status).toBe('PENDING_APPROVAL');
    const dup = await treasury.post('/treasury/payments', endorse).expect(409);
    expect(dup.body.message).toContain(first.number);

    await treasury.post(`/treasury/payments/${first.id}/reject`, { reason: 'Mejor pagar con transferencia' }).expect(403);
    const rejected = (await direction.post(`/treasury/payments/${first.id}/reject`, { reason: 'Mejor pagar con transferencia' }).expect(201)).body;
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'Mejor pagar con transferencia' });
    expect((await admin.get(`/treasury/cheques/${chequeId}`).expect(200)).body.status).toBe('IN_PORTFOLIO');
    expect((await treasury.post('/treasury/payments', endorse).expect(201)).body.status).toBe('PENDING_APPROVAL'); // liberado
  });

  it('al aprobar se vuelve a validar: si la caja ya no tiene el efectivo, sigue pendiente', async () => {
    const cash = (await treasury.post('/treasury/payments', { supplierId: supplier, payments: [{ method: 'CASH', amount: '150000', cashAccountId: t.cashBoxId }] }).expect(201)).body;
    await admin.post(`/treasury/accounts/${t.cashBoxId}/movements`, { direction: 'OUT', amount: '100000', concept: 'Retiro' }).expect(201);
    await direction.post(`/treasury/payments/${cash.id}/approve`).expect(422);
    expect((await admin.get(`/treasury/payments/${cash.id}`).expect(200)).body.status).toBe('PENDING_APPROVAL');
  });
});

describe('gastos recurrentes', () => {
  let template: string;

  beforeAll(async () => {
    const center = (await admin.post('/settings/cost-centers', { code: 'ADM', name: 'Administración' }).expect(201)).body.id;
    const category = (await admin.post('/settings/categories', { name: 'Alquiler', kind: 'EXPENSE' }).expect(201)).body.id;
    template = (
      await treasury
        .post('/treasury/expense-templates', { name: 'Alquiler depósito', categoryId: category, costCenterId: center, cashAccountId: t.bankId, amount: '450000', dayOfMonth: 10, startsOn: `${month(-1)}-01` })
        .expect(201)
    ).body.id;
    await treasury.post('/treasury/expense-templates', { name: 'Día inválido', categoryId: category, costCenterId: center, cashAccountId: t.bankId, amount: '1', dayOfMonth: 31 }).expect(400);
  });

  it('muestra los meses pendientes, se registra cada uno una sola vez y anular lo libera', async () => {
    let list = (await treasury.get('/treasury/expense-templates').expect(200)).body;
    expect(list[0].pending.map((p: { period: string }) => p.period)).toEqual([month(-1), month(0)]);

    const e = (await treasury.post(`/treasury/expense-templates/${template}/register`, { period: month(-1), amount: '455000', documentReference: 'Recibo 0045' }).expect(201)).body;
    expect(e).toMatchObject({ amount: '455000', period: month(-1), description: `Alquiler depósito · ${month(-1)}`, date: expect.stringMatching(new RegExp(`^${month(-1)}-10`)) });
    const again = await treasury.post(`/treasury/expense-templates/${template}/register`, { period: month(-1) }).expect(409);
    expect(again.body.message).toContain(e.number);
    list = (await treasury.get('/treasury/expense-templates').expect(200)).body;
    expect(list[0]).toMatchObject({ lastPeriod: month(-1), pending: [{ period: month(0) }] });

    await treasury.post(`/treasury/expenses/${e.id}/void`, { reason: 'Importe equivocado' }).expect(201);
    await treasury.post(`/treasury/expense-templates/${template}/register`, { period: month(-1) }).expect(201); // con el importe habitual
  });

  it('el flujo de fondos proyecta los meses sin registrar; desactivada, deja de contar', async () => {
    const kindItems = async () =>
      ((await treasury.get('/treasury/cashflow?weeks=13').expect(200)).body.items as { kind: string; description: string; amount: string }[]).filter((i) => i.kind === 'GASTOS_FIJOS');
    const items = await kindItems();
    expect(items.map((i) => i.description)).toEqual(expect.arrayContaining([`Alquiler depósito · ${month(0)}`, `Alquiler depósito · ${month(1)}`, `Alquiler depósito · ${month(2)}`]));
    expect(items.every((i) => i.amount === '-450000.00')).toBe(true);
    expect(items.some((i) => i.description.endsWith(month(-1)))).toBe(false); // ya registrado

    await treasury.post(`/treasury/expense-templates/${template}/deactivate`).expect(201);
    expect(await kindItems()).toEqual([]);
    await treasury.post(`/treasury/expense-templates/${template}/register`, { period: month(0) }).expect(422);
  });
});
