import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, opening, owner, type Client, type Tenant } from './helpers';

/** Los correos se prueban contra Mailpit (docker compose): http://localhost:8025. */
const MAILPIT = 'http://localhost:8025';
const SMTP_OK = 'smtp://localhost:1025';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let item: string;
let customer: string;
let today: string;

const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
interface AlertRow {
  id: string;
  code: string;
  dedupKey: string;
  title: string;
  status: string;
  priority: string;
  link: string | null;
  resolutionNote: string | null;
}
const evaluate = async () => (await admin.post('/alerts/evaluate').expect(201)).body;
const mine = async (c: Client, status = 'OPEN') => (await c.get(`/alerts?status=${status}`).expect(200)).body.rows as AlertRow[];
const all = async (status = 'OPEN') => (await admin.get(`/alerts?scope=all&status=${status}&pageSize=200`).expect(200)).body.rows as AlertRow[];
const codes = (rows: AlertRow[]) => [...new Set(rows.map((r) => r.code))].sort();

beforeAll(async () => {
  process.env.SMTP_URL = SMTP_OK;
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  await owner.branch.create({ data: { companyId: t.companyId, name: 'Central', arcaPointOfSale: 3 } });
  const id = (await admin.post('/catalog/products', { code: 'BODY', name: 'Body manga larga', sizeScaleId: t.sizeScaleId, colorIds: [t.colors[0]], status: 'ACTIVE' }).expect(201)).body.id;
  const cells: { itemId: string; sizeId: string }[] = (await admin.get(`/catalog/products/${id}/matrix`).expect(200)).body.cells;
  item = cells.find((c) => c.sizeId === t.sizeIds[0])!.itemId;
  await opening(admin, t.whA, [{ itemId: item, qty: '10', unitCost: '3000' }]);
  const priceList = (await admin.post('/sales/price-lists', { name: 'Mayorista' }).expect(201)).body.id;
  await admin.post(`/sales/price-lists/${priceList}/prices`, { prices: [{ productId: id, price: '10000' }] }).expect(201);
  customer = (
    await admin.post('/parties', { legalName: 'Pañalera Alertas SRL', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'], customer: { priceListId: priceList } }).expect(201)
  ).body.id;

  // Condiciones: stock bajo el mínimo, pedido confirmado hace 5 días sin remito, cheque que vence en 2 días
  // y una factura vencida hace 20 días.
  await owner.item.update({ where: { id: item }, data: { minStock: '25' } });
  const o = (await admin.post('/sales/orders', { customerId: customer, warehouseId: t.whA, lines: [{ itemId: item, qty: '2' }] }).expect(201)).body;
  await admin.post(`/sales/orders/${o.id}/confirm`, { creditOverrideNote: 'prueba' }).expect(201);
  await owner.salesOrder.update({ where: { id: o.id }, data: { confirmedAt: new Date(day(-5).getTime() + 15 * 3_600_000) } });
  await admin.post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '15000', bank: 'Banco Galicia', reference: '0001', dueDate: day(2).toISOString().slice(0, 10) }] }).expect(201);
  await owner.accountEntry.create({
    data: {
      companyId: t.companyId, partyId: customer, accountType: 'RECEIVABLE', entryType: 'INVOICE', sourceDocType: 'TEST', sourceDocId: crypto.randomUUID(),
      description: 'Factura migrada', date: day(-50), dueDate: day(-20), amount: '40000', openAmount: '40000', createdBy: crypto.randomUUID(),
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('alertas', () => {
  it('evaluar crea una alerta por condición, con enlace, y es idempotente', async () => {
    const r = await evaluate();
    expect(r).toMatchObject({ skipped: false, created: 4 });
    const rows = await all();
    expect(codes(rows)).toEqual(['CHEQUE_DUE', 'CUSTOMER_OVERDUE', 'ORDER_NOT_PREPARED', 'STOCK_MIN']);
    expect(rows.find((a) => a.code === 'STOCK_MIN')).toMatchObject({ status: 'NEW', priority: 'NORMAL', link: `/stock/${item}`, title: expect.stringMatching(/Body manga larga/) });
    // El cheque queda a cuenta (sin imputar): lo vencido sigue siendo la factura completa.
    expect(rows.find((a) => a.code === 'CUSTOMER_OVERDUE')?.title).toBe('Pañalera Alertas SRL: $ 40.000,00 vencidos');
    expect(await evaluate()).toMatchObject({ created: 0, resolved: 0, open: 4 });
  });

  it('cada usuario ve las alertas de sus roles, la campana las cuenta y solo administración ve todas', async () => {
    const sales = await login(app, t.users.SALES);
    const treasury = await login(app, t.users.TREASURY);
    expect(codes(await mine(sales))).toEqual(['ORDER_NOT_PREPARED']);
    expect(codes(await mine(treasury))).toEqual(['CHEQUE_DUE', 'CUSTOMER_OVERDUE']);
    expect((await treasury.get('/alerts/summary').expect(200)).body).toEqual({ new: 2, open: 2, critical: 0 });
    await sales.get('/alerts?scope=all').expect(403);
    await sales.get('/alerts/rules').expect(403);

    const order = (await mine(sales))[0]!;
    await sales.post(`/alerts/${order.id}/seen`).expect(201);
    expect((await mine(sales))[0]).toMatchObject({ status: 'SEEN' });
    // Ventas no puede tocar una alerta de Tesorería.
    await sales.post(`/alerts/${(await mine(treasury))[0]!.id}/resolve`, {}).expect(403);
  });

  it('resuelta a mano no reaparece mientras la condición siga; si desaparece y vuelve, es una alerta nueva', async () => {
    const treasury = await login(app, t.users.TREASURY);
    const cheque = (await mine(treasury)).find((a) => a.code === 'CHEQUE_DUE')!;
    await treasury.post(`/alerts/${cheque.id}/resolve`, { note: 'Lo deposito mañana' }).expect(201);
    await treasury.post(`/alerts/${cheque.id}/resolve`, {}).expect(422);
    expect(await evaluate()).toMatchObject({ created: 0 });

    // La fecha de pago se corre: la condición desaparece (la alerta resuelta queda cerrada)…
    await owner.cheque.updateMany({ where: { companyId: t.companyId }, data: { paymentDate: day(30) } });
    await evaluate();
    // …y si vuelve a cumplirse, avisa de nuevo.
    await owner.cheque.updateMany({ where: { companyId: t.companyId }, data: { paymentDate: day(1) } });
    expect(await evaluate()).toMatchObject({ created: 1 });
    const history = (await all('RESOLVED')).filter((a) => a.code === 'CHEQUE_DUE');
    expect(history).toEqual([expect.objectContaining({ resolutionNote: 'Lo deposito mañana' })]);
  });

  it('se resuelve sola cuando la condición desaparece', async () => {
    await owner.item.update({ where: { id: item }, data: { minStock: '5' } });
    expect(await evaluate()).toMatchObject({ resolved: 1 });
    const stock = (await all('RESOLVED')).find((a) => a.code === 'STOCK_MIN')!;
    expect(stock.resolutionNote).toMatch(/se resolvió sola/i);
  });

  it('detecta un saldo de stock que no coincide con sus movimientos', async () => {
    const balance = await owner.stockBalance.findFirstOrThrow({ where: { companyId: t.companyId, itemId: item } });
    await owner.stockBalance.update({ where: { id: balance.id }, data: { onHand: balance.onHand.plus(1) } });
    try {
      await evaluate();
      expect((await all()).find((a) => a.code === 'INVENTORY_DIFFERENCE')).toMatchObject({ dedupKey: `projection:${item}:${t.whA}`, detail: 'El saldo dice 11 y los movimientos suman 10. Avisar a soporte.' });
    } finally {
      await owner.stockBalance.update({ where: { id: balance.id }, data: { onHand: balance.onHand } });
    }
    await evaluate();
    expect((await all()).find((a) => a.code === 'INVENTORY_DIFFERENCE')).toBeUndefined();
  });

  it('las reglas se configuran: activar, días, destinatarios y validaciones', async () => {
    const { rules, roles } = (await admin.get('/alerts/rules').expect(200)).body;
    expect(rules).toHaveLength(11);
    expect(roles.map((r: { code: string }) => r.code)).toContain('TREASURY');
    const order = rules.find((r: { code: string }) => r.code === 'ORDER_NOT_PREPARED');
    expect(order).toMatchObject({ enabled: true, days: 3, roles: ['SALES', 'WAREHOUSE'], open: 1 });

    const base = { enabled: true, priority: 'HIGH', roles: ['SALES'], userIds: [], sendEmail: false, days: 10 };
    await admin.put('/alerts/rules/ORDER_NOT_PREPARED', { ...base, days: 0 }).expect(422);
    await admin.put('/alerts/rules/ORDER_NOT_PREPARED', { ...base, roles: ['NO_EXISTE'] }).expect(422);
    await admin.put('/alerts/rules/NO_EXISTE', base).expect(404);
    await (await login(app, t.users.SALES)).put('/alerts/rules/ORDER_NOT_PREPARED', base).expect(403);
    // Con 10 días, el pedido confirmado hace 5 deja de alertar.
    await admin.put('/alerts/rules/ORDER_NOT_PREPARED', base).expect(200);
    expect(await evaluate()).toMatchObject({ resolved: 1 });

    // Desactivar una regla resuelve sus alertas abiertas.
    await admin.put('/alerts/rules/CUSTOMER_OVERDUE', { enabled: false, priority: 'NORMAL', roles: ['ADMIN'], userIds: [], sendEmail: true, days: 15 }).expect(200);
    await evaluate();
    expect((await all('RESOLVED')).find((a) => a.code === 'CUSTOMER_OVERDUE')?.resolutionNote).toBe('Regla desactivada.');
    expect(await owner.auditLog.count({ where: { companyId: t.companyId, entity: 'alert_rule' } })).toBe(2);
  });

  it('las alertas nuevas llegan por correo en un resumen por destinatario', async () => {
    const before = await owner.emailOutbox.findMany({ where: { companyId: t.companyId }, orderBy: { createdAt: 'asc' } });
    expect(before.every((m) => m.status === 'SENT')).toBe(true);
    // La primera evaluación avisó al depósito (stock y pedido) en un solo correo.
    const warehouse = before.filter((m) => m.toEmail === t.users.WAREHOUSE);
    expect(warehouse[0]).toMatchObject({ subject: expect.stringMatching(/^2 alertas nuevas en /), kind: 'ALERT_DIGEST' });
    expect(warehouse[0]!.textBody).toContain('/stock/');

    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${t.users.WAREHOUSE}"`)}`);
    const found = (await res.json()) as { messages: { Subject: string; From: { Address: string } }[] };
    expect(found.messages.map((m) => m.Subject)).toContain(warehouse[0]!.subject);
    expect(found.messages[0]!.From.Address).toBe('alertas@ositos.local');
  });

  it('un correo que no se puede enviar se reintenta y, al quinto intento, avisa como error de integración', async () => {
    await owner.item.update({ where: { id: item }, data: { minStock: '50' } });
    process.env.SMTP_URL = 'smtp://localhost:1';
    try {
      for (let i = 0; i < 5; i++) await evaluate();
    } finally {
      process.env.SMTP_URL = SMTP_OK;
    }
    const failed = await owner.emailOutbox.findMany({ where: { companyId: t.companyId, status: { not: 'SENT' } } });
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((m) => m.status === 'FAILED' && m.attempts === 5 && !!m.lastError)).toBe(true);
    await evaluate();
    expect((await all()).find((a) => a.code === 'INTEGRATION_ERROR')).toMatchObject({ priority: 'HIGH', title: expect.stringMatching(/no se pudo enviar|no se pudieron enviar/) });
  });
});
