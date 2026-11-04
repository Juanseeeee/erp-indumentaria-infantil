import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo2026erp';

/** Hace 90 días (AAAA-MM-DD): los datos demo tienen ventas en ese rango, sea cual sea el mes en curso. */
const since90 = () => new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: /Buscar o ejecutar/ })).toBeVisible();
}

test('Dirección ve el tablero: indicadores con su definición y enlace al detalle', async ({ page }) => {
  await login(page, 'direccion@ositos.demo');
  const board = page.getByRole('region', { name: 'Tablero de Dirección' });
  for (const label of ['Vendido en el mes', 'Cobrado en el mes', 'Disponible real', 'Cheques en cartera a 30 días', 'Deuda de clientes vencida', 'Deuda con proveedores a 30 días']) {
    await expect(board.getByText(label, { exact: true })).toBeVisible();
  }
  await board.getByLabel('Cómo se calcula: Disponible real').click();
  await expect(board.getByText(/No incluye cheques en cartera/)).toBeVisible();
  await expect(board.getByRole('heading', { name: 'Flujo proyectado a 8 semanas' })).toBeVisible();
  await expect(board.getByRole('heading', { name: /Atención/ })).toBeVisible();
  await expect(board.getByRole('heading', { name: /Top 10 modelos/ })).toBeVisible();

  await board.getByRole('link', { name: /\$/ }).first().click();
  await expect(page).toHaveURL(/\/ventas\/comprobantes/);
});

test('Ventas no ve el tablero de Dirección', async ({ page }) => {
  await login(page, 'ventas@ositos.demo');
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tablero de Dirección' })).toHaveCount(0);
  await expect(page.getByText('Vendido en el mes')).toHaveCount(0);
});

test('Administración analiza la rentabilidad por modelo y por cliente', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.getByRole('link', { name: 'Rentabilidad' }).click();
  await expect(page.getByRole('heading', { name: 'Rentabilidad' })).toBeVisible();
  for (const label of ['Vendido neto', 'Costo de lo vendido', 'Margen bruto estimado']) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await page.getByLabel('Desde').fill(since90());
  await page.getByLabel('Cómo se calcula: Margen bruto estimado').click();
  await expect(page.getByText(/no es el resultado contable/i).first()).toBeVisible();

  const table = page.getByRole('table', { name: /por modelo/ });
  await expect(table.getByRole('row')).not.toHaveCount(0);
  await expect(table.getByRole('row', { name: /^Total/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Por cliente' }).click();
  const byCustomer = page.getByRole('table', { name: /por cliente/ });
  await expect(byCustomer.getByRole('columnheader', { name: 'Margen bruto est.' })).toHaveAttribute('aria-sort', 'descending');
  await byCustomer.getByRole('button', { name: 'Margen %' }).click();
  await expect(byCustomer.getByRole('columnheader', { name: 'Margen %' })).toHaveAttribute('aria-sort', 'descending');
  await byCustomer.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/cuentas-a-cobrar\//);
});

test('Ventas y Producción no ven la rentabilidad', async ({ page }) => {
  for (const email of ['ventas@ositos.demo', 'produccion@ositos.demo']) {
    await login(page, email);
    await expect(page.getByRole('link', { name: 'Rentabilidad' })).toHaveCount(0);
    await page.goto('/rentabilidad');
    await expect(page.getByText(/No tenés permiso para ver la rentabilidad/)).toBeVisible();
    await page.context().clearCookies();
  }
});

test('Administración consulta un reporte y lo descarga en Excel y PDF', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.getByRole('link', { name: 'Reportes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reportes', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tesorería' })).toBeVisible();
  await page.getByLabel('Buscar reporte').fill('ventas por');
  await page.getByRole('link', { name: /Ventas por período/ }).click();

  await page.getByLabel('Desde').fill(since90());
  await page.getByRole('button', { name: 'Ver reporte' }).click();
  const table = page.getByRole('table', { name: 'Ventas por período' });
  await expect(table.getByRole('columnheader', { name: 'Mes' })).toBeVisible();
  await page.getByLabel('Agrupar por').selectOption('customer');
  await page.getByRole('button', { name: 'Ver reporte' }).click();
  await expect(table.getByRole('columnheader', { name: 'Cliente' })).toBeVisible();
  await expect(page.getByText(/Agrupar por: Cliente/)).toBeVisible();

  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^ventas-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);

  await page.goto('/reportes/kardex');
  await expect(page.getByText('Completá los datos')).toBeVisible();
});

test('Ventas ve solo sus reportes y no puede descargarlos', async ({ page }) => {
  await login(page, 'ventas@ositos.demo');
  await page.goto('/reportes');
  await expect(page.getByRole('link', { name: /Pedidos pendientes/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Stock valorizado/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Cartera de cheques/ })).toHaveCount(0);
  await page.getByRole('link', { name: /Pedidos pendientes/ }).click();
  await expect(page.getByRole('table', { name: 'Pedidos pendientes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel' })).toHaveCount(0);
});

test('Administración revisa las alertas, ve las de todos y configura una regla', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.getByRole('link', { name: /^Alertas/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Alertas', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Reglas' }).click();
  await page.getByRole('button', { name: 'Revisar ahora' }).click();
  await expect(page.getByText(/alertas? nuevas?, \d+ resueltas, \d+ abiertas/)).toBeVisible();

  const rule = page.getByRole('region', { name: 'Pedido sin preparar' });
  await expect(rule.getByLabel('Días desde la confirmación')).toHaveValue(/\d+/);
  await expect(rule.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await rule.getByLabel('Prioridad').selectOption('HIGH');
  await rule.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Regla "Pedido sin preparar" guardada.')).toBeVisible();
  await rule.getByLabel('Prioridad').selectOption('NORMAL');
  await rule.getByRole('button', { name: 'Guardar' }).click();

  // La OP atrasada del demo avisa a Producción y Dirección: Administración la ve al pedir las de todos.
  await page.getByRole('tab', { name: 'Abiertas' }).click();
  await page.getByLabel('Ver las alertas de todos los usuarios').check();
  await expect(page.getByRole('article', { name: /OP-\d+ atrasada/ }).first()).toBeVisible();
});

test('Producción ve sus alertas en la campana y va a la operación', async ({ page }) => {
  await login(page, 'produccion@ositos.demo');
  await page.getByRole('link', { name: /^Alertas:/ }).click();
  const late = page.getByRole('article', { name: /OP-\d+ atrasada/ }).first();
  await expect(late).toBeVisible();
  await expect(late.getByText('Alta')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reglas' })).toHaveCount(0);
  await late.getByRole('button', { name: 'Resolver' }).click();
  await expect(late.getByLabel('Qué se hizo (opcional)')).toBeVisible();
  await late.getByRole('link', { name: /atrasada/ }).click();
  await expect(page).toHaveURL(/\/produccion\/ordenes\//);
});

test('Administración gestiona promociones: vigentes, validación y edición', async ({ page }) => {
  await login(page, 'administracion@ositos.demo');
  await page.getByRole('link', { name: 'Promociones' }).click();
  const bodies = page.getByRole('article', { name: 'Bodies por 12 o más' });
  await expect(bodies.getByText('Vigente')).toBeVisible();
  await expect(bodies.getByText(/desde 12 unidades por pedido/)).toBeVisible();
  await expect(page.getByRole('article', { name: 'Lanzamiento Bosque OI27' })).toBeVisible();

  // Sin elegir modelos no se puede crear (y no queda nada creado).
  await page.getByRole('button', { name: 'Nueva promoción' }).click();
  const form = page.getByRole('form', { name: 'Nueva promoción' });
  await form.getByLabel('Nombre (se ve en el pedido)').fill('Prueba sin alcance');
  await form.getByLabel('Descuento %').fill('5');
  await form.getByLabel('Aplica a').selectOption('PRODUCTS');
  await form.getByRole('button', { name: 'Crear promoción' }).click();
  await expect(page.getByText(/Elegí a qué modelos, categorías o colecciones aplica/)).toBeVisible();
  await form.getByRole('button', { name: 'Cancelar' }).click();

  await bodies.getByRole('button', { name: 'Editar' }).click();
  const edit = page.getByRole('form', { name: 'Editar promoción' });
  await expect(edit.getByLabel('Mínimo de unidades por pedido')).toHaveValue('12');
  await edit.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/Los pedidos ya armados conservan su descuento/)).toBeVisible();
});

test('el pedido toma sola la promoción por volumen y la muestra antes de guardar', async ({ page }) => {
  await login(page, 'ventas@ositos.demo');
  await page.goto('/ventas/pedidos/nuevo');
  await page.getByLabel('Cliente').selectOption({ label: 'Valeria Gómez (Boutique Mimitos)' });
  await expect(page.getByLabel('Descuento manual %')).toHaveAttribute('placeholder', 'Automático');
  await page.getByLabel('Modelo').selectOption({ label: 'BODY-ML · Body manga larga' });
  await page.getByLabel('Curva: unidades por celda').fill('1');
  await page.getByRole('button', { name: 'Aplicar a todo el modelo' }).click();
  await expect(page.getByText('Promociones aplicadas: Bodies por 12 o más.')).toBeVisible();
  await expect(page.getByRole('cell', { name: /10 %\s*Bodies por 12 o más/ }).first()).toBeVisible();
  // Un descuento manual reemplaza a la promoción.
  await page.getByLabel('Descuento manual %').fill('2');
  await expect(page.getByText('Promociones aplicadas')).toHaveCount(0);
});
