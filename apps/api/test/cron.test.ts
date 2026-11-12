import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AlertsScheduler } from '../src/alerts/alerts.scheduler';
import { createApp } from './helpers';

/** Endpoint de Vercel Cron para las alertas: solo con «Authorization: Bearer CRON_SECRET». */
let app: INestApplication;
const saved = process.env.CRON_SECRET;

beforeAll(async () => {
  app = await createApp();
  // La evaluación en sí la cubre alerts.test.ts; acá se prueba la autorización y que el cron la invoque
  // (la base de pruebas acumula muchas empresas y recorrerlas todas no aporta).
  const scheduler = app.get(AlertsScheduler);
  scheduler.tick = async () => ({ companies: 1, created: 2, resolved: 0, sent: 0, failed: 0, errors: 0 });
});

afterAll(async () => {
  await app?.close();
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe('Cron de alertas', () => {
  it('sin CRON_SECRET configurada no hace nada', async () => {
    delete process.env.CRON_SECRET;
    await request(app.getHttpServer()).get('/api/cron/alerts').set('Authorization', 'Bearer x').expect(503);
  });

  it('rechaza un secreto incorrecto o ausente', async () => {
    process.env.CRON_SECRET = 'secreto-de-prueba-123';
    await request(app.getHttpServer()).get('/api/cron/alerts').expect(401);
    await request(app.getHttpServer()).get('/api/cron/alerts').set('Authorization', 'Bearer otro').expect(401);
  });

  it('con el secreto correcto ejecuta la evaluación de alertas', async () => {
    process.env.CRON_SECRET = 'secreto-de-prueba-123';
    const res = await request(app.getHttpServer()).get('/api/cron/alerts').set('Authorization', 'Bearer secreto-de-prueba-123').expect(200);
    expect(res.body).toEqual({ companies: 1, created: 2, resolved: 0, sent: 0, failed: 0, errors: 0 });
  });
});
