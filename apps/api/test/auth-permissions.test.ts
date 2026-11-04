import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createMaterial, createTenant, login, opening, owner, PASSWORD, Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let other: Tenant;

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  other = await createTenant();
});
afterAll(async () => {
  await app.close();
});

describe('autenticación', () => {
  it('rechaza requests sin sesión (401)', async () => {
    await request(app.getHttpServer()).get('/api/parties').expect(401);
  });

  it('login con contraseña incorrecta devuelve 401 sin revelar si el usuario existe', async () => {
    const a = await request(app.getHttpServer()).post('/api/auth/login').send({ email: t.users.SALES, password: 'mala' });
    const b = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'noexiste@test.local', password: 'mala' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('bloquea el usuario después de 5 intentos fallidos', async () => {
    const email = t.users.TREASURY;
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'incorrecta' }).expect(401);
    }
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(423);
    await owner.user.update({ where: { email }, data: { lockedUntil: null, failedLogins: 0 } });
  });

  it('las mutaciones sin token CSRF se rechazan (403)', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: t.users.ADMIN, password: PASSWORD });
    const cookie = ([] as string[]).concat(res.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
    await request(app.getHttpServer()).post('/api/parties').set('Cookie', cookie).send({}).expect(403);
  });

  it('logout revoca la sesión y el cierre remoto revoca las demás', async () => {
    const s1 = await login(app, t.users.ACCOUNTING);
    const s2 = await login(app, t.users.ACCOUNTING);
    await s1.get('/auth/me').expect(200);
    const revoked = await s1.del('/auth/sessions').expect(200);
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);
    await s2.get('/auth/me').expect(401);
    await s1.post('/auth/logout').expect(200);
    await s1.get('/auth/me').expect(401);
  });

  it('/auth/me devuelve roles y permisos', async () => {
    const c = await login(app, t.users.SALES);
    const me = await c.get('/auth/me').expect(200);
    expect(me.body.roles[0].code).toBe('SALES');
    expect(me.body.permissions).toContain('parties.create');
    expect(me.body.permissions).not.toContain('costs.view');
  });
});

describe('permisos validados en backend', () => {
  it('ventas no puede registrar ajustes de stock aunque conozca el endpoint', async () => {
    const admin = await login(app, t.users.SUPERADMIN);
    const item = await createMaterial(admin, t, 'PERM-1');
    const sales = await login(app, t.users.SALES);
    const res = await sales.post('/inventory/documents', {
      type: 'ADJUSTMENT', warehouseId: t.whA, reason: 'x', lines: [{ itemId: item, qty: '5' }],
    });
    expect(res.status).toBe(403);
  });

  it('el auditor puede consultar pero no crear', async () => {
    const auditor = await login(app, t.users.AUDITOR);
    await auditor.get('/parties').expect(200);
    await auditor
      .post('/parties', { legalName: 'X', taxIdType: 'DNI', taxId: '30111222', taxCondition: 'CONSUMIDOR_FINAL', roles: ['CUSTOMER'] })
      .expect(403);
  });

  it('depósito ve stock pero NO la valorización (costs.view)', async () => {
    const admin = await login(app, t.users.SUPERADMIN);
    const item = await createMaterial(admin, t, 'COSTO-1');
    await opening(admin, t.whA, [{ itemId: item, qty: '10', unitCost: '100' }]);
    const prod = await login(app, t.users.WAREHOUSE);
    const res = await prod.get(`/inventory/stock?q=COSTO-1`).expect(200);
    expect(res.body.rows[0].on_hand).toBe('10');
    expect(res.body.rows[0].value).toBeNull();
    const k = await prod.get(`/inventory/kardex?itemId=${item}`).expect(200);
    expect(k.body[0].unitCost).toBeNull();
    const own = await admin.get(`/inventory/stock?q=COSTO-1`).expect(200);
    expect(own.body.rows[0].value).toBe('1000.00');
  });

  it('un rol sin parties.credit.view no puede fijar límite de crédito', async () => {
    const sales = await login(app, t.users.SALES);
    const res = await sales.post('/parties', {
      legalName: 'Cliente con crédito', taxIdType: 'DNI', taxId: '30111223', taxCondition: 'CONSUMIDOR_FINAL',
      roles: ['CUSTOMER'], customer: { creditLimit: '100000' },
    });
    expect(res.status).toBe(403);
  });
});

describe('aislamiento multiempresa (RLS)', () => {
  it('un usuario no puede ver ni modificar datos de otra empresa', async () => {
    const a = await login(app, t.users.SUPERADMIN);
    const created = await a
      .post('/parties', { legalName: 'Secreto SA', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['SUPPLIER'] })
      .expect(201);
    const b = await login(app, other.users.SUPERADMIN);
    await b.get(`/parties/${created.body.id}`).expect(404);
    const list = await b.get('/parties?q=Secreto').expect(200);
    expect(list.body.total).toBe(0);
    const upd = await b.put(`/parties/${created.body.id}`, {
      legalName: 'Hackeado', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['SUPPLIER'],
    });
    expect([404, 409]).toContain(upd.status);
    const still = await owner.party.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(still.legalName).toBe('Secreto SA');
  });

  it('el mismo CUIT puede existir en dos empresas distintas', async () => {
    const b = await login(app, other.users.SUPERADMIN);
    await b
      .post('/parties', { legalName: 'Secreto SA (otra empresa)', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'] })
      .expect(201);
  });

  it('sin empresa activa en la transacción, RLS no devuelve filas', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const appRole = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
    const count = await appRole.party.count();
    expect(count).toBe(0);
    await appRole.$disconnect();
  });
});
