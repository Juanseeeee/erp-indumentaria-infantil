import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';

config({ path: resolve(__dirname, '../.env') });
// La app bajo test usa la base erp_test con el rol de aplicación (sujeto a RLS).
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.LOGIN_RATE_LIMIT = '10000';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_MODULE, SYSTEM_ROLES } from '@erp/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/server';
import { hashPassword } from '../src/auth/auth.service';

export const PASSWORD = 'Prueba12345';

/** Cliente con el rol propietario (bypassa RLS) — SOLO para preparar datos y verificar invariantes. */
export const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_MIGRATION_URL_TEST } } });

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

let passwordHash: string | undefined;

export interface Tenant {
  companyId: string;
  users: Record<keyof typeof SYSTEM_ROLES, string>; // rol → email
  uomUn: string;
  uomM: string;
  colors: string[];
  sizeScaleId: string;
  sizeIds: string[];
  whA: string;
  whB: string;
  cashBoxId: string;
  bankId: string;
}

/** Crea una empresa aislada con un usuario por rol y datos maestros mínimos. */
export async function createTenant(): Promise<Tenant> {
  passwordHash ??= await hashPassword(PASSWORD);
  await owner.permission.createMany({
    data: ALL_PERMISSIONS.map((code) => ({ code, module: PERMISSION_MODULE(code), description: PERMISSIONS[code] })),
    skipDuplicates: true,
  });
  const suffix = randomUUID().slice(0, 8);
  const company = await owner.company.create({
    data: { legalName: `Empresa test ${suffix}`, cuit: `30${Date.now()}`.slice(0, 11) + suffix, taxCondition: 'RI' },
  });
  const companyId = company.id;
  const users = {} as Tenant['users'];
  for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
    const role = await owner.role.create({
      data: {
        companyId,
        code,
        name: def.name,
        isSystem: true,
        permissions: { create: def.permissions.map((p) => ({ permissionCode: p, companyId })) },
      },
    });
    const email = `${code.toLowerCase()}-${suffix}@test.local`;
    const user = await owner.user.create({ data: { email, name: `${def.name} ${suffix}`, passwordHash } });
    await owner.companyUser.create({ data: { companyId, userId: user.id } });
    await owner.userRole.create({ data: { companyId, userId: user.id, roleId: role.id } });
    users[code as keyof typeof SYSTEM_ROLES] = email;
  }
  const un = await owner.uom.create({ data: { companyId, code: 'un', name: 'Unidades', dimension: 'UNIT' } });
  const m = await owner.uom.create({ data: { companyId, code: 'm', name: 'Metros', dimension: 'LENGTH' } });
  const colors = await Promise.all(
    [['BLA', 'Blanco'], ['ROS', 'Rosa'], ['CEL', 'Celeste'], ['BEI', 'Beige'], ['GRI', 'Gris']].map(([code, name]) =>
      owner.color.create({ data: { companyId, code: code!, name: name! } }),
    ),
  );
  const scale = await owner.sizeScale.create({
    data: {
      companyId,
      name: 'Bebé',
      sizes: { create: ['RN', '0-3', '3-6', '6-9', '9-12'].map((code, i) => ({ code, sortOrder: i + 1, companyId })) },
    },
    include: { sizes: { orderBy: { sortOrder: 'asc' } } },
  });
  const whA = await owner.warehouse.create({ data: { companyId, code: 'A', name: 'Depósito A' } });
  const whB = await owner.warehouse.create({ data: { companyId, code: 'B', name: 'Depósito B' } });
  const cashBox = await owner.cashAccount.create({ data: { companyId, type: 'CASH_BOX', name: 'Caja principal' } });
  const bank = await owner.cashAccount.create({ data: { companyId, type: 'BANK', name: 'Banco Nación cta. cte.', bank: 'Banco Nación' } });
  return {
    companyId,
    users,
    uomUn: un.id,
    uomM: m.id,
    colors: colors.map((c) => c.id),
    sizeScaleId: scale.id,
    sizeIds: scale.sizes.map((s) => s.id),
    whA: whA.id,
    whB: whB.id,
    cashBoxId: cashBox.id,
    bankId: bank.id,
  };
}

export interface Client {
  get(path: string): request.Test;
  post(path: string, body?: object, headers?: Record<string, string>): request.Test;
  put(path: string, body?: object): request.Test;
  patch(path: string, body?: object): request.Test;
  del(path: string): request.Test;
}

/** Inicia sesión y devuelve un cliente HTTP con cookie de sesión y token CSRF. */
export async function login(app: INestApplication, email: string, password = PASSWORD): Promise<Client> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
  const csrf = cookies.find((c) => c.startsWith('erp_csrf='))!.split(';')[0]!.split('=')[1]!;
  const server = app.getHttpServer();
  const withAuth = (t: request.Test, mutating: boolean) => {
    t.set('Cookie', cookieHeader);
    if (mutating) t.set('x-csrf-token', csrf);
    return t;
  };
  return {
    get: (p) => withAuth(request(server).get(`/api${p}`), false),
    post: (p, body = {}, headers = {}) => withAuth(request(server).post(`/api${p}`), true).set(headers).send(body),
    put: (p, body = {}) => withAuth(request(server).put(`/api${p}`), true).send(body),
    patch: (p, body = {}) => withAuth(request(server).patch(`/api${p}`), true).send(body),
    del: (p) => withAuth(request(server).delete(`/api${p}`), true),
  };
}

/** Crea un material simple vía API y devuelve su itemId. */
export async function createMaterial(c: Client, t: Tenant, sku: string, extra: object = {}) {
  const res = await c
    .post('/materials', { sku, name: `Material ${sku}`, baseUomId: t.uomM, ...extra })
    .expect(201);
  return res.body.itemId as string;
}

/** Carga stock inicial vía API. */
export async function opening(c: Client, warehouseId: string, lines: { itemId: string; qty: string; unitCost: string }[]) {
  return c.post('/inventory/documents', { type: 'OPENING', warehouseId, lines, post: true }).expect(201);
}

/** Verifica la invariante proyección = Σ movimientos para una empresa. */
export async function assertReconciled(companyId: string) {
  const diffs = await owner.$queryRaw<unknown[]>`
    WITH m AS (SELECT item_id, warehouse_id, lot_id, SUM(qty) s FROM stock_movements WHERE company_id = ${companyId}::uuid GROUP BY 1,2,3),
         r AS (SELECT item_id, warehouse_id, SUM(qty - consumed_qty) s FROM stock_reservations WHERE company_id = ${companyId}::uuid AND status = 'ACTIVE' GROUP BY 1,2)
    SELECT b.* FROM stock_balances b
    LEFT JOIN m ON m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id AND m.lot_id IS NOT DISTINCT FROM b.lot_id
    LEFT JOIN r ON r.item_id = b.item_id AND r.warehouse_id = b.warehouse_id AND b.lot_id IS NULL
    WHERE b.company_id = ${companyId}::uuid
      AND (b.on_hand <> COALESCE(m.s, 0) OR (b.lot_id IS NULL AND b.reserved <> COALESCE(r.s, 0)) OR b.on_hand < 0)`;
  return diffs;
}
