import { defineConfig, devices } from '@playwright/test';

/**
 * E2E sobre la app levantada con el seed demo (pnpm db:seed).
 * Requiere API en :4000 y web en :3000 (pnpm dev, o build + start).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'celular', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
