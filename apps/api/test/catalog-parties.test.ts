import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Client, createApp, createTenant, login, owner, Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
});
afterAll(async () => {
  await app.close();
});

describe('catálogo con variantes', () => {
  it('crear el "Body manga larga" genera 20 SKU (5 talles × 4 colores) con código de barras', async () => {
    const res = await admin
      .post('/catalog/products', {
        code: 'body-ml', name: 'Body manga larga', sizeScaleId: t.sizeScaleId, colorIds: t.colors.slice(0, 4), status: 'ACTIVE',
      })
      .expect(201);
    expect(res.body.variantsCreated).toBe(20);
    const m = await admin.get(`/catalog/products/${res.body.id}/matrix`).expect(200);
    expect(m.body.sizes.map((s: { code: string }) => s.code)).toEqual(['RN', '0-3', '3-6', '6-9', '9-12']);
    expect(m.body.cells).toHaveLength(20);
    const skus = m.body.cells.map((c: { sku: string }) => c.sku);
    expect(skus).toContain('BODY-ML-BLA-RN');
    expect(skus).toContain('BODY-ML-ROS-3-6');
    expect(new Set(m.body.cells.map((c: { barcode: string }) => c.barcode)).size).toBe(20);
    expect(m.body.cells.every((c: { barcode: string }) => /^\d{13}$/.test(c.barcode))).toBe(true);
  });

  it('agregar un color crea solo las combinaciones nuevas', async () => {
    const p = await admin
      .post('/catalog/products', { code: 'ENT-1', name: 'Enterito', sizeScaleId: t.sizeScaleId, colorIds: [t.colors[0]] })
      .expect(201);
    expect(p.body.variantsCreated).toBe(5);
    const add = await admin.post(`/catalog/products/${p.body.id}/variants`, { colorIds: [t.colors[0], t.colors[1]] }).expect(201);
    expect(add.body.variantsCreated).toBe(5);
  });

  it('desactivar variantes puntuales desde la matriz', async () => {
    const p = await admin
      .post('/catalog/products', { code: 'GORRO', name: 'Gorrito', sizeScaleId: t.sizeScaleId, colorIds: [t.colors[2]] })
      .expect(201);
    const m = await admin.get(`/catalog/products/${p.body.id}/matrix`).expect(200);
    const rn = m.body.cells.find((c: { sku: string }) => c.sku.endsWith('-RN'));
    await admin.patch(`/catalog/products/${p.body.id}/variants`, { updates: [{ itemId: rn.itemId, isActive: false }] }).expect(200);
    const after = await admin.get(`/catalog/products/${p.body.id}/matrix`).expect(200);
    expect(after.body.cells.find((c: { itemId: string }) => c.itemId === rn.itemId).isActive).toBe(false);
  });

  it('código de modelo duplicado → 409', async () => {
    await admin.post('/catalog/products', { code: 'DUP', name: 'A', sizeScaleId: t.sizeScaleId, colorIds: [t.colors[0]] }).expect(201);
    const res = await admin.post('/catalog/products', { code: 'dup', name: 'B', sizeScaleId: t.sizeScaleId, colorIds: [t.colors[0]] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICADO');
  });

  it('cambiar el nombre del modelo actualiza las variantes pero conserva los SKU (bloqueo optimista)', async () => {
    const p = await admin
      .post('/catalog/products', { code: 'PANT', name: 'Pantalón', sizeScaleId: t.sizeScaleId, colorIds: [t.colors[0]] })
      .expect(201);
    await admin.put(`/catalog/products/${p.body.id}`, { name: 'Pantalón rib', status: 'ACTIVE', version: 1 }).expect(200);
    const stale = await admin.put(`/catalog/products/${p.body.id}`, { name: 'Otro', status: 'ACTIVE', version: 1 });
    expect(stale.status).toBe(409);
    const items = await owner.item.findMany({ where: { sku: { startsWith: 'PANT-' }, companyId: t.companyId } });
    expect(items.every((i) => i.name.startsWith('Pantalón rib'))).toBe(true);
  });
});

describe('terceros', () => {
  const base = { taxIdType: 'CUIT', taxCondition: 'RI', roles: ['CUSTOMER'] };

  it('valida el dígito verificador del CUIT', async () => {
    const res = await admin.post('/parties', { ...base, legalName: 'Mal CUIT', taxId: '30-70000001-5' });
    expect(res.status).toBe(400);
    expect(res.body.details.fields[0].path).toBe('taxId');
  });

  it('acepta CUIT con guiones y detecta duplicados', async () => {
    await admin.post('/parties', { ...base, legalName: 'Cliente Uno', taxId: '30-70000002-4' }).expect(201);
    const dup = await admin.post('/parties', { ...base, legalName: 'Cliente Repetido', taxId: '30700000024' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/Cliente Uno/);
  });

  it('dar de alta un taller crea su depósito virtual', async () => {
    const res = await admin
      .post('/parties', { ...base, legalName: 'Taller Prueba', taxId: '27300000067', taxCondition: 'MONOTRIBUTO', roles: ['WORKSHOP'] })
      .expect(201);
    const wh = await owner.warehouse.findUniqueOrThrow({ where: { partyId: res.body.id } });
    expect(wh.type).toBe('WORKSHOP');
  });

  it('bloqueo optimista al editar un tercero', async () => {
    const p = await admin.post('/parties', { ...base, legalName: 'Versionado', taxId: '30700000032' }).expect(201);
    await admin.put(`/parties/${p.body.id}`, { ...base, legalName: 'Versionado 2', taxId: '30700000032', version: 1 }).expect(200);
    const stale = await admin.put(`/parties/${p.body.id}`, { ...base, legalName: 'Versionado 3', taxId: '30700000032', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICTO_VERSION');
  });

  it('cada alta queda auditada con usuario', async () => {
    const p = await admin.post('/parties', { ...base, legalName: 'Auditado', taxId: '30700000040' }).expect(201);
    const log = await admin.get(`/settings/audit?entity=party&entityId=${p.body.id}`).expect(200);
    expect(log.body[0].action).toBe('create');
    expect(log.body[0].user).toBeTruthy();
  });
});
