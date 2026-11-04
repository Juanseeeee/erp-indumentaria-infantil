import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let sales: Client;
let customer: string;
let other: string;
let priceList: string;
let ids: { body: string; hat: string; bodyA: string; bodyB: string; hatA: string; accessories: string; winter: string };
let today: string;

const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const promo = (over: Record<string, unknown>) => ({ discountPct: '10', minQty: '0', scope: 'ALL', targetIds: [], customerIds: [], priceListIds: [], validFrom: today, validTo: null, isActive: true, ...over });
const order = (lines: { itemId: string; qty: string; discountPct?: string }[], customerId = customer) => ({ customerId, warehouseId: t.whA, lines });
type Line = { itemId: string; discountPct: string; promotionName: string | null; promotionId?: string | null };
const discounts = (lines: Line[]) => lines.map((l) => [l.itemId === ids.hatA ? 'gorro' : 'body', l.discountPct, l.promotionName]);

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  sales = await login(app, t.users.SALES);
  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const accessories = await owner.category.create({ data: { companyId: t.companyId, kind: 'PRODUCT', name: 'Accesorios' } });
  const season = await owner.season.create({ data: { companyId: t.companyId, name: 'Invierno', year: 2026 } });
  const winter = await owner.collection.create({ data: { companyId: t.companyId, seasonId: season.id, name: 'Invierno 2026' } });
  const create = async (code: string, name: string) => {
    const id = (await admin.post('/catalog/products', { code, name, sizeScaleId: t.sizeScaleId, colorIds: [t.colors[0]], status: 'ACTIVE' }).expect(201)).body.id as string;
    const cells: { itemId: string; sizeId: string }[] = (await admin.get(`/catalog/products/${id}/matrix`).expect(200)).body.cells;
    return { id, a: cells.find((c) => c.sizeId === t.sizeIds[0])!.itemId, b: cells.find((c) => c.sizeId === t.sizeIds[1])!.itemId };
  };
  const body = await create('BODY', 'Body manga larga');
  const hat = await create('GORRO', 'Gorro con nudo');
  await owner.product.update({ where: { id: hat.id }, data: { categoryId: accessories.id, collectionId: winter.id } });
  ids = { body: body.id, hat: hat.id, bodyA: body.a, bodyB: body.b, hatA: hat.a, accessories: accessories.id, winter: winter.id };
  priceList = (await admin.post('/sales/price-lists', { name: 'Mayorista' }).expect(201)).body.id;
  await admin.post(`/sales/price-lists/${priceList}/prices`, { prices: [{ productId: body.id, price: '10000' }, { productId: hat.id, price: '5000' }] }).expect(201);
  const party = (name: string, taxId: string) =>
    admin.post('/parties', { legalName: name, taxIdType: 'CUIT', taxId, taxCondition: 'RI', roles: ['CUSTOMER'], customer: { priceListId: priceList, discountPct: '5' } }).expect(201);
  customer = (await party('Pañalera Promo SRL', '30700000016')).body.id;
  other = (await party('Bebés del Sur SA', '30711111111')).body.id;
});

afterAll(async () => {
  await app.close();
});

describe('promociones', () => {
  it('se crean con validación de alcance, nombre y permisos', async () => {
    await admin.post('/sales/promotions', promo({ name: '12 bodies', discountPct: '12', minQty: '12', scope: 'PRODUCTS', targetIds: [ids.body] })).expect(201);
    await admin.post('/sales/promotions', promo({ name: '12 bodies', scope: 'ALL' })).expect(409);
    await admin.post('/sales/promotions', promo({ name: 'Sin alcance', scope: 'PRODUCTS', targetIds: [] })).expect(400);
    await admin.post('/sales/promotions', promo({ name: 'Fechas al revés', validTo: day(-1) })).expect(400);
    await admin.post('/sales/promotions', promo({ name: 'Categoría falsa', scope: 'CATEGORIES', targetIds: [ids.body] })).expect(422);
    await sales.post('/sales/promotions', promo({ name: 'Del vendedor' })).expect(403);
    // Ventas las puede consultar (para explicarle el precio al cliente).
    expect((await sales.get('/sales/promotions').expect(200)).body.map((p: { name: string; status: string }) => [p.name, p.status])).toEqual([['12 bodies', 'ACTIVE']]);
  });

  it('por volumen: 12 bodies de cualquier talle; el resto lleva el descuento del cliente', async () => {
    const p = (await admin.post('/sales/orders/preview', order([{ itemId: ids.bodyA, qty: '6' }, { itemId: ids.bodyB, qty: '6' }, { itemId: ids.hatA, qty: '4' }])).expect(201)).body;
    expect(discounts(p.lines)).toEqual([['body', '12', '12 bodies'], ['body', '12', '12 bodies'], ['gorro', '5', null]]);
    // 12 × 10.000 × 0,88 + 4 × 5.000 × 0,95 = 105.600 + 19.000
    expect(p.netTotal).toBe('124600');
    const few = (await admin.post('/sales/orders/preview', order([{ itemId: ids.bodyA, qty: '6' }, { itemId: ids.bodyB, qty: '5' }])).expect(201)).body;
    expect(discounts(few.lines)).toEqual([['body', '5', null], ['body', '5', null]]);
  });

  it('el pedido guarda la promoción aplicada y el detalle la muestra', async () => {
    const o = (await sales.post('/sales/orders', order([{ itemId: ids.bodyA, qty: '12' }])).expect(201)).body;
    const d = (await sales.get(`/sales/orders/${o.id}`).expect(200)).body;
    expect(d.lines[0]).toMatchObject({ discountPct: '12', promotionName: '12 bodies', promotionId: expect.any(String) });
    expect(d.netTotal).toBe('105600');
  });

  it('una promoción mayor al tope del vendedor se aplica igual; un descuento manual no', async () => {
    await admin.post('/sales/promotions', promo({ name: 'Accesorios 20 %', discountPct: '20', scope: 'CATEGORIES', targetIds: [ids.accessories] })).expect(201);
    const o = (await sales.post('/sales/orders', order([{ itemId: ids.hatA, qty: '2' }])).expect(201)).body;
    expect((await sales.get(`/sales/orders/${o.id}`).expect(200)).body.lines[0]).toMatchObject({ discountPct: '20', promotionName: 'Accesorios 20 %' });
    await sales.post('/sales/orders', order([{ itemId: ids.hatA, qty: '2', discountPct: '20' }])).expect(403);
    // Un descuento manual (dentro del tope) reemplaza a la promoción.
    const manual = (await sales.post('/sales/orders/preview', order([{ itemId: ids.hatA, qty: '2', discountPct: '3' }])).expect(201)).body;
    expect(discounts(manual.lines)).toEqual([['gorro', '3', null]]);
  });

  it('respeta vigencia, cliente y lista de precios, y la mejor gana', async () => {
    await admin.post('/sales/promotions', promo({ name: 'Invierno 25 % desde mañana', discountPct: '25', scope: 'COLLECTIONS', targetIds: [ids.winter], validFrom: day(1) })).expect(201);
    await admin.post('/sales/promotions', promo({ name: 'Solo Bebés del Sur', discountPct: '30', customerIds: [other] })).expect(201);
    await admin.post('/sales/promotions', promo({ name: 'Otra lista', discountPct: '40', priceListIds: [crypto.randomUUID()] })).expect(422);

    const mine = (await admin.post('/sales/orders/preview', order([{ itemId: ids.hatA, qty: '1' }])).expect(201)).body;
    expect(discounts(mine.lines)).toEqual([['gorro', '20', 'Accesorios 20 %']]);
    const theirs = (await admin.post('/sales/orders/preview', order([{ itemId: ids.hatA, qty: '1' }], other)).expect(201)).body;
    expect(discounts(theirs.lines)).toEqual([['gorro', '30', 'Solo Bebés del Sur']]);

    const list = (await admin.get('/sales/promotions').expect(200)).body as { name: string; status: string; targets: string[]; customers: string[] }[];
    expect(list.find((p) => p.name === 'Invierno 25 % desde mañana')).toMatchObject({ status: 'SCHEDULED', targets: ['Invierno 2026'] });
    expect(list.find((p) => p.name === 'Solo Bebés del Sur')?.customers).toEqual(['Bebés del Sur SA']);
  });

  it('pausar o editar no cambia los pedidos ya armados; el listado muestra el uso', async () => {
    const list = (await admin.get('/sales/promotions').expect(200)).body as { id: string; name: string; usage: { orders: number; units: string; discount: string } }[];
    const bodies = list.find((p) => p.name === '12 bodies')!;
    // Un pedido de 12 bodies a 10.000 con 12 %: 14.400 de descuento otorgado.
    expect(bodies.usage).toEqual({ orders: 1, units: '12', discount: '14400.00' });
    await admin.put(`/sales/promotions/${bodies.id}`, promo({ name: '12 bodies', discountPct: '12', minQty: '12', scope: 'PRODUCTS', targetIds: [ids.body], isActive: false })).expect(200);
    const after = (await admin.post('/sales/orders/preview', order([{ itemId: ids.bodyA, qty: '12' }])).expect(201)).body;
    expect(discounts(after.lines)).toEqual([['body', '5', null]]);
    const again = (await admin.get('/sales/promotions').expect(200)).body as { name: string; status: string; usage: { orders: number } }[];
    expect(again.find((p) => p.name === '12 bodies')).toMatchObject({ status: 'PAUSED', usage: { orders: 1 } });
    expect(await owner.auditLog.count({ where: { companyId: t.companyId, entity: 'promotion' } })).toBe(5);
  });
});
