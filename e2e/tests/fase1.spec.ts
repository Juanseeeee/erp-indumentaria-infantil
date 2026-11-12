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

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

test('login inválido muestra error en español', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('direccion@ositos.demo');
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Email o contraseña incorrectos.')).toBeVisible();
});

test('dirección ve el tablero con indicadores reales', async ({ page }) => {
  await login(page, 'direccion@ositos.demo');
  await expect(page.getByText('Modelos activos')).toBeVisible();
  await expect(page.getByText('Valor producto terminado')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Stock crítico/ })).toBeVisible();
  await shot(page, '01-inicio-direccion');
});

test('alta de modelo genera la matriz talle × color', async ({ page }) => {
  await login(page, 'admin@ositos.demo');
  const code = `E2E-${Date.now().toString().slice(-6)}`;
  await page.goto('/catalogo/nuevo');
  await page.getByLabel('Código del modelo').fill(code);
  await page.getByLabel('Nombre comercial').fill('Ranita E2E');
  await page.getByLabel('Escala de talles').selectOption({ label: 'Bebé (RN, 0-3, 3-6, 6-9, 9-12)' });
  for (const color of ['Blanco', 'Rosa', 'Celeste', 'Beige']) await page.getByRole('button', { name: color, exact: true }).click();
  await expect(page.getByText('Se van a generar 20 variantes')).toBeVisible();
  await shot(page, '02-nuevo-modelo');
  await page.getByRole('button', { name: 'Crear modelo' }).click();
  await expect(page.getByRole('heading', { name: 'Ranita E2E' })).toBeVisible();
  await expect(page.getByText(`Modelo ${code} · 20 variantes`)).toBeVisible();
  await page.getByRole('tab', { name: 'SKU' }).click();
  await expect(page.getByRole('grid').getByText(`${code}-ROS-3-6`)).toBeVisible();
  await shot(page, '03-matriz-modelo');
});

test('matriz del Body manga larga muestra stock por talle y color', async ({ page }) => {
  await login(page, 'deposito@ositos.demo');
  await page.goto('/catalogo');
  await page.getByText('Body manga larga').click();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: /Rosa/ })).toBeVisible();
  await shot(page, '04-matriz-stock');
});

test('ajuste de stock con lector/búsqueda y kardex con trazabilidad', async ({ page }) => {
  await login(page, 'deposito@ositos.demo');
  await page.goto('/stock/documentos/nuevo?tipo=ADJUSTMENT');
  await page.getByLabel('Depósito').selectOption({ label: 'Depósito materias primas' });
  await page.getByLabel('Motivo').selectOption('Rotura / daño');
  await page.getByLabel('Agregar artículo').fill('AVIO-BROCHE');
  await page.getByRole('button', { name: /Broche a presión/ }).click();
  await page.getByLabel('Cantidad AVIO-BROCHE-PRESION').fill('-25');
  await shot(page, '05-nuevo-ajuste');
  await page.getByRole('button', { name: /Confirmar/ }).click();
  await expect(page.getByText('Confirmado', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Movimientos generados')).toBeVisible();
  await page.getByRole('link', { name: /Broche a presión/ }).click();
  await expect(page.getByRole('heading', { name: 'Kardex' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Rotura/ }).first()).toBeVisible();
  // Depósito no tiene costs.view: no ve costos.
  await expect(page.getByText('Costo unit.')).toHaveCount(0);
  await shot(page, '06-kardex');
});

test('ventas no ve configuración ni puede ajustar stock', async ({ page }) => {
  await login(page, 'ventas@ositos.demo');
  const nav = page.getByRole('navigation', { name: 'Navegación principal' }).first();
  await expect(nav.getByRole('link', { name: 'Configuración' })).toHaveCount(0);
  // Las secciones del menú se pliegan: se abre la que haga falta.
  const section = nav.getByRole('button', { name: 'Terceros' });
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
  await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible();
  await page.goto('/stock');
  await expect(page.getByRole('link', { name: 'Ajuste' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Valorizado' })).toHaveCount(0);
  await page.goto('/stock/documentos/nuevo?tipo=ADJUSTMENT');
  await expect(page.getByText('No tenés permiso')).toBeVisible();
});

test('buscador global Ctrl+K encuentra clientes y navega', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Buscar clientes/).fill('Baby Mundo');
  await page.getByRole('option', { name: /Baby Mundo/ }).click();
  await expect(page.getByRole('heading', { name: 'Baby Mundo Distribuidora SA' })).toBeVisible();
  await shot(page, '07-ficha-cliente');
});

test('alta de cliente valida CUIT', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.goto('/terceros/nuevo?rol=CUSTOMER');
  await page.getByLabel('Razón social').fill('Cliente CUIT inválido');
  await page.getByLabel('Número').fill('30-70000001-5');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('CUIT/CUIL inválido')).toBeVisible();
});

test('el operario de planta ve el sistema en el celular @mobile', async ({ page }) => {
  await login(page, 'produccion@ositos.demo');
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByRole('link', { name: 'Stock' }).first()).toBeVisible();
  await shot(page, '08-celular-menu');
});
