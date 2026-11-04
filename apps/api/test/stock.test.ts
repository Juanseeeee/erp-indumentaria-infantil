import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertReconciled, Client, createApp, createMaterial, createTenant, login, opening, owner, Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
});
afterAll(async () => {
  expect(await assertReconciled(t.companyId)).toEqual([]);
  await app.close();
});

const stockOf = async (itemId: string, warehouseId: string) => {
  const res = await admin.get(`/inventory/stock?warehouseId=${warehouseId}&q=`).expect(200);
  return res.body.rows.find((r: { item_id: string }) => r.item_id === itemId);
};

describe('motor de stock', () => {
  it('stock inicial + segunda entrada calculan costo promedio ponderado', async () => {
    const item = await createMaterial(admin, t, 'TELA-PROM');
    await opening(admin, t.whA, [{ itemId: item, qty: '100', unitCost: '1500' }]);
    await opening(admin, t.whA, [{ itemId: item, qty: '50', unitCost: '1800' }]);
    const detail = await admin.get(`/inventory/stock/${item}`).expect(200);
    expect(detail.body.balances[0].onHand).toBe('150');
    expect(detail.body.balances[0].avgCost).toBe('1600');
  });

  it('transferencia: sale del origen y entra al destino al mismo costo, con movimientos enlazados', async () => {
    const item = await createMaterial(admin, t, 'TELA-TRANSF');
    await opening(admin, t.whA, [{ itemId: item, qty: '40', unitCost: '2000' }]);
    const doc = await admin
      .post('/inventory/documents', { type: 'TRANSFER', warehouseId: t.whA, targetWarehouseId: t.whB, lines: [{ itemId: item, qty: '15' }] })
      .expect(201);
    expect(doc.body.status).toBe('POSTED');
    expect((await stockOf(item, t.whA)).on_hand).toBe('25');
    expect((await stockOf(item, t.whB)).on_hand).toBe('15');
    const movs = await owner.stockMovement.findMany({ where: { sourceDocId: doc.body.id } });
    expect(movs).toHaveLength(2);
    expect(movs[0]!.transferGroupId).toBe(movs[1]!.transferGroupId);
    expect(movs.every((m) => m.unitCost.toString() === '2000')).toBe(true);
  });

  it('no permite dejar stock negativo (409) y no deja rastro parcial', async () => {
    const item = await createMaterial(admin, t, 'TELA-NEG');
    const other = await createMaterial(admin, t, 'TELA-NEG-2');
    await opening(admin, t.whA, [{ itemId: item, qty: '5', unitCost: '10' }, { itemId: other, qty: '5', unitCost: '10' }]);
    const res = await admin.post('/inventory/documents', {
      type: 'ADJUSTMENT', warehouseId: t.whA, reason: 'Rotura',
      lines: [{ itemId: other, qty: '-1' }, { itemId: item, qty: '-6' }],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STOCK_INSUFICIENTE');
    // Rollback total: la primera línea tampoco se aplicó y no quedó el documento.
    expect((await stockOf(other, t.whA)).on_hand).toBe('5');
    expect(await owner.stockDocument.count({ where: { companyId: t.companyId, type: 'ADJUSTMENT', reason: 'Rotura' } })).toBe(0);
  });

  it('ajuste sobre el umbral queda pendiente y no puede aprobarlo quien lo cargó', async () => {
    await owner.approvalRule.create({
      data: { companyId: t.companyId, actionCode: 'inventory.adjust', threshold: '1000', requiredPermission: 'inventory.adjust.approve' },
    });
    const item = await createMaterial(admin, t, 'TELA-APROB');
    await opening(admin, t.whA, [{ itemId: item, qty: '100', unitCost: '50' }]);
    const deposito = await login(app, t.users.WAREHOUSE);
    const doc = await deposito
      .post('/inventory/documents', { type: 'ADJUSTMENT', warehouseId: t.whA, reason: 'Diferencia', lines: [{ itemId: item, qty: '-30' }] })
      .expect(201);
    expect(doc.body.status).toBe('PENDING_APPROVAL');
    expect((await stockOf(item, t.whA)).on_hand).toBe('100');

    // Un ajuste chico (bajo umbral) se postea directo.
    const small = await deposito
      .post('/inventory/documents', { type: 'ADJUSTMENT', warehouseId: t.whA, reason: 'Diferencia', lines: [{ itemId: item, qty: '-2' }] })
      .expect(201);
    expect(small.body.status).toBe('POSTED');

    await deposito.post(`/inventory/documents/${doc.body.id}/approve`).expect(403);
    const owner_ = await login(app, t.users.OWNER);
    const approved = await owner_.post(`/inventory/documents/${doc.body.id}/approve`).expect(201);
    expect(approved.body.status).toBe('POSTED');
    expect((await stockOf(item, t.whA)).on_hand).toBe('68');
  });

  it('anular un documento posteado genera movimientos de reversa (no borra)', async () => {
    const item = await createMaterial(admin, t, 'TELA-ANUL');
    await opening(admin, t.whA, [{ itemId: item, qty: '20', unitCost: '100' }]);
    const tr = await admin
      .post('/inventory/documents', { type: 'TRANSFER', warehouseId: t.whA, targetWarehouseId: t.whB, lines: [{ itemId: item, qty: '8' }] })
      .expect(201);
    await admin.post(`/inventory/documents/${tr.body.id}/void`, { reason: 'Cargado por error' }).expect(201);
    expect((await stockOf(item, t.whA)).on_hand).toBe('20');
    expect((await stockOf(item, t.whB)).on_hand).toBe('0');
    const all = await owner.stockMovement.count({ where: { itemId: item } });
    expect(all).toBe(5); // apertura + 2 de transferencia + 2 de reversa
    await admin.post(`/inventory/documents/${tr.body.id}/void`, { reason: 'otra vez' }).expect(422);
  });

  it('los movimientos son de solo inserción (trigger en la base)', async () => {
    const m = await owner.stockMovement.findFirstOrThrow({ where: { companyId: t.companyId } });
    await expect(owner.stockMovement.update({ where: { id: m.id }, data: { qty: '999' } })).rejects.toThrow(/solo inserción/);
    await expect(owner.stockMovement.delete({ where: { id: m.id } })).rejects.toThrow(/solo inserción/);
  });

  it('el kardex muestra saldo acumulado y documento origen', async () => {
    const item = await createMaterial(admin, t, 'TELA-KARDEX');
    await opening(admin, t.whA, [{ itemId: item, qty: '10', unitCost: '100' }]);
    await admin
      .post('/inventory/documents', { type: 'ADJUSTMENT', warehouseId: t.whA, reason: 'Muestra', lines: [{ itemId: item, qty: '-3' }] })
      .expect(201);
    const k = await admin.get(`/inventory/kardex?itemId=${item}`).expect(200);
    expect(k.body.map((m: { balanceAfter: string }) => m.balanceAfter)).toEqual(['10', '7']);
    expect(k.body[1].source.number).toMatch(/^AJ-/);
    expect(k.body[1].user).toBeTruthy();
  });

  it('lotes: la tela se controla por partida', async () => {
    const item = await createMaterial(admin, t, 'TELA-LOTE', { trackLots: true });
    await admin
      .post('/inventory/documents', {
        type: 'OPENING', warehouseId: t.whA, post: true,
        lines: [
          { itemId: item, qty: '50', unitCost: '1000', lotCode: 'P-001' },
          { itemId: item, qty: '30', unitCost: '1200', lotCode: 'P-002' },
        ],
      })
      .expect(201);
    const detail = await admin.get(`/inventory/stock/${item}`).expect(200);
    expect(detail.body.balances.map((d: { lot: { code: string } }) => d.lot.code).sort()).toEqual(['P-001', 'P-002']);
    const bad = await admin.post('/inventory/documents', {
      type: 'ADJUSTMENT', warehouseId: t.whA, reason: 'x', lines: [{ itemId: item, qty: '-5', lotCode: 'P-999' }],
    });
    expect(bad.status).toBe(404);
  });

  it('inventario físico ajusta solo las diferencias contadas', async () => {
    const i1 = await createMaterial(admin, t, 'CNT-1');
    const i2 = await createMaterial(admin, t, 'CNT-2');
    await opening(admin, t.whB, [{ itemId: i1, qty: '10', unitCost: '5' }, { itemId: i2, qty: '4', unitCost: '5' }]);
    const count = await admin.post('/inventory/counts', { warehouseId: t.whB, itemIds: [i1, i2] }).expect(201);
    await admin.patch(`/inventory/counts/${count.body.id}/lines`, { lines: [{ itemId: i1, countedQty: '8' }, { itemId: i2, countedQty: '4' }] }).expect(200);
    const posted = await admin.post(`/inventory/counts/${count.body.id}/post`).expect(201);
    expect(posted.body.adjustedLines).toBe(1);
    expect((await stockOf(i1, t.whB)).on_hand).toBe('8');
    await admin.post(`/inventory/counts/${count.body.id}/post`).expect(422);
  });
});

describe('idempotencia', () => {
  it('reintentar con la misma Idempotency-Key no duplica el documento ni el stock', async () => {
    const item = await createMaterial(admin, t, 'TELA-IDEM');
    const key = randomUUID();
    const body = { type: 'OPENING', warehouseId: t.whA, post: true, lines: [{ itemId: item, qty: '10', unitCost: '1' }] };
    const r1 = await admin.post('/inventory/documents', body, { 'Idempotency-Key': key }).expect(201);
    const r2 = await admin.post('/inventory/documents', body, { 'Idempotency-Key': key }).expect(201);
    expect(r2.body.id).toBe(r1.body.id);
    expect((await stockOf(item, t.whA)).on_hand).toBe('10');
  });

  it('reintentos CONCURRENTES con la misma clave generan un único documento', async () => {
    const item = await createMaterial(admin, t, 'TELA-IDEM-CONC');
    const key = randomUUID();
    const body = { type: 'OPENING', warehouseId: t.whA, post: true, lines: [{ itemId: item, qty: '7', unitCost: '1' }] };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => admin.post('/inventory/documents', body, { 'Idempotency-Key': key })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect((await stockOf(item, t.whA)).on_hand).toBe('7');
  });

  it('la misma clave con otros datos se rechaza', async () => {
    const item = await createMaterial(admin, t, 'TELA-IDEM-2');
    const key = randomUUID();
    await admin
      .post('/inventory/documents', { type: 'OPENING', warehouseId: t.whA, lines: [{ itemId: item, qty: '1', unitCost: '1' }] }, { 'Idempotency-Key': key })
      .expect(201);
    await admin
      .post('/inventory/documents', { type: 'OPENING', warehouseId: t.whA, lines: [{ itemId: item, qty: '2', unitCost: '1' }] }, { 'Idempotency-Key': key })
      .expect(422);
  });
});
