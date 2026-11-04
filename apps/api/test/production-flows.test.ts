import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { assertReconciled, Client, createApp, createMaterial, createTenant, login, opening, owner, Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let ids: {
  telaRosa: string;
  telaBlanca: string;
  broche: string;
  product: string;
  variants: { itemId: string; sizeId: string; colorId: string; sku: string }[];
  supplier: string;
  workshop: string;
  stages: Record<string, string>;
  whSeconds: string;
};

const ROSA = () => t.colors[1]!;
const BLANCO = () => t.colors[0]!;
const variant = (sizeIdx: number, colorId: string) => ids.variants.find((v) => v.sizeId === t.sizeIds[sizeIdx] && v.colorId === colorId)!.itemId;
const stockOf = async (itemId: string, warehouseId: string) => {
  const r = await owner.stockBalance.aggregate({ where: { itemId, warehouseId }, _sum: { onHand: true, reserved: true } });
  return { onHand: r._sum.onHand?.toString() ?? '0', reserved: r._sum.reserved?.toString() ?? '0' };
};

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);

  const telaRosa = await createMaterial(admin, t, 'TELA-ROSA', { trackLots: true });
  const telaBlanca = await createMaterial(admin, t, 'TELA-BLANCA', { trackLots: true });
  const broche = (await admin.post('/materials', { sku: 'BROCHE', name: 'Broche', baseUomId: t.uomUn }).expect(201)).body.itemId;
  const product = (
    await admin.post('/catalog/products', { code: 'BODY', name: 'Body', sizeScaleId: t.sizeScaleId, colorIds: [BLANCO(), ROSA()], status: 'ACTIVE' }).expect(201)
  ).body.id;
  const matrix = (await admin.get(`/catalog/products/${product}/matrix`).expect(200)).body;
  const supplier = (await admin.post('/parties', { legalName: 'Textil SA', taxIdType: 'CUIT', taxId: '30700000083', taxCondition: 'RI', roles: ['SUPPLIER'] }).expect(201)).body.id;
  const workshop = (
    await admin.post('/parties', { legalName: 'Taller Rosa', taxIdType: 'CUIT', taxId: '27300000113', taxCondition: 'MONOTRIBUTO', roles: ['WORKSHOP'] }).expect(201)
  ).body.id;
  const stages: Record<string, string> = {};
  for (const [code, name, sortOrder, isExternal] of [['CORTE', 'Corte', 1, false], ['CONF', 'Confección', 2, true], ['TERM', 'Terminación', 3, false]] as const) {
    stages[code] = (await admin.put('/production/config/stages', { code, name, sortOrder, isExternal }).expect(200)).body.id;
  }
  const whSeconds = (await owner.warehouse.create({ data: { companyId: t.companyId, code: 'SEG', name: 'Segunda', type: 'QUARANTINE' } })).id;
  ids = { telaRosa, telaBlanca, broche, product, variants: matrix.cells, supplier, workshop, stages, whSeconds };

  // Ficha v1: tela según color (0,5 m; RN 0,4 m) con 10 % de merma + 3 broches.
  await admin
    .put(`/production/tech-sheets/${product}/draft`, {
      stageIds: [stages.CORTE, stages.CONF, stages.TERM],
      materials: [
        { byGarmentColor: true, colorMap: { [ROSA()]: telaRosa, [BLANCO()]: telaBlanca }, qtyPerUnit: '0.5', sizeQty: { [t.sizeIds[0]!]: '0.4' }, wastePct: '10' },
        { materialItemId: broche, qtyPerUnit: '3' },
      ],
    })
    .expect(200);
  await admin.post(`/production/tech-sheets/${product}/activate`).expect(201);
});

afterAll(async () => {
  expect(await assertReconciled(t.companyId)).toEqual([]);
  await app.close();
});

const newOrder = async (lines: { variantItemId: string; qty: string }[], extra: object = {}) =>
  (
    await admin
      .post('/production/orders', { productId: ids.product, materialsWarehouseId: t.whA, outputWarehouseId: t.whB, secondsWarehouseId: ids.whSeconds, lines, ...extra })
      .expect(201)
  ).body.id as string;

describe('Flujo A: falta tela → compra → recepción → factura → producción → costo real', () => {
  it('circuito completo', async () => {
    // 1. OP de 10 bodies RN rosa + 10 3-6 blanco, sin tela en stock.
    const op = await newOrder([
      { variantItemId: variant(0, ROSA()), qty: '10' },
      { variantItemId: variant(2, BLANCO()), qty: '10' },
    ]);
    const rel = await admin.post(`/production/orders/${op}/release`).expect(201);
    // rosa: 10 × 0,4 × 1,1 = 4,4 m; blanca: 10 × 0,5 × 1,1 = 5,5 m; broches 60.
    const short = Object.fromEntries(rel.body.shortages.map((s: { materialItemId: string; shortage: string }) => [s.materialItemId, s.shortage]));
    expect(short[ids.telaRosa]).toBe('4.4');
    expect(short[ids.telaBlanca]).toBe('5.5');
    expect(short[ids.broche]).toBe('60');

    // 2. Solicitud de compra con los faltantes.
    const req = await admin.post(`/production/orders/${op}/purchase-request`).expect(201);
    expect(req.body.origin).toBe('PRODUCTION');
    expect(req.body.lines).toHaveLength(3);

    // 3. Orden de compra (desde la solicitud).
    const po = await admin
      .post('/purchasing/orders', {
        supplierId: ids.supplier,
        warehouseId: t.whA,
        requestLineIds: req.body.lines.map((l: { id: string }) => l.id),
        lines: [
          { itemId: ids.telaRosa, qty: '10', unitPrice: '5000', vatRate: '21' },
          { itemId: ids.telaBlanca, qty: '10', unitPrice: '4800', vatRate: '21' },
          { itemId: ids.broche, qty: '100', unitPrice: '20', vatRate: '21' },
        ],
      })
      .expect(201);
    expect(po.body.status).toBe('APPROVED');
    const pol = (itemId: string) => po.body.lines.find((l: { itemId: string }) => l.itemId === itemId).id;

    // Una OC no mueve stock.
    expect((await stockOf(ids.telaRosa, t.whA)).onHand).toBe('0');

    // 4. Recepción parcial y luego total, con partida en telas.
    const r1 = await admin
      .post('/purchasing/receipts', {
        supplierId: ids.supplier, warehouseId: t.whA, purchaseOrderId: po.body.id, supplierDeliveryNote: 'R-0001-123',
        lines: [{ poLineId: pol(ids.telaRosa), itemId: ids.telaRosa, qty: '10', lotCode: 'P-77' }],
      })
      .expect(201);
    expect((await owner.purchaseOrder.findUniqueOrThrow({ where: { id: po.body.id } })).status).toBe('PARTIALLY_RECEIVED');
    const sinPartida = await admin.post('/purchasing/receipts', {
      supplierId: ids.supplier, warehouseId: t.whA, purchaseOrderId: po.body.id,
      lines: [{ poLineId: pol(ids.telaBlanca), itemId: ids.telaBlanca, qty: '10' }],
    });
    expect(sinPartida.status).toBe(422);
    const r2 = await admin
      .post('/purchasing/receipts', {
        supplierId: ids.supplier, warehouseId: t.whA, purchaseOrderId: po.body.id,
        lines: [
          { poLineId: pol(ids.telaBlanca), itemId: ids.telaBlanca, qty: '10', lotCode: 'P-78' },
          { poLineId: pol(ids.broche), itemId: ids.broche, qty: '100' },
        ],
      })
      .expect(201);
    expect((await owner.purchaseOrder.findUniqueOrThrow({ where: { id: po.body.id } })).status).toBe('RECEIVED');
    expect((await stockOf(ids.telaRosa, t.whA)).onHand).toBe('10');

    // 5. Factura del proveedor → deuda. Precio de la tela blanca 10 % más caro → advertencia.
    const inv = await admin
      .post('/purchasing/invoices', {
        supplierId: ids.supplier, docType: 'FA', pointOfSale: 3, number: 4521, issueDate: '2026-10-20',
        otherTaxes: '1500',
        lines: [
          { receiptLineId: r1.body.lines[0].id, itemId: ids.telaRosa, description: 'Tela rosa', qty: '10', unitPrice: '5000', vatRate: '21' },
          { receiptLineId: r2.body.lines[0].id, itemId: ids.telaBlanca, description: 'Tela blanca', qty: '10', unitPrice: '5280', vatRate: '21' },
          { receiptLineId: r2.body.lines[1].id, itemId: ids.broche, description: 'Broches', qty: '100', unitPrice: '20', vatRate: '21' },
        ],
      })
      .expect(201);
    expect(inv.body.total).toBe('128308'); // neto 104.800 + IVA 22.008 + percepción 1.500
    expect(inv.body.warnings.join(' ')).toMatch(/Tela blanca: precio \+10 %/);
    const dup = await admin.post('/purchasing/invoices', {
      supplierId: ids.supplier, docType: 'FA', pointOfSale: 3, number: 4521, issueDate: '2026-10-20',
      lines: [{ description: 'x', qty: '1', unitPrice: '1', vatRate: '21' }],
    });
    expect(dup.status).toBe(409);
    const ledger = await admin.get(`/accounts/${ids.supplier}?tipo=PAYABLE`).expect(200);
    expect(ledger.body.balance).toBe('128308.00');

    // 6. Entrega de materiales a corte propio (consumo mayor al previsto en tela rosa: 5 m vs 4,4).
    await admin
      .post(`/production/orders/${op}/issue`, {
        lines: [
          { materialItemId: ids.telaRosa, qty: '5' },
          { materialItemId: ids.telaBlanca, qty: '5.5' },
          { materialItemId: ids.broche, qty: '60' },
        ],
      })
      .expect(201);
    expect((await stockOf(ids.telaRosa, t.whA)).onHand).toBe('5');

    // 7. Avance de corte y 8. ingreso con control de calidad (9 aprobadas + 1 descarte en RN rosa).
    await admin.post(`/production/orders/${op}/report`, { stageId: ids.stages.CORTE, qtyGood: '20', finishStage: true }).expect(201);
    await admin
      .post(`/production/orders/${op}/output`, {
        lines: [
          { variantItemId: variant(0, ROSA()), approvedQty: '9', scrapQty: '1' },
          { variantItemId: variant(2, BLANCO()), approvedQty: '10' },
        ],
      })
      .expect(201);
    expect((await stockOf(variant(0, ROSA()), t.whB)).onHand).toBe('9');
    const detail = await admin.get(`/production/orders/${op}`).expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    const rosa = detail.body.requirements.find((r: { materialItemId: string }) => r.materialItemId === ids.telaRosa);
    expect(rosa.deviation).toBe('0.6'); // consumo mayor al previsto queda visible

    // 9. Cierre: costo real = materiales consumidos / unidades buenas.
    const closed = await admin.post(`/production/orders/${op}/close`).expect(201);
    // 5 × 5000 + 5,5 × 4800 + 60 × 20 = 25.000 + 26.400 + 1.200 = 52.600 / 19 unidades
    expect(closed.body.cost.materials).toBe('52600');
    expect(closed.body.cost.unitCost).toBe('2768.421053');
    expect((await owner.stockReservation.count({ where: { sourceDocId: op, status: 'ACTIVE' } }))).toBe(0);
  });
});

describe('Flujo D: taller externo con tarifa por prenda', () => {
  it('envío, recepción con QC, devolución de sobrante, cierre y liquidación', async () => {
    await opening(admin, t.whA, [
      { itemId: ids.telaRosa, qty: '50', unitCost: '5000' },
      { itemId: ids.broche, qty: '500', unitCost: '20' },
    ]);
    await admin.post('/production/config/workshop-rates', { workshopId: ids.workshop, productId: ids.product, price: '1800', validFrom: '2026-01-01' }).expect(201);
    const v = variant(2, ROSA());
    const op = await newOrder([{ variantItemId: v, qty: '20' }]);
    await admin.post(`/production/orders/${op}/release`).expect(201);
    // Reservó 11 m (20 × 0,5 × 1,1) y 60 broches.
    expect((await stockOf(ids.telaRosa, t.whA)).reserved).toBe('11');

    // Envío al taller: 20 prendas + 12 m de tela (1 m de más) + 60 broches.
    const d = await admin
      .post(`/production/orders/${op}/dispatch`, {
        workshopId: ids.workshop,
        garments: [{ variantItemId: v, qty: '20' }],
        materials: [{ materialItemId: ids.telaRosa, qty: '12' }, { materialItemId: ids.broche, qty: '60' }],
      })
      .expect(201);
    const wsWh = (await owner.warehouse.findUniqueOrThrow({ where: { partyId: ids.workshop } })).id;
    expect((await stockOf(ids.telaRosa, wsWh)).onHand).toBe('12');
    expect((await stockOf(ids.telaRosa, t.whA)).reserved).toBe('0');

    // No se puede recibir más de lo enviado.
    const over = await admin.post(`/production/orders/${op}/output`, { dispatchId: d.body.id, lines: [{ variantItemId: v, approvedQty: '21' }] });
    expect(over.status).toBe(422);

    // Recepción: 18 aprobadas, 1 segunda, 1 descarte → consume 11 m y 60 broches del depósito del taller.
    const out = await admin
      .post(`/production/orders/${op}/output`, { dispatchId: d.body.id, lines: [{ variantItemId: v, approvedQty: '18', secondQty: '1', scrapQty: '1' }] })
      .expect(201);
    expect(out.body.warnings).toEqual([]);
    expect((await stockOf(v, t.whB)).onHand).toBe('18');
    expect((await stockOf(v, ids.whSeconds)).onHand).toBe('1');
    expect((await stockOf(ids.telaRosa, wsWh)).onHand).toBe('1');

    // No se puede cerrar con material en el taller.
    const blocked = await admin.post(`/production/orders/${op}/close`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toMatch(/en poder de talleres/);
    await admin.post(`/production/orders/${op}/return`, { workshopId: ids.workshop, lines: [{ materialItemId: ids.telaRosa, qty: '1' }] }).expect(201);
    const closed = await admin.post(`/production/orders/${op}/close`).expect(201);
    // Materiales 11 × 5000 + 60 × 20 = 56.200; taller 19 × 1.800 = 34.200 (el descarte no se paga).
    expect(closed.body.cost.materials).toBe('56200');
    expect(closed.body.cost.workshop).toBe('34200');

    // Liquidación: 19 prendas × 1.800 − descuento por la prenda descartada.
    const pending = await admin.get(`/production/settlements/pending?workshopId=${ids.workshop}`).expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].amount).toBe('34200.00');
    const settle = await admin
      .post('/production/settlements', {
        workshopId: ids.workshop, outputIds: [out.body.id], issueDate: '2026-10-28',
        deductions: [{ description: 'Prenda descartada por falla de costura', amount: '1800' }],
        invoice: { docType: 'FC', pointOfSale: 2, number: 77, vatRate: '0' },
      })
      .expect(201);
    expect(settle.body.total).toBe('32400');
    const again = await admin.post('/production/settlements', { workshopId: ids.workshop, outputIds: [out.body.id], issueDate: '2026-10-28' });
    expect(again.status).toBe(409);
    const ledger = await admin.get(`/accounts/${ids.workshop}?tipo=PAYABLE`).expect(200);
    expect(ledger.body.balance).toBe('32400.00');
  });
});

describe('casos borde de producción', () => {
  it('orden cancelada con materiales en el taller: exige devolución o faltante antes de cancelar', async () => {
    await opening(admin, t.whA, [{ itemId: ids.telaBlanca, qty: '20', unitCost: '4800' }]);
    const op = await newOrder([{ variantItemId: variant(1, BLANCO()), qty: '10' }]);
    await admin.post(`/production/orders/${op}/release`).expect(201);
    await admin
      .post(`/production/orders/${op}/dispatch`, { workshopId: ids.workshop, garments: [{ variantItemId: variant(1, BLANCO()), qty: '10' }], materials: [{ materialItemId: ids.telaBlanca, qty: '5.5' }] })
      .expect(201);
    const blocked = await admin.post(`/production/orders/${op}/cancel`, { reason: 'El cliente canceló el pedido' });
    expect(blocked.status).toBe(422);
    // El taller perdió 0,5 m: se registra como faltante; el resto vuelve.
    await admin.post(`/production/orders/${op}/workshop-write-off`, { workshopId: ids.workshop, lines: [{ materialItemId: ids.telaBlanca, qty: '0.5' }], reason: 'Corte mal hecho' }).expect(201);
    await admin.post(`/production/orders/${op}/return`, { workshopId: ids.workshop, lines: [{ materialItemId: ids.telaBlanca, qty: '5' }] }).expect(201);
    const c = await admin.post(`/production/orders/${op}/cancel`, { reason: 'El cliente canceló el pedido' }).expect(201);
    expect(c.body.materialsConsumed).toBe(true);
    expect((await owner.stockReservation.count({ where: { sourceDocId: op, status: 'ACTIVE' } }))).toBe(0);
    const again = await admin.post(`/production/orders/${op}/release`);
    expect(again.status).toBe(422);
  });

  it('cambiar la ficha técnica no altera una orden ya liberada', async () => {
    const op = await newOrder([{ variantItemId: variant(3, ROSA()), qty: '2' }]);
    await admin.post(`/production/orders/${op}/release`).expect(201);
    const before = await admin.get(`/production/orders/${op}`).expect(200);
    await admin
      .put(`/production/tech-sheets/${ids.product}/draft`, {
        materials: [
          { byGarmentColor: true, colorMap: { [ROSA()]: ids.telaRosa, [BLANCO()]: ids.telaBlanca }, qtyPerUnit: '0.9', wastePct: '10' },
          { materialItemId: ids.broche, qtyPerUnit: '5' },
        ],
      })
      .expect(200);
    await admin.post(`/production/tech-sheets/${ids.product}/activate`).expect(201);
    const after = await admin.get(`/production/orders/${op}`).expect(200);
    expect(after.body.techSheetVersionNo).toBe(1);
    expect(after.body.requirements.map((r: { requiredQty: string }) => r.requiredQty)).toEqual(before.body.requirements.map((r: { requiredQty: string }) => r.requiredQty));
    const sheet = await admin.get(`/production/tech-sheets/${ids.product}`).expect(200);
    expect(sheet.body.sheet.versions.map((v: { status: string }) => v.status)).toEqual(['ACTIVE', 'ARCHIVED']);
  });

  it('no se puede liberar sin ficha activa ni con un color sin material', async () => {
    const other = (await admin.post('/catalog/products', { code: 'MANTA', name: 'Manta', sizeScaleId: t.sizeScaleId, colorIds: [ROSA()], sizeIds: [t.sizeIds[0]] }).expect(201)).body.id;
    const m = (await admin.get(`/catalog/products/${other}/matrix`).expect(200)).body.cells[0].itemId;
    const op = (await admin.post('/production/orders', { productId: other, materialsWarehouseId: t.whA, outputWarehouseId: t.whB, lines: [{ variantItemId: m, qty: '1' }] }).expect(201)).body.id;
    const r = await admin.post(`/production/orders/${op}/release`);
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/ficha técnica activa/);
    await admin.put(`/production/tech-sheets/${other}/draft`, { materials: [{ byGarmentColor: true, colorMap: { [BLANCO()]: ids.telaBlanca }, qtyPerUnit: '1' }] }).expect(200);
    const act = await admin.post(`/production/tech-sheets/${other}/activate`);
    expect(act.status).toBe(422);
    expect(act.body.message).toMatch(/Rosa/);
  });

  it('dos órdenes que compiten por la misma tela no reservan más que el disponible', async () => {
    const tela = await createMaterial(admin, t, 'TELA-ESCASA');
    const prod = (await admin.post('/catalog/products', { code: 'BABERO', name: 'Babero', sizeScaleId: t.sizeScaleId, colorIds: [ROSA()], sizeIds: [t.sizeIds[0]], status: 'ACTIVE' }).expect(201)).body.id;
    const cell = (await admin.get(`/catalog/products/${prod}/matrix`).expect(200)).body.cells[0].itemId;
    await admin.put(`/production/tech-sheets/${prod}/draft`, { materials: [{ materialItemId: tela, qtyPerUnit: '1' }] }).expect(200);
    await admin.post(`/production/tech-sheets/${prod}/activate`).expect(201);
    await opening(admin, t.whA, [{ itemId: tela, qty: '10', unitCost: '100' }]);
    const mk = async () => (await admin.post('/production/orders', { productId: prod, materialsWarehouseId: t.whA, outputWarehouseId: t.whB, lines: [{ variantItemId: cell, qty: '8' }] }).expect(201)).body.id;
    const [a, b] = [await mk(), await mk()];
    const res = await Promise.all([admin.post(`/production/orders/${a}/release`), admin.post(`/production/orders/${b}/release`)]);
    expect(res.map((r) => r.status)).toEqual([201, 201]);
    expect((await stockOf(tela, t.whA)).reserved).toBe('10');
    const shortages = res.flatMap((r) => r.body.shortages);
    expect(shortages).toHaveLength(1);
    expect(shortages[0].shortage).toBe('6');
  });

  it('la orden de compra sobre el umbral queda pendiente y no la aprueba quien la cargó', async () => {
    await owner.approvalRule.create({ data: { companyId: t.companyId, actionCode: 'purchasing.order', threshold: '100000', requiredPermission: 'purchasing.approve' } });
    const compras = await login(app, t.users.PURCHASING);
    const po = await compras
      .post('/purchasing/orders', { supplierId: ids.supplier, warehouseId: t.whA, lines: [{ itemId: ids.broche, qty: '10000', unitPrice: '20', vatRate: '21' }] })
      .expect(201);
    expect(po.body.status).toBe('DRAFT');
    const rec = await compras.post('/purchasing/receipts', { supplierId: ids.supplier, warehouseId: t.whA, purchaseOrderId: po.body.id, lines: [{ poLineId: po.body.lines[0].id, itemId: ids.broche, qty: '1' }] });
    expect(rec.status).toBe(422);
    await compras.post(`/purchasing/orders/${po.body.id}/approve`).expect(403);
    const dir = await login(app, t.users.OWNER);
    await dir.post(`/purchasing/orders/${po.body.id}/approve`).expect(201);
    // Sobre-recepción por encima de la tolerancia (5 %).
    const over = await compras.post('/purchasing/receipts', {
      supplierId: ids.supplier, warehouseId: t.whA, purchaseOrderId: po.body.id, lines: [{ poLineId: po.body.lines[0].id, itemId: ids.broche, qty: '10600' }],
    });
    expect(over.status).toBe(422);
  });

  it('el operario informa avances pero no ve costos ni puede liberar órdenes', async () => {
    const operario = await login(app, t.users.OPERATOR);
    const tasks = await operario.get('/production/my-tasks').expect(200);
    expect(Array.isArray(tasks.body)).toBe(true);
    const op = tasks.body[0];
    if (op) {
      const detail = await operario.get(`/production/orders/${op.orderId}`).expect(200);
      expect(detail.body.costs).toEqual([]);
      expect(detail.body.estimatedUnitCost).toBeNull();
      await operario.post(`/production/orders/${op.orderId}/report`, { stageId: op.stage.stageId, qtyGood: '1' }).expect(201);
    }
    const o = await newOrder([{ variantItemId: variant(4, ROSA()), qty: '1' }]);
    await operario.post(`/production/orders/${o}/release`).expect(403);
  });
});
