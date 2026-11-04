import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { assertReconciled, Client, createApp, createTenant, login, opening, owner, Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let sales: Client;
let deposito: Client;
let ids: {
  product: string;
  rnRosa: string;
  v03Rosa: string;
  v36Rosa: string;
  customer: string;
  priceList: string;
  seller: string;
};

const stockOf = async (itemId: string, warehouseId: string) => {
  const r = await owner.stockBalance.aggregate({ where: { itemId, warehouseId }, _sum: { onHand: true, reserved: true } });
  return { onHand: r._sum.onHand?.toString() ?? '0', reserved: r._sum.reserved?.toString() ?? '0' };
};
const entryOf = (docId: string) => owner.accountEntry.findFirstOrThrow({ where: { sourceDocId: docId } });
const commissionsTotal = async () => {
  const r = await owner.salesCommission.aggregate({ where: { companyId: t.companyId }, _sum: { amount: true } });
  return r._sum.amount?.toString() ?? '0';
};

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  sales = await login(app, t.users.SALES);
  deposito = await login(app, t.users.WAREHOUSE);
  await owner.branch.create({ data: { companyId: t.companyId, name: 'Central', arcaPointOfSale: 3 } });

  const ROSA = t.colors[1]!;
  const product = (
    await admin.post('/catalog/products', { code: 'BODY', name: 'Body', sizeScaleId: t.sizeScaleId, colorIds: [ROSA], status: 'ACTIVE' }).expect(201)
  ).body.id;
  const cells: { itemId: string; sizeId: string }[] = (await admin.get(`/catalog/products/${product}/matrix`).expect(200)).body.cells;
  const v = (i: number) => cells.find((c) => c.sizeId === t.sizeIds[i])!.itemId;
  await opening(admin, t.whA, [
    { itemId: v(0), qty: '20', unitCost: '3000' },
    { itemId: v(1), qty: '5', unitCost: '3200' },
  ]);

  const priceList = (await admin.post('/sales/price-lists', { name: 'Mayorista' }).expect(201)).body.id;
  await admin.post(`/sales/price-lists/${priceList}/prices`, { prices: [{ productId: product, price: '10000' }, { itemId: v(1), price: '11000' }] }).expect(201);

  const seller = (await owner.user.findUniqueOrThrow({ where: { email: t.users.SALES } })).id;
  await admin.put('/sales/reps', { userId: seller, commissionPct: '3' }).expect(200);
  const customer = (
    await admin
      .post('/parties', {
        legalName: 'Pañalera Test SRL',
        taxIdType: 'CUIT',
        taxId: '30700000016',
        taxCondition: 'RI',
        roles: ['CUSTOMER'],
        customer: { creditLimit: '400000', discountPct: '5', priceListId: priceList, sellerUserId: seller },
      })
      .expect(201)
  ).body.id;
  ids = { product, rnRosa: v(0), v03Rosa: v(1), v36Rosa: v(2), customer, priceList, seller };
});

afterAll(async () => {
  expect(await assertReconciled(t.companyId)).toEqual([]);
  // Cuenta corriente: el saldo abierto de cada movimiento = importe − imputaciones vigentes.
  const bad = await owner.$queryRaw<unknown[]>`
    WITH a AS (
      SELECT x.id, x.debit_entry_id, x.credit_entry_id, x.amount FROM account_allocations x
      WHERE x.company_id = ${t.companyId}::uuid AND x.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM account_allocations r WHERE r.reversal_of_id = x.id)
    )
    SELECT e.id FROM account_entries e
    WHERE e.company_id = ${t.companyId}::uuid AND e.open_amount <> e.amount
      - COALESCE((SELECT SUM(amount) FROM a WHERE a.debit_entry_id = e.id), 0)
      + COALESCE((SELECT SUM(amount) FROM a WHERE a.credit_entry_id = e.id), 0)`;
  expect(bad).toEqual([]);
  await app.close();
});

describe('Flujo B: pedido → reserva → remitos → factura → cobros → nota de crédito → comisiones', () => {
  let orderId: string;
  let invoiceId: string;
  let deliveries: string[] = [];

  it('el vendedor carga el pedido con la lista y el descuento del cliente', async () => {
    const ctx = (await sales.get(`/sales/customers/${ids.customer}/context`).expect(200)).body;
    expect(ctx.priceList.name).toBe('Mayorista');
    expect(ctx.discountPct).toBe('5');
    const o = (
      await sales
        .post('/sales/orders', {
          customerId: ids.customer,
          warehouseId: t.whA,
          lines: [
            { itemId: ids.rnRosa, qty: '10' },
            { itemId: ids.v03Rosa, qty: '8' },
          ],
        })
        .expect(201)
    ).body;
    orderId = o.id;
    // 10 × 10.000 × 0,95 + 8 × 11.000 (precio de variante) × 0,95 = 178.600 + IVA 21 %
    expect(o.netTotal).toBe('178600');
    expect(o.total).toBe('216106');
    expect(o.sellerUserId).toBe(ids.seller);
  });

  it('el vendedor no puede cambiar precios ni superar el descuento máximo', async () => {
    await sales.post('/sales/orders', { customerId: ids.customer, warehouseId: t.whA, lines: [{ itemId: ids.rnRosa, qty: '1', unitPrice: '1' }] }).expect(403);
    await sales.post('/sales/orders', { customerId: ids.customer, warehouseId: t.whA, lines: [{ itemId: ids.rnRosa, qty: '1', discountPct: '40' }] }).expect(403);
    // Depósito no carga pedidos.
    await deposito.post('/sales/orders', { customerId: ids.customer, warehouseId: t.whA, lines: [{ itemId: ids.rnRosa, qty: '1' }] }).expect(403);
  });

  it('al confirmar reserva lo disponible y deja pendiente el faltante', async () => {
    const o = (await sales.post(`/sales/orders/${orderId}/confirm`, {}).expect(201)).body;
    expect(o.status).toBe('CONFIRMED');
    expect(o.shortages).toEqual([{ itemId: ids.v03Rosa, missing: '3' }]);
    expect((await stockOf(ids.rnRosa, t.whA)).reserved).toBe('10');
    expect((await stockOf(ids.v03Rosa, t.whA)).reserved).toBe('5');
  });

  it('un pedido que excede el crédito necesita autorización con motivo', async () => {
    const o = (await sales.post('/sales/orders', { customerId: ids.customer, warehouseId: t.whA, lines: [{ itemId: ids.v36Rosa, qty: '30' }] }).expect(201)).body;
    const denied = await sales.post(`/sales/orders/${o.id}/confirm`, {}).expect(409);
    expect(denied.body.code).toBe('REQUIERE_APROBACION');
    expect(denied.body.details.excess).toBe('160956.00'); // 216.106 + 344.850 − 400.000
    await admin.post(`/sales/orders/${o.id}/confirm`, {}).expect(409);
    const ok = (await admin.post(`/sales/orders/${o.id}/confirm`, { creditOverrideNote: 'Cliente histórico, paga con cheques al día' }).expect(201)).body;
    expect(ok.creditApprover).toBeTruthy();
    await admin.post(`/sales/orders/${o.id}/cancel`, { reason: 'Prueba de crédito' }).expect(201);
  });

  it('depósito emite un remito parcial que consume la reserva', async () => {
    const o = (await deposito.get(`/sales/orders/${orderId}`).expect(200)).body;
    const line = (itemId: string) => o.lines.find((l: { itemId: string }) => l.itemId === itemId).id;
    await deposito.post('/sales/deliveries', { orderId, lines: [{ orderLineId: line(ids.rnRosa), qty: '11' }] }).expect(422);
    const d = (
      await deposito
        .post('/sales/deliveries', { orderId, packages: 2, lines: [{ orderLineId: line(ids.rnRosa), qty: '6' }, { orderLineId: line(ids.v03Rosa), qty: '5' }] })
        .expect(201)
    ).body;
    deliveries.push(d.id);
    expect(await stockOf(ids.rnRosa, t.whA)).toEqual({ onHand: '14', reserved: '4' });
    expect(await stockOf(ids.v03Rosa, t.whA)).toEqual({ onHand: '0', reserved: '0' });
    const moves = await owner.stockMovement.findMany({ where: { sourceDocId: d.id } });
    expect(moves.map((m) => m.type)).toEqual(['SALE_DELIVERY', 'SALE_DELIVERY']);
    expect((await deposito.get(`/sales/orders/${orderId}`).expect(200)).body.status).toBe('PARTIALLY_DELIVERED');
  });

  it('al entrar mercadería se reservan los pendientes y sale el segundo remito', async () => {
    await opening(admin, t.whA, [{ itemId: ids.v03Rosa, qty: '10', unitCost: '3300' }]);
    const o = (await sales.post(`/sales/orders/${orderId}/reserve`).expect(201)).body;
    expect(o.shortages).toEqual([]);
    expect((await stockOf(ids.v03Rosa, t.whA)).reserved).toBe('3');
    const line = (itemId: string) => o.lines.find((l: { itemId: string }) => l.itemId === itemId).id;
    const d = (await deposito.post('/sales/deliveries', { orderId, lines: [{ orderLineId: line(ids.rnRosa), qty: '4' }, { orderLineId: line(ids.v03Rosa), qty: '3' }] }).expect(201)).body;
    deliveries.push(d.id);
    expect((await sales.get(`/sales/orders/${orderId}`).expect(200)).body.status).toBe('DELIVERED');
    expect(await stockOf(ids.rnRosa, t.whA)).toEqual({ onHand: '10', reserved: '0' });
  });

  it('el vendedor no factura; administración agrupa los dos remitos en una factura A con CAE', async () => {
    await sales.post('/sales/invoices', { customerId: ids.customer, deliveryIds: deliveries }).expect(403);
    const inv = (await admin.post('/sales/invoices', { customerId: ids.customer, deliveryIds: deliveries }).expect(201)).body;
    invoiceId = inv.id;
    expect(inv.status).toBe('POSTED');
    expect(inv.docType).toBe('FA');
    expect(inv.pointOfSale).toBe(3);
    expect(inv.number).toBe(1);
    expect(inv.cae).toMatch(/^\d{14}$/);
    expect(inv.arcaMode).toBe('SIMULATED');
    expect(inv.netTotal).toBe('178600');
    expect(inv.total).toBe('216106');
    expect(inv.commissionPct).toBe('3');
    expect((await entryOf(invoiceId)).amount.toString()).toBe('216106');
    // Un remito facturado no se vuelve a facturar ni se anula.
    await admin.post('/sales/invoices', { customerId: ids.customer, deliveryIds: [deliveries[0]] }).expect(409);
    await deposito.post(`/sales/deliveries/${deliveries[0]}/void`, { reason: 'error de carga' }).expect(422);
  });

  it('cobro parcial: imputa y devenga la comisión sobre el neto cobrado', async () => {
    const r = (
      await admin
        .post('/sales/receipts', {
          customerId: ids.customer,
          payments: [{ method: 'TRANSFER', amount: '108053', reference: 'TRF 991' }],
          allocations: [{ entryId: (await entryOf(invoiceId)).id, amount: '108053' }],
        })
        .expect(201)
    ).body;
    expect(r.unapplied).toBe('0');
    expect((await entryOf(invoiceId)).openAmount.toString()).toBe('108053');
    // 108.053 / 1,21 = 89.300 de neto cobrado × 3 % = 2.679
    expect(await commissionsTotal()).toBe('2679');
  });

  it('nota de crédito por devolución: reingresa al costo de salida y se aplica a la factura', async () => {
    const inv = (await admin.get(`/sales/documents/${invoiceId}`).expect(200)).body;
    const rnLine = inv.lines.find((l: { itemId: string; qty: string }) => l.itemId === ids.rnRosa && l.qty === '6');
    await admin.post('/sales/credit-notes', { invoiceId, reason: 'Devolución por falla', returnWarehouseId: t.whA, lines: [{ invoiceLineId: rnLine.id, qty: '7' }] }).expect(422);
    const nc = (await admin.post('/sales/credit-notes', { invoiceId, reason: 'Devolución por falla', returnWarehouseId: t.whA, lines: [{ invoiceLineId: rnLine.id, qty: '2' }] }).expect(201)).body;
    expect(nc.docType).toBe('NCA');
    expect(nc.total).toBe('22990');
    expect(nc.related.id).toBe(invoiceId);
    const back = await owner.stockMovement.findMany({ where: { sourceDocId: nc.id } });
    expect(back.map((m) => [m.type, m.qty.toString(), m.unitCost.toString()])).toEqual([['SALE_RETURN', '2', '3000']]);
    expect((await entryOf(invoiceId)).openAmount.toString()).toBe('85063');
    expect((await entryOf(nc.id)).openAmount.toString()).toBe('0');
    // La NC no genera comisión: no es un cobro.
    expect(await commissionsTotal()).toBe('2679');
  });

  it('cobro final con cheque: saldo cero; el mismo cheque no se carga dos veces', async () => {
    const cheque = { method: 'CHEQUE', amount: '85063', reference: '00012345', bank: 'Banco Nación', dueDate: '2026-12-15' };
    const r = (await admin.post('/sales/receipts', { customerId: ids.customer, payments: [cheque], allocations: [{ entryId: (await entryOf(invoiceId)).id, amount: '85063' }] }).expect(201)).body;
    expect((await entryOf(invoiceId)).openAmount.toString()).toBe('0');
    expect(await commissionsTotal()).toBe('4788'); // + 85.063 / 1,21 × 3 % = 2.109
    await admin.post('/sales/receipts', { customerId: ids.customer, payments: [cheque] }).expect(409);
    const ledger = (await admin.get(`/accounts/${ids.customer}?tipo=RECEIVABLE`).expect(200)).body;
    expect(ledger.balance).toBe('0.00');

    // Imputación equivocada: se revierte. La factura vuelve a quedar pendiente, el cobro queda como
    // saldo a favor (el saldo total no cambia) y la comisión se descuenta.
    const alloc = r.allocations[0].id;
    await sales.post(`/accounts/allocations/${alloc}/reverse`, { reason: 'Cheque rechazado' }).expect(403);
    await admin.post(`/accounts/allocations/${alloc}/reverse`, { reason: 'Cheque rechazado' }).expect(201);
    await admin.post(`/accounts/allocations/${alloc}/reverse`, { reason: 'otra vez' }).expect(422);
    expect((await entryOf(invoiceId)).openAmount.toString()).toBe('85063');
    expect(await commissionsTotal()).toBe('2679');
    const after = (await admin.get(`/accounts/${ids.customer}?tipo=RECEIVABLE`).expect(200)).body;
    expect(after.balance).toBe('0.00');
    expect(after.unappliedCredits).toBe('85063.00');
  });

  it('liquidación de comisiones del vendedor', async () => {
    const mine = (await sales.get('/sales/commissions/mine').expect(200)).body;
    expect(mine.summary[0].pending).toBe('2679');
    await sales.post('/sales/commissions/settle', { sellerUserId: ids.seller, periodTo: '2099-12-31' }).expect(403);
    const s = (await admin.post('/sales/commissions/settle', { sellerUserId: ids.seller, periodTo: '2099-12-31' }).expect(201)).body;
    expect(s.total).toBe('2679');
    await admin.post('/sales/commissions/settle', { sellerUserId: ids.seller, periodTo: '2099-12-31' }).expect(422);
  });

  it('anular un recibo revierte sus imputaciones', async () => {
    const r = (await admin.post('/sales/receipts', { customerId: ids.customer, payments: [{ method: 'CASH', amount: '100000' }], allocations: [{ entryId: (await entryOf(invoiceId)).id, amount: '85063' }] }).expect(201)).body;
    expect(r.unapplied).toBe('14937');
    expect((await entryOf(invoiceId)).openAmount.toString()).toBe('0');
    await admin.post(`/sales/receipts/${r.id}/void`, { reason: 'Se cargó en el cliente equivocado' }).expect(201);
    expect((await entryOf(invoiceId)).openAmount.toString()).toBe('85063');
    const ledger = (await admin.get(`/accounts/${ids.customer}?tipo=RECEIVABLE`).expect(200)).body;
    expect(ledger.balance).toBe('0.00');
    expect(ledger.unappliedCredits).toBe('85063.00');
    // La comisión de ese cobro se devengó y se revirtió: neto cero.
    expect(await commissionsTotal()).toBe('2679');
  });

  it('nota de débito sobre la factura', async () => {
    const nd = (await admin.post('/sales/debit-notes', { invoiceId, reason: 'Intereses por mora', concepts: [{ description: 'Intereses', net: '1000', vatRate: '21' }] }).expect(201)).body;
    expect(nd.docType).toBe('NDA');
    expect(nd.number).toBe(1);
    expect((await entryOf(nd.id)).amount.toString()).toBe('1210');
  });
});

describe('ARCA y concurrencia', () => {
  const newDelivery = async (qty = '1') => {
    const o = (await admin.post('/sales/orders', { customerId: ids.customer, warehouseId: t.whA, lines: [{ itemId: ids.rnRosa, qty }] }).expect(201)).body;
    const c = (await admin.post(`/sales/orders/${o.id}/confirm`, { creditOverrideNote: 'prueba' }).expect(201)).body;
    return (await admin.post('/sales/deliveries', { orderId: o.id, lines: [{ orderLineId: c.lines[0].id, qty }] }).expect(201)).body.id as string;
  };

  it('un rechazo de ARCA no consume número y libera el remito', async () => {
    const d = await newDelivery();
    await owner.setting.create({ data: { companyId: t.companyId, key: 'arca.simulateRejection', value: true } });
    const rejected = (await admin.post('/sales/invoices', { customerId: ids.customer, deliveryIds: [d] }).expect(201)).body;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.number).toBeNull();
    expect(await owner.accountEntry.count({ where: { sourceDocId: rejected.id } })).toBe(0);
    expect((await owner.deliveryNote.findUniqueOrThrow({ where: { id: d } })).invoiceId).toBeNull();
    await owner.setting.delete({ where: { companyId_key: { companyId: t.companyId, key: 'arca.simulateRejection' } } });
    const ok = (await admin.post('/sales/invoices', { customerId: ids.customer, deliveryIds: [d] }).expect(201)).body;
    expect(ok.number).toBe(2); // correlativo, sin huecos
  });

  it('dos facturas simultáneas del mismo remito: una sola prospera', async () => {
    const d = await newDelivery();
    const [a, b] = await Promise.all([
      admin.post('/sales/invoices', { customerId: ids.customer, deliveryIds: [d] }),
      admin.post('/sales/invoices', { customerId: ids.customer, deliveryIds: [d] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('facturas concurrentes de distintos remitos reciben números distintos y correlativos', async () => {
    const ds = await Promise.all([newDelivery(), newDelivery()]);
    const res = await Promise.all(ds.map((d) => admin.post('/sales/invoices', { customerId: ids.customer, deliveryIds: [d] }).expect(201)));
    const numbers = res.map((r) => r.body.number).sort();
    expect(numbers).toEqual([4, 5]);
  });

  it('anular un remito sin facturar devuelve el stock y deja el pedido pendiente', async () => {
    const before = await stockOf(ids.rnRosa, t.whA);
    const d = await newDelivery('2');
    expect(Number((await stockOf(ids.rnRosa, t.whA)).onHand)).toBe(Number(before.onHand) - 2);
    const v = (await deposito.post(`/sales/deliveries/${d}/void`, { reason: 'No salió el flete' }).expect(201)).body;
    expect(v.status).toBe('VOIDED');
    expect((await stockOf(ids.rnRosa, t.whA)).onHand).toBe(before.onHand);
    const order = await owner.salesOrder.findFirstOrThrow({ where: { id: v.order.id } });
    expect(order.status).toBe('CONFIRMED');
  });
});

describe('Listas de precios', () => {
  it('actualización masiva con redondeo, historial y lista derivada', async () => {
    const r = (await admin.post(`/sales/price-lists/${ids.priceList}/bulk`, { pct: '8', roundTo: '100' }).expect(201)).body;
    expect(r.count).toBe(2);
    const prices = (await admin.get(`/sales/price-lists/${ids.priceList}/prices`).expect(200)).body;
    const body = prices.rows.find((p: { productId: string }) => p.productId === ids.product);
    expect(body.price).toBe('10800');
    expect(body.variants[0].price).toBe('11900'); // 11.000 × 1,08 = 11.880 → 11.900
    const history = (await admin.get(`/sales/price-lists/${ids.priceList}/history/${ids.product}`).expect(200)).body;
    expect(history).toHaveLength(4);

    const minorista = (await admin.post('/sales/price-lists', { name: 'Minorista', kind: 'RETAIL', includesVat: true, baseListId: ids.priceList, markupPct: '60' }).expect(201)).body;
    const p = (await sales.get(`/sales/price-lists/${minorista.id}/products/${ids.product}`).expect(200)).body;
    expect(p[ids.rnRosa]).toEqual({ price: '17280', includesVat: true, source: 'PRODUCT' });
    await admin.post(`/sales/price-lists/${minorista.id}/prices`, { prices: [{ productId: ids.product, price: '1' }] }).expect(422);
    await sales.post(`/sales/price-lists/${ids.priceList}/bulk`, { pct: '5' }).expect(403);
  });
});
