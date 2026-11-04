import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { REPORTS } from '@erp/contracts';
import { createApp, createTenant, login, opening, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let customer: string;
let items: { body: string; hat: string };
let today: string;

const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const run = async (code: string, params: Record<string, string> = {}, client = admin, status = 200) =>
  (await client.get(`/reports/run/${code}?${new URLSearchParams(params)}`).expect(status)).body;

/** Supertest no junta binarios por defecto: se arma el Buffer a mano. */
const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

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
  items = { body: body.item, hat: hat.item };
  await opening(admin, t.whA, [
    { itemId: body.item, qty: '50', unitCost: '3000' },
    { itemId: hat.item, qty: '10', unitCost: '1500' },
  ]);
  await owner.item.update({ where: { id: hat.item }, data: { minStock: '20', reorderQty: '30' } });
  const priceList = (await admin.post('/sales/price-lists', { name: 'Mayorista' }).expect(201)).body.id;
  await admin.post(`/sales/price-lists/${priceList}/prices`, { prices: [{ productId: body.id, price: '10000' }, { productId: hat.id, price: '5000' }] }).expect(201);
  customer = (
    await admin.post('/parties', { legalName: 'Pañalera Reportes SRL', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'], customer: { priceListId: priceList } }).expect(201)
  ).body.id;

  // Venta completa de 10 bodies (100.000 neto) y 2 gorros (10.000 neto); un pedido de 5 gorros queda pendiente.
  const o = (await admin.post('/sales/orders', { customerId: customer, warehouseId: t.whA, lines: [{ itemId: body.item, qty: '10' }, { itemId: hat.item, qty: '2' }] }).expect(201)).body;
  const c = (await admin.post(`/sales/orders/${o.id}/confirm`, { creditOverrideNote: 'prueba' }).expect(201)).body;
  const d = (
    await admin.post('/sales/deliveries', { orderId: o.id, lines: c.lines.map((l: { id: string; qty: string }) => ({ orderLineId: l.id, qty: l.qty })) }).expect(201)
  ).body;
  await admin.post('/sales/invoices', { customerId: customer, deliveryIds: [d.id] }).expect(201);
  const pending = (await admin.post('/sales/orders', { customerId: customer, warehouseId: t.whA, promisedAt: day(-3), lines: [{ itemId: hat.item, qty: '5' }] }).expect(201)).body;
  await admin.post(`/sales/orders/${pending.id}/confirm`, { creditOverrideNote: 'prueba' }).expect(201);

  await admin.post(`/treasury/accounts/${t.bankId}/movements`, { direction: 'IN', amount: '50000', concept: 'Saldo inicial' }).expect(201);
  await admin.post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '20000', bank: 'Banco Galicia', reference: '0001', dueDate: day(15) }] }).expect(201);
  // Una factura vieja de 45 días para la antigüedad.
  await owner.accountEntry.create({
    data: {
      companyId: t.companyId, partyId: customer, accountType: 'RECEIVABLE', entryType: 'INVOICE', sourceDocType: 'TEST', sourceDocId: crypto.randomUUID(),
      description: 'Factura migrada', date: new Date(`${day(-75)}T00:00:00.000Z`), dueDate: new Date(`${day(-45)}T00:00:00.000Z`), amount: '7000', openAmount: '7000', createdBy: crypto.randomUUID(),
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('centro de reportes', () => {
  it('todos los reportes del catálogo corren con sus parámetros por defecto', async () => {
    for (const r of REPORTS) {
      if (r.code === 'kardex') continue; // pide SKU
      const res = await run(r.code);
      expect(res, r.code).toMatchObject({ code: r.code, title: r.title });
      expect(res.columns.length, r.code).toBeGreaterThan(1);
    }
  });

  it('ventas por mes y por modelo, y ranking con curva ABC', async () => {
    const byMonth = await run('ventas');
    expect(byMonth.rows).toHaveLength(1);
    expect(byMonth.rows[0]).toMatchObject({ docs: 1, units: '12', net: '110000.00', share: 100 });
    expect(byMonth.totals).toMatchObject({ docs: 1, net: '110000.00' });
    expect(byMonth.subtitle).toMatch(/^Del \d\d\/\d\d\/\d{4} al .* · Agrupar por: Mes$/);

    const byProduct = await run('ventas', { groupBy: 'product' });
    expect(byProduct.rows.map((r: { label: string; code: string; net: string; share: number }) => [r.label, r.code, r.net, r.share])).toEqual([
      ['Body manga larga', 'BODY', '100000.00', 90.9],
      ['Gorro con nudo', 'GORRO', '10000.00', 9.1],
    ]);
    const ranking = await run('ranking');
    expect(ranking.rows.map((r: { name: string; cumulative: number; abc: string }) => [r.name, r.cumulative, r.abc])).toEqual([
      ['Body manga larga', 90.9, 'A'],
      ['Gorro con nudo', 100, 'B'], // empieza en el 90,9 % acumulado
    ]);
  });

  it('pedidos pendientes, stock valorizado, stock crítico y kardex', async () => {
    const pending = await run('pedidos-pendientes');
    expect(pending.rows).toEqual([expect.objectContaining({ customer: 'Pañalera Reportes SRL', promised: day(-3), late: 3, units: '5', net: '25000.00' })]);

    const stock = await run('stock-valorizado', { warehouseId: t.whA });
    const value = (sku: RegExp) => stock.rows.find((r: { sku: string }) => sku.test(r.sku));
    expect(value(/^BODY/)).toMatchObject({ qty: '40', avgCost: '3000.00', value: '120000.00', kind: 'Prenda' });
    expect(value(/^GORRO/)).toMatchObject({ qty: '8', value: '12000.00' });
    expect(stock.totals.value).toBe('132000.00');

    const critical = await run('stock-critico');
    expect(critical.rows).toEqual([expect.objectContaining({ onHand: '8', min: '20', shortage: '12', suggested: '30' })]);

    const sku = value(/^BODY/).sku as string;
    const kardex = await run('kardex', { sku: sku.toLowerCase() });
    expect(kardex.rows.map((r: { type: string; in: string | null; out: string | null; balance: string }) => [r.type, r.in, r.out, r.balance])).toEqual([
      ['Saldo inicial', null, null, '0'],
      ['Stock inicial', '50', null, '50'],
      ['Entrega (remito)', null, '10', '40'],
    ]);
    expect(kardex.columns.map((c: { key: string }) => c.key)).toContain('unitCost');
    await run('kardex', { sku: 'NO-EXISTE' }, admin, 404);
    await run('kardex', {}, admin, 400);
  });

  it('antigüedad de cuentas a cobrar, cartera de cheques, caja y bancos y flujo a 90 días', async () => {
    const aging = await run('antiguedad-cobrar');
    // 133.100 facturado − 20.000 cobrado con cheque (queda a cuenta o imputado) + 7.000 vencidos hace 45 días.
    const row = aging.rows[0];
    expect(row).toMatchObject({ party: 'Pañalera Reportes SRL', d60: '7000.00', total: '120100.00' });

    const cheques = await run('cheques');
    expect(cheques.rows).toEqual([expect.objectContaining({ bank: 'Banco Galicia', days: 15, status: 'En cartera', amount: '20000.00', from: 'Pañalera Reportes SRL' })]);

    const cash = await run('caja-bancos');
    expect(cash.totals).toMatchObject({ inflow: '50000.00', closing: '50000.00' });

    const flow = await run('flujo-90');
    expect(flow.rows).toHaveLength(13);
    expect(flow.notes[0]).toMatch(/Saldo inicial disponible: \$ 50000.00/);
  });

  it('valida parámetros y respeta los permisos de cada reporte', async () => {
    await run('ventas', { from: day(1), to: today }, admin, 400);
    await run('ventas', { groupBy: 'zona' }, admin, 400);
    await run('no-existe', {}, admin, 404);

    const sales = await login(app, t.users.SALES);
    const catalog = (await sales.get('/reports/catalog').expect(200)).body.map((r: { code: string }) => r.code);
    expect(catalog).toEqual(['ventas', 'ranking', 'baja-rotacion', 'pedidos-pendientes', 'stock-critico', 'kardex', 'antiguedad-cobrar']);
    await run('stock-valorizado', {}, sales, 403);
    await run('antiguedad-pagar', {}, sales, 403);
    // Sin `costs.view` el kardex no muestra costos.
    const sku = (await run('stock-valorizado')).rows[0].sku;
    expect((await run('kardex', { sku }, sales)).columns.map((c: { key: string }) => c.key)).not.toContain('unitCost');
  });

  it('exporta a Excel y PDF el mismo resultado, y deja constancia en auditoría', async () => {
    const xlsx = await admin.get('/reports/run/ventas/export?format=xlsx&groupBy=product').buffer(true).parse(binary).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toMatch(/attachment; filename="ventas-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as Buffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getCell('A1').value)).toContain('Ventas por período');
    expect(ws.getRow(5).values).toEqual([undefined, 'Modelo', 'Código', 'Comprobantes', 'Unidades', 'Neto', '% del total']);
    expect(ws.getRow(6).values).toEqual([undefined, 'Body manga larga', 'BODY', 1, 10, 100000, 90.9]);
    expect(ws.getRow(8).getCell(5).value).toBe(110000);

    const pdf = await admin.get('/reports/run/antiguedad-cobrar/export?format=pdf').buffer(true).parse(binary).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // El pie con el número de página no agrega hojas en blanco.
    expect((pdf.body as Buffer).toString('latin1')).toMatch(/\/Count 1\b/);

    await admin.get('/reports/run/ventas/export?format=csv').expect(400);
    const logs = await owner.auditLog.findMany({ where: { companyId: t.companyId, entity: 'report', action: 'export' }, orderBy: { at: 'asc' } });
    expect(logs.map((l) => [l.entityId, (l.diff as { format: string }).format])).toEqual([
      ['ventas', 'xlsx'],
      ['antiguedad-cobrar', 'pdf'],
    ]);
    // Ventas no tiene `data.export`: ve el reporte pero no lo descarga.
    await (await login(app, t.users.SALES)).get('/reports/run/ventas/export?format=xlsx').expect(403);
  });
});
