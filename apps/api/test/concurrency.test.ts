import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS } from '@erp/contracts';
import { UnitOfWork } from '../src/common/unit-of-work';
import { NumberingService } from '../src/common/common.service';
import { StockService } from '../src/inventory/stock.service';
import type { RequestContext } from '../src/common/context';
import { assertReconciled, Client, createApp, createMaterial, createTenant, login, opening, owner, Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let ctx: RequestContext;
let uow: UnitOfWork;
let stock: StockService;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  uow = app.get(UnitOfWork);
  stock = app.get(StockService);
  const adminUser = await owner.user.findUniqueOrThrow({ where: { email: t.users.SUPERADMIN } });
  ctx = { companyId: t.companyId, userId: adminUser.id, sessionId: 'test', permissions: new Set(ALL_PERMISSIONS) };
});
afterAll(async () => {
  expect(await assertReconciled(t.companyId)).toEqual([]);
  await app.close();
});

const reserve = (itemId: string, qty: string, docId = randomUUID()) =>
  uow.run(ctx, (tx) => stock.reserve(tx, ctx, { itemId, warehouseId: t.whA, qty, sourceDocType: 'SALES_ORDER', sourceDocId: docId }));

describe('concurrencia', () => {
  it('dos vendedores reservan a la vez la última unidad: solo uno lo logra', async () => {
    const item = await createMaterial(admin, t, 'ULTIMO');
    await opening(admin, t.whA, [{ itemId: item, qty: '1', unitCost: '100' }]);
    const results = await Promise.allSettled([reserve(item, '1'), reserve(item, '1')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason.code).toBe('STOCK_INSUFICIENTE');
    const bal = await owner.stockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: t.whA } });
    expect(bal.reserved.toString()).toBe('1');
  });

  it('20 reservas concurrentes sobre 10 unidades: exactamente 10 se reservan', async () => {
    const item = await createMaterial(admin, t, 'DIEZ');
    await opening(admin, t.whA, [{ itemId: item, qty: '10', unitCost: '100' }]);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserve(item, '1')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const bal = await owner.stockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: t.whA } });
    expect(bal.reserved.toString()).toBe('10');
    expect(bal.onHand.toString()).toBe('10');
  });

  it('el stock reservado no puede ser consumido por otro documento; sí por su dueño', async () => {
    const item = await createMaterial(admin, t, 'RESERVADO');
    await opening(admin, t.whA, [{ itemId: item, qty: '5', unitCost: '100' }]);
    const r = await reserve(item, '4');
    const adj = await admin.post('/inventory/documents', {
      type: 'ADJUSTMENT', warehouseId: t.whA, reason: 'Venta mostrador', lines: [{ itemId: item, qty: '-2' }],
    });
    expect(adj.status).toBe(409);
    await uow.run(ctx, (tx) =>
      stock.move(tx, ctx, {
        itemId: item, warehouseId: t.whA, type: 'SALE_DELIVERY', qty: '-4',
        sourceDocType: 'DELIVERY_NOTE', sourceDocId: randomUUID(), reservationId: r.id,
      }),
    );
    const bal = await owner.stockBalance.findFirstOrThrow({ where: { itemId: item, warehouseId: t.whA } });
    expect(bal.onHand.toString()).toBe('1');
    expect(bal.reserved.toString()).toBe('0');
    expect((await owner.stockReservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('CONSUMED');
  });

  it('liberar una reserva devuelve el disponible; no se puede liberar dos veces', async () => {
    const item = await createMaterial(admin, t, 'LIBERAR');
    await opening(admin, t.whA, [{ itemId: item, qty: '3', unitCost: '100' }]);
    const r = await reserve(item, '3');
    await uow.run(ctx, (tx) => stock.release(tx, ctx, r.id));
    await expect(uow.run(ctx, (tx) => stock.release(tx, ctx, r.id))).rejects.toMatchObject({ code: 'TRANSICION_INVALIDA' });
    await reserve(item, '3');
  });

  it('transferencias cruzadas simultáneas (A→B y B→A) no generan interbloqueo', async () => {
    const items = await Promise.all(['CRUCE-1', 'CRUCE-2', 'CRUCE-3'].map((s) => createMaterial(admin, t, s)));
    for (const wh of [t.whA, t.whB]) {
      await opening(admin, wh, items.map((itemId) => ({ itemId, qty: '100', unitCost: '10' })));
    }
    const lines = items.map((itemId) => ({ itemId, qty: '1' }));
    const reversed = [...lines].reverse();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        admin.post('/inventory/documents', {
          type: 'TRANSFER',
          warehouseId: i % 2 ? t.whA : t.whB,
          targetWarehouseId: i % 2 ? t.whB : t.whA,
          lines: i % 2 ? lines : reversed,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    for (const itemId of items) {
      const total = await owner.stockBalance.aggregate({ where: { itemId }, _sum: { onHand: true } });
      expect(total._sum.onHand?.toString()).toBe('200');
    }
  });

  it('la numeración de documentos no se duplica bajo concurrencia', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () => uow.run(ctx, (tx) => app.get(NumberingService).next(tx, t.companyId, 'TEST_SEQ'))),
    );
    expect(new Set(numbers).size).toBe(25);
  });
});
