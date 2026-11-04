import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

/** Aplica las migraciones a la base de test (erp_test) antes de correr la suite. */
export default async function setup() {
  config({ path: resolve(__dirname, '../.env') });
  const migrationUrl = process.env.DATABASE_MIGRATION_URL_TEST;
  if (!migrationUrl) throw new Error('Falta DATABASE_MIGRATION_URL_TEST en .env');
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: migrationUrl, DATABASE_MIGRATION_URL: migrationUrl },
    stdio: 'pipe',
  });
  const owner = new PrismaClient({ datasources: { db: { url: migrationUrl } } });
  await owner.$executeRawUnsafe(`ALTER ROLE erp_app LOGIN PASSWORD 'erp_app'`);
  await owner.$disconnect();
}
