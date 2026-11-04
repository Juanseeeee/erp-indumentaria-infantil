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
/** Hoy en Buenos Aires como dd/mm/aaaa (las fechas de los comprobantes no deben correrse un día). */
const todayAR = () => new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

test('flujo B en pantalla: pedido en grilla → remito → factura → cobro', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'direccion@ositos.demo');
  await page.goto('/ventas/pedidos/nuevo');
  await page.getByLabel('Cliente').selectOption({ label: 'Pañalera Los Ositos de Flores SRL' });
  await expect(page.getByText('Crédito disponible')).toBeVisible();
  await page.getByLabel('Modelo').selectOption({ label: 'BODY-MC · Body manga corta' });
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();
  // Elige dos celdas con al menos 2 prendas disponibles (el disponible se ve como placeholder).
  const cells = await grid.locator('input').evaluateAll((els) =>
    (els as HTMLInputElement[]).filter((e) => !e.disabled && Number(e.placeholder) >= 2).slice(0, 2).map((e) => e.getAttribute('aria-label')!),
  );
  expect(cells.length).toBeGreaterThan(0);
  for (const label of cells) await grid.getByLabel(label).fill('2');
  await expect(page.getByRole('button', { name: 'Guardar y confirmar' })).toBeEnabled();
  await shot(page, '20-pedido-grilla');
  await page.getByRole('button', { name: 'Guardar y confirmar' }).click();
  await expect(page.getByRole('heading', { name: /Pedido PV-/ })).toBeVisible();
  await expect(page.getByText('Confirmado', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Preparar remito' }).click();
  await page.getByLabel('Bultos').fill('1');
  await shot(page, '21-preparar-remito');
  await page.getByRole('button', { name: 'Emitir remito' }).click();
  await expect(page.getByText('Entregado', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^R-/ }).click();
  await expect(page.getByText('Documento no válido como factura')).toBeVisible();
  await shot(page, '22-remito');

  await page.getByRole('link', { name: 'Facturar' }).click();
  await expect(page.getByRole('heading', { name: 'Facturar remitos' })).toBeVisible();
  await page.getByRole('button', { name: 'Emitir factura' }).click();
  await expect(page.getByText('Factura A', { exact: true })).toBeVisible();
  await expect(page.getByText(/CAE SIMULADO · SIN VALIDEZ FISCAL/)).toBeVisible();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();
  await expect(page.getByText(`Fecha ${todayAR()}`)).toBeVisible();
  await shot(page, '23-factura');

  await page.getByRole('button', { name: 'Cobrar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo cobro' })).toBeVisible();
  await page.getByLabel('Importe').fill('1000');
  await page.getByRole('button', { name: 'Imputar por vencimiento' }).click();
  await shot(page, '24-cobro');
  await page.getByRole('button', { name: 'Registrar cobro' }).click();
  await expect(page.getByText(/Recibimos de/)).toBeVisible();
  await expect(page.getByText('Aplicado a')).toBeVisible();
});

test('vendedora: no factura y ve solo sus comisiones', async ({ page }) => {
  await login(page, 'ventas@ositos.demo');
  await page.goto('/ventas/comprobantes');
  await expect(page.getByRole('heading', { name: 'Comprobantes de venta' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Facturar remitos/ })).toHaveCount(0);
  await expect(page.getByText(/modo simulado/)).toBeVisible();
  await page.goto('/ventas/comisiones');
  await expect(page.getByRole('heading', { name: 'Mis comisiones' })).toBeVisible();
  await expect(page.getByText('Pendiente de liquidar')).toBeVisible();
  await shot(page, '25-mis-comisiones');
});

test('administración: cuentas a cobrar con antigüedad y estado de cuenta', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.goto('/cuentas-a-cobrar');
  await expect(page.getByText('Total a cobrar')).toBeVisible();
  await page.getByRole('link', { name: 'Pañalera Los Ositos de Flores SRL' }).click();
  await expect(page.getByRole('heading', { name: /Estado de cuenta/ })).toBeVisible();
  await expect(page.getByText('1–30 días')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Recibo · Recibo RC-/ }).first()).toBeVisible();
  await shot(page, '26-estado-de-cuenta');
  await page.goto('/ventas/comisiones');
  await expect(page.getByRole('heading', { name: 'Comisiones' })).toBeVisible();
  await expect(page.getByText('Paula Ventas').first()).toBeVisible();
});

test('listas de precios: mayorista con precios y minorista derivada', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.goto('/ventas/precios');
  await expect(page.getByRole('link', { name: 'Minorista (local)' })).toBeVisible();
  await page.getByRole('link', { name: 'Mayorista' }).click();
  await expect(page.getByRole('heading', { name: 'Lista Mayorista' })).toBeVisible();
  await expect(page.getByText('Body manga larga')).toBeVisible();
  await page.getByRole('button', { name: 'Historial de BODY-ML' }).click();
  await expect(page.getByText(/Historial · BODY-ML/)).toBeVisible();
  await shot(page, '27-lista-precios');
});

test('vendedora carga un pedido desde el celular sin scroll horizontal @mobile', async ({ page }) => {
  await login(page, 'ventas@ositos.demo');
  await page.goto('/ventas/pedidos/nuevo');
  await page.getByLabel('Cliente').selectOption({ label: 'Baby Mundo Distribuidora SA' });
  await page.getByLabel('Modelo').selectOption({ label: 'GORRO-NUDO · Gorrito con nudo' });
  await expect(page.getByRole('grid')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, '28-pedido-celular');
});
