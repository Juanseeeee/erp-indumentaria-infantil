import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, opening, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let customer: string;
let items: { body: string; hat: string; socks: string };
let today: string;

/** Pedido → confirmación → remito → factura de una variante; devuelve la factura con sus líneas. */
async function sell(itemId: string, qty: string) {
  const o = (await admin.post('/sales/orders', { customerId: customer, warehouseId: t.whA, lines: [{ itemId, qty }] }).expect(201)).body;
  const c = (await admin.post(`/sales/orders/${o.id}/confirm`, { creditOverrideNote: 'prueba de rentabilidad' }).expect(201)).body;
  const d = (await admin.post('/sales/deliveries', { orderId: o.id, lines: [{ orderLineId: c.lines[0].id, qty }] }).expect(201)).body;
  const inv = (await admin.post('/sales/invoices', { customerId: customer, deliveryIds: [d.id] }).expect(201)).body;
  return { order: o, invoice: (await admin.get(`/sales/documents/${inv.id}`).expect(200)).body as { id: string; lines: { id: string }[] } };
}

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  await owner.branch.create({ data: { companyId: t.companyId, name: 'Central', arcaPointOfSale: 3 } });
  const color = t.colors[0]!;
  const create = async (code: string, name: string) => {
    const id = (await admin.post('/catalog/products', { code, name, sizeScaleId: t.sizeScaleId, colorIds: [color], status: 'ACTIVE' }).expect(201)).body.id as string;
    const cells: { itemId: string; sizeId: string }[] = (await admin.get(`/catalog/products/${id}/matrix`).expect(200)).body.cells;
    return { id, item: cells.find((c) => c.sizeId === t.sizeIds[0])!.itemId };
  };
  const body = await create('BODY', 'Body manga larga');
  const hat = await create('GORRO', 'Gorro con nudo');
  const socks = await create('MEDIAS', 'Medias sin costo cargado');
  items = { body: body.item, hat: hat.item, socks: socks.item };
  await opening(admin, t.whA, [
    { itemId: body.item, qty: '50', unitCost: '3000' },
    { itemId: hat.item, qty: '50', unitCost: '1500' },
    { itemId: socks.item, qty: '20', unitCost: '0' },
  ]);
  const priceList = (await admin.post('/sales/price-lists', { name: 'Mayorista' }).expect(201)).body.id;
  await admin
    .post(`/sales/price-lists/${priceList}/prices`, { prices: [{ productId: body.id, price: '10000' }, { productId: hat.id, price: '5000' }, { productId: socks.id, price: '2000' }] })
    .expect(201);
  customer = (
    await admin
      .post('/parties', { legalName: 'Pañalera Margen SRL', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'], customer: { priceListId: priceList } })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await app.close();
});

describe('rentabilidad (margen bruto estimado)', () => {
  let orders: { body: string; hat: string };

  it('por modelo: costo de salida del remito, devoluciones al mismo costo y bonificaciones sin costo', async () => {
    const body = await sell(items.body, '10'); // 100.000 neto, costo 30.000
    const hat = await sell(items.hat, '4'); // 20.000 neto, costo 6.000
    await sell(items.socks, '3'); // 6.000 neto, sin costo cargado
    orders = { body: body.order.id, hat: hat.order.id };
    // Devolución de 2 bodies: −20.000 de venta y −6.000 de costo.
    await admin.post('/sales/credit-notes', { invoiceId: body.invoice.id, reason: 'Devolución por falla', returnWarehouseId: t.whA, lines: [{ invoiceLineId: body.invoice.lines[0]!.id, qty: '2' }] }).expect(201);
    // Gorro: nota por cantidades sin devolución (−5.000, el costo se mantiene) y bonificación suelta (−5.000).
    await admin.post('/sales/credit-notes', { invoiceId: hat.invoice.id, reason: 'Diferencia de precio', lines: [{ invoiceLineId: hat.invoice.lines[0]!.id, qty: '1' }] }).expect(201);
    await admin.post('/sales/credit-notes', { invoiceId: hat.invoice.id, reason: 'Bonificación comercial', concepts: [{ description: 'Bonificación por volumen', net: '5000', vatRate: '21' }] }).expect(201);

    const r = (await admin.get(`/reports/profitability?from=${today}&to=${today}&groupBy=product`).expect(200)).body;
    const rows = r.rows.map((x: { label: string; units: string; net: string; cost: string; margin: string; marginPct: number | null; uncostedUnits: string }) => [
      x.label, x.units, x.net, x.cost, x.margin, x.marginPct, x.uncostedUnits,
    ]);
    expect(rows).toEqual([
      ['Body manga larga', '8', '80000.00', '24000.00', '56000.00', 70, '0'],
      ['Gorro con nudo', '4', '15000.00', '6000.00', '9000.00', 60, '0'],
      ['Medias sin costo cargado', '3', '6000.00', '0.00', '6000.00', 100, '3'],
      ['Otros conceptos (fletes, bonificaciones)', '0', '-5000.00', '0.00', '-5000.00', -100, '0'],
    ]);
    expect(r.totals).toEqual({ units: '15', net: '96000.00', cost: '30000.00', margin: '66000.00', marginPct: 68.8, uncostedUnits: '3' });
    expect(r.rows[0].href).toMatch(/^\/catalogo\//);
  });

  it('por pedido, cliente, categoría y vendedor suman lo mismo', async () => {
    const get = async (groupBy: string) => (await admin.get(`/reports/profitability?from=${today}&to=${today}&groupBy=${groupBy}`).expect(200)).body;
    const byOrder = await get('order');
    const orderRow = (id: string) => byOrder.rows.find((x: { key: string }) => x.key === id);
    expect(orderRow(orders.body)).toMatchObject({ net: '80000.00', cost: '24000.00', margin: '56000.00', sub: 'Pañalera Margen SRL', href: `/ventas/pedidos/${orders.body}` });
    expect(orderRow(orders.hat)).toMatchObject({ net: '15000.00', margin: '9000.00' });
    expect(byOrder.rows.find((x: { key: string | null }) => x.key === null)).toMatchObject({ label: expect.stringMatching(/^Sin pedido/), net: '-5000.00' });

    const byCustomer = await get('customer');
    expect(byCustomer.rows).toHaveLength(1);
    expect(byCustomer.rows[0]).toMatchObject({ key: customer, label: 'Pañalera Margen SRL', net: '96000.00', margin: '66000.00', share: 100 });

    const byCategory = await get('category');
    expect(byCategory.rows.map((x: { label: string; margin: string }) => [x.label, x.margin])).toEqual([
      ['Sin categoría', '71000.00'],
      ['Otros conceptos (fletes, bonificaciones)', '-5000.00'],
    ]);
    for (const dim of [byOrder, byCustomer, byCategory, await get('seller')]) expect(dim.totals.margin).toBe('66000.00');
  });

  it('respeta el período y valida las fechas', async () => {
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const t1 = tomorrow.toISOString().slice(0, 10);
    const r = (await admin.get(`/reports/profitability?from=${t1}&to=${t1}`).expect(200)).body;
    expect(r).toMatchObject({ groupBy: 'product', rows: [], totals: { net: '0.00', margin: '0.00', marginPct: null } });
    await admin.get(`/reports/profitability?from=${t1}&to=${today}`).expect(400);
    await admin.get('/reports/profitability?from=2026-13-01&to=2026-12-31').expect(400);
  });

  it('solo la ven quienes ven ventas y costos', async () => {
    for (const role of ['OWNER', 'ADMIN', 'ACCOUNTING'] as const) await (await login(app, t.users[role])).get(`/reports/profitability?from=${today}&to=${today}`).expect(200);
    // Ventas y Auditoría no ven costos; Producción ve costos pero no ventas; Tesorería ninguno de los dos.
    for (const role of ['SALES', 'AUDITOR', 'PRODUCTION', 'TREASURY'] as const) await (await login(app, t.users[role])).get(`/reports/profitability?from=${today}&to=${today}`).expect(403);
  });
});
