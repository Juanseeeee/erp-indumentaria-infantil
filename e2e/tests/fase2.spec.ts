import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo2026erp';
const shots = process.env.E2E_SCREENSHOTS;

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: /Buscar o ejecutar/ })).toBeVisible();
}
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

test('tablero de producción con atrasos, faltantes y talleres', async ({ page }) => {
  await login(page, 'produccion@ositos.demo');
  await page.goto('/produccion');
  await expect(page.getByRole('heading', { name: 'Tablero de producción' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Materiales faltantes/ })).toBeVisible();
  await expect(page.getByText('Taller de Costura Rosa Benítez')).toBeVisible();
  await shot(page, '10-tablero-produccion');
});

test('crear, liberar y ver materiales de una orden de producción', async ({ page }) => {
  await login(page, 'produccion@ositos.demo');
  await page.goto('/produccion/ordenes/nueva');
  await page.getByLabel('Modelo').selectOption({ label: 'BODY-MC · Body manga corta' });
  await page.getByLabel('Materiales desde').selectOption({ label: 'Depósito materias primas' });
  await page.getByLabel('Ingresa producto terminado a').selectOption({ label: 'Depósito producto terminado' });
  await page.getByLabel('Blanco talle 3-6').fill('12');
  await page.getByLabel('Rosa talle 3-6').fill('12');
  await shot(page, '11-nueva-op');
  await page.getByRole('button', { name: /Crear orden \(24 prendas\)/ }).click();
  await expect(page.getByText('Borrador', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Liberar orden' }).click();
  await expect(page.getByText('Liberada', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Materiales' }).click();
  await expect(page.getByRole('cell', { name: /Interlock peinado 24\/1 blanco/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Broche a presión/ })).toBeVisible();
  await shot(page, '12-op-materiales');
  await page.getByRole('tab', { name: 'Etapas' }).click();
  await expect(page.getByText('Corte').first()).toBeVisible();
});

test('detalle de orden en taller: envíos, ingresos y costos', async ({ page }) => {
  await login(page, 'direccion@ositos.demo');
  await page.goto('/produccion/ordenes');
  await page.getByText('Body manga larga').first().click();
  await page.getByRole('tab', { name: /Talleres/ }).click();
  await expect(page.getByText(/Taller de Costura Rosa Benítez/).first()).toBeVisible();
  await shot(page, '13-op-talleres');
  await page.getByRole('tab', { name: /Ingresos y calidad/ }).click();
  await expect(page.getByText(/recepción de taller/).first()).toBeVisible();
  await expect(page.getByText('Liquidado')).toBeVisible();
  await page.getByRole('tab', { name: 'Costos' }).click();
  await expect(page.getByText('Estimado al liberar')).toBeVisible();
});

test('operario informa avance desde el celular @mobile', async ({ page }) => {
  await login(page, 'operario@ositos.demo');
  await page.goto('/produccion/tareas');
  await expect(page.getByRole('heading', { name: 'Mis tareas' })).toBeVisible();
  const card = page.locator('button', { hasText: 'Enterito' }).first();
  await card.click();
  await page.getByRole('button', { name: 'Sumar Prendas OK' }).click();
  await page.getByRole('button', { name: 'Sumar Prendas OK' }).click();
  await shot(page, '14-operario-celular');
  await page.getByRole('button', { name: 'Informar', exact: true }).click();
  await expect(page.getByText('Avance informado.')).toBeVisible();
});

test('el operario no ve compras, costos ni configuración', async ({ page }) => {
  await login(page, 'operario@ositos.demo');
  const nav = page.getByRole('navigation', { name: 'Navegación principal' }).first();
  // Las secciones del menú se pliegan: se abre la que haga falta.
  const section = nav.getByRole('button', { name: 'Producción' });
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
  await expect(nav.getByRole('link', { name: 'Mis tareas' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Órdenes de compra' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Cuentas a pagar' })).toHaveCount(0);
});

test('ficha técnica con material por color y consumo por talle', async ({ page }) => {
  await login(page, 'produccion@ositos.demo');
  await page.goto('/produccion/fichas');
  await page.getByText('Body manga larga').click();
  await expect(page.getByText(/Versión vigente: v1/)).toBeVisible();
  await expect(page.getByText('Según color')).toBeVisible();
  await expect(page.getByText(/Costo estimado de materiales/)).toBeVisible();
  await shot(page, '15-ficha-tecnica');
});

test('orden de compra → recepción con partida → stock', async ({ page }) => {
  await login(page, 'compras@ositos.demo');
  await page.goto('/compras/ordenes/nueva');
  await page.getByLabel('Proveedor').selectOption({ label: 'Textil Algodonera del Oeste SA' });
  await page.getByLabel('Recibir en').selectOption({ label: 'Depósito materias primas' });
  await page.getByLabel('Agregar artículo').fill('TELA-INTERLOCK-CEL');
  await page.getByRole('button', { name: /Interlock peinado 24\/1 celeste/ }).click();
  await page.getByLabel('Cantidad TELA-INTERLOCK-CEL').fill('150');
  await page.getByLabel('Precio TELA-INTERLOCK-CEL').fill('4950');
  await page.getByRole('button', { name: 'Crear orden de compra' }).click();
  await expect(page.getByText('Aprobada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar recepción' }).click();
  await page.getByLabel(/Recibir TELA-INTERLOCK-CEL/).fill('100');
  await page.getByLabel(/Partida TELA-INTERLOCK-CEL/).fill(`P-E2E-${Date.now().toString().slice(-5)}`);
  await page.getByLabel('Remito del proveedor').fill('0002-00004567');
  await shot(page, '16-recepcion-oc');
  await page.getByRole('button', { name: 'Confirmar recepción' }).click();
  await expect(page.getByText('Recibida parcial')).toBeVisible();
  await expect(page.getByRole('link', { name: /^RE-/ })).toBeVisible();
});

test('cuentas a pagar muestra proveedor y taller', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.goto('/cuentas-a-pagar');
  await expect(page.getByRole('link', { name: 'Avíos y Botones Once SRL' })).toBeVisible();
  await page.getByRole('link', { name: 'Taller de Costura Rosa Benítez' }).click();
  await expect(page.getByText(/FC 00002-00000145/)).toBeVisible();
  await shot(page, '17-cc-taller');
});
