import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, opening, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let customer: string;
let products: { body: string; hat: string };
let items: { body: string; hat: string };

/** Día calendario de negocio (AAAA-MM-DD) con desplazamiento. */
function day(offset = 0) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Pedido → confirmación → remito → factura de una variante; devuelve la factura. */
async function sell(itemId: string, qty: string) {
  const o = (await admin.post('/sales/orders', { customerId: customer, warehouseId: t.whA, lines: [{ itemId, qty }] }).expect(201)).body;
  const c = (await admin.post(`/sales/orders/${o.id}/confirm`, { creditOverrideNote: 'prueba de tablero' }).expect(201)).body;
  const d = (await admin.post('/sales/deliveries', { orderId: o.id, lines: [{ orderLineId: c.lines[0].id, qty }] }).expect(201)).body;
  return (await admin.post('/sales/invoices', { customerId: customer, deliveryIds: [d.id] }).expect(201)).body;
}

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  await owner.branch.create({ data: { companyId: t.companyId, name: 'Central', arcaPointOfSale: 3 } });
  const color = t.colors[0]!;
  const create = async (code: string, name: string) => {
    const id = (await admin.post('/catalog/products', { code, name, sizeScaleId: t.sizeScaleId, colorIds: [color], status: 'ACTIVE' }).expect(201)).body.id as string;
    const cells: { itemId: string; sizeId: string }[] = (await admin.get(`/catalog/products/${id}/matrix`).expect(200)).body.cells;
    return { id, item: cells.find((c) => c.sizeId === t.sizeIds[0])!.itemId };
  };
  const body = await create('BODY', 'Body manga larga');
  const hat = await create('GORRO', 'Gorro con nudo');
  const idle = await create('BABERO', 'Babero sin ventas');
  products = { body: body.id, hat: hat.id };
  items = { body: body.item, hat: hat.item };
  await opening(admin, t.whA, [
    { itemId: body.item, qty: '50', unitCost: '3000' },
    { itemId: hat.item, qty: '50', unitCost: '1500' },
    { itemId: idle.item, qty: '12', unitCost: '900' },
  ]);
  const priceList = (await admin.post('/sales/price-lists', { name: 'Mayorista' }).expect(201)).body.id;
  await admin.post(`/sales/price-lists/${priceList}/prices`, { prices: [{ productId: body.id, price: '10000' }, { productId: hat.id, price: '5000' }] }).expect(201);
  customer = (
    await admin
      .post('/parties', {
        legalName: 'Pañalera Test SRL',
        taxIdType: 'CUIT',
        taxId: '30700000016',
        taxCondition: 'RI',
        roles: ['CUSTOMER'],
        customer: { creditLimit: '50000', priceListId: priceList },
      })
      .expect(201)
  ).body.id;
  await admin.post(`/treasury/accounts/${t.bankId}/movements`, { direction: 'IN', amount: '250000', concept: 'Saldo inicial' }).expect(201);
});

afterAll(async () => {
  await app.close();
});

describe('tablero de Dirección', () => {
  it('vendido, cobrado y disponible del mes, con su comparación', async () => {
    await sell(items.body, '10'); // 100.000 neto
    await sell(items.hat, '4'); // 20.000 neto
    await admin.post('/sales/receipts', { customerId: customer, payments: [{ method: 'TRANSFER', amount: '30000', cashAccountId: t.bankId }] }).expect(201);

    const r = (await admin.get('/reports/executive').expect(200)).body;
    expect(r.kpis.sales).toMatchObject({ value: '120000.00', previous: '0.00', change: null, href: '/ventas/comprobantes' });
    expect(r.kpis.collected).toMatchObject({ value: '30000.00' });
    expect(r.kpis.available.value).toBe('280000.00');
    // Clientes: 145.200 con IVA − 30.000 cobrado = 115.200 de saldo, sobre un límite de 50.000.
    expect(r.attention.customersOverLimit).toEqual([{ id: customer, name: 'Pañalera Test SRL', limit: '50000.00', balance: '115200.00' }]);
    expect(r.topProducts.map((p: { name: string; net: string; units: string }) => [p.name, p.net])).toEqual([
      ['Body manga larga', '100000.00'],
      ['Gorro con nudo', '20000.00'],
    ]);
    expect(r.idleProducts.map((p: { name: string }) => p.name)).toEqual(['Babero sin ventas']);
    expect(r.cashflow.weeks).toHaveLength(8);
    expect(r.cashflow.opening).toBe('280000.00');
  });

  it('cheques a 30 días, deuda vencida de clientes y deuda con proveedores', async () => {
    await admin.post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '15000', bank: 'Banco Galicia', reference: '0001', dueDate: day(20) }] }).expect(201);
    await admin.post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '9000', bank: 'Banco Galicia', reference: '0002', dueDate: day(45) }] }).expect(201);
    const supplier = (await admin.post('/parties', { legalName: 'Textil Norte SRL', taxIdType: 'CUIT', taxId: '30711111111', taxCondition: 'RI', roles: ['SUPPLIER'] }).expect(201)).body.id;
    const entry = (due: number, amount: string, partyId = supplier, accountType: 'PAYABLE' | 'RECEIVABLE' = 'PAYABLE') => ({
      companyId: t.companyId, partyId, accountType, entryType: 'INVOICE', sourceDocType: 'TEST', sourceDocId: crypto.randomUUID(),
      description: `Factura proveedor ${due}`, date: new Date(`${day(-1)}T00:00:00.000Z`), dueDate: new Date(`${day(due)}T00:00:00.000Z`), amount, openAmount: amount, createdBy: crypto.randomUUID(),
    });
    // Las facturas del mes vencen hoy (condición contado): no están vencidas. Se agrega una de hace 5 días.
    await owner.accountEntry.createMany({ data: [entry(10, '40000'), entry(60, '70000'), entry(-5, '8000', customer, 'RECEIVABLE')] });

    const r = (await admin.get('/reports/executive').expect(200)).body;
    expect(r.kpis.chequesDue).toMatchObject({ value: '15000.00', count: 1 });
    expect(r.kpis.payablesDue).toMatchObject({ value: '40000.00', count: 1 });
    expect(r.kpis.overdueReceivables).toMatchObject({ value: '8000.00', count: 1 });
  });

  it('solo lo ven Dirección, Administración y Auditoría', async () => {
    for (const role of ['OWNER', 'ADMIN', 'AUDITOR'] as const) await (await login(app, t.users[role])).get('/reports/executive').expect(200);
    for (const role of ['SALES', 'TREASURY', 'WAREHOUSE'] as const) await (await login(app, t.users[role])).get('/reports/executive').expect(403);
  });
});
