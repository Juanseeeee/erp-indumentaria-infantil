import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo2026erp';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: /Buscar o ejecutar/ })).toBeVisible();
}
/** Hoy en Buenos Aires como aaaa-mm-dd. */
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

test('cheque cobrado: entra en cartera, se deposita y se acredita en el banco', async ({ page }) => {
  test.setTimeout(90_000);
  const number = `E2E${Date.now()}`;
  await login(page, 'tesoreria@ositos.demo');

  await page.goto('/cobros/nuevo');
  await page.getByLabel('Cliente').selectOption({ index: 1 });
  await page.getByLabel('Medio', { exact: true }).selectOption('CHEQUE');
  await page.getByLabel('Importe').fill('1234.56');
  await page.getByLabel('Número', { exact: true }).fill(number);
  await page.getByLabel('Banco', { exact: true }).fill('Banco Galicia');
  await page.getByLabel('Fecha de pago').fill(todayISO());
  await page.getByRole('button', { name: 'Registrar cobro' }).click();
  await expect(page.getByText(/Recibimos de/)).toBeVisible();
  await expect(page.getByText(/En cartera en Cartera de cheques/)).toBeVisible();

  await page.goto('/tesoreria');
  await page.getByRole('tab', { name: 'Cartera de cheques' }).click();
  const row = page.getByRole('row').filter({ hasText: number });
  await expect(row.getByText('para depositar')).toBeVisible();
  await row.getByRole('button', { name: 'Depositar' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Cheque depositado.')).toBeVisible();

  await page.getByRole('tab', { name: 'Depositados' }).click();
  await row.getByRole('button', { name: 'Acreditado' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Acreditación registrada.')).toBeVisible();
  await page.getByRole('tab', { name: 'Acreditados' }).click();
  await expect(row.getByText('Acreditado')).toBeVisible();
});

test('quien no opera tesorería ve la cartera pero no puede depositar', async ({ page }) => {
  await login(page, 'auditor@ositos.demo');
  await page.goto('/tesoreria');
  await page.getByRole('tab', { name: 'Cartera de cheques' }).click();
  await expect(page.getByText('En cartera', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Depositar' })).toHaveCount(0);
});

test('orden de pago con cheque propio: sale del banco y luego se marca debitado', async ({ page }) => {
  test.setTimeout(90_000);
  const number = `P${Date.now()}`.slice(0, 12);
  await login(page, 'tesoreria@ositos.demo');

  await page.goto('/pagos/nuevo');
  await page.getByLabel('Proveedor o taller').selectOption({ index: 1 });
  await page.getByLabel('Medio', { exact: true }).selectOption('OWN_CHEQUE');
  await page.getByLabel('Importe').fill('1500');
  await page.getByLabel('Número', { exact: true }).fill(number);
  await page.getByLabel('Fecha de pago').fill(todayISO());
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByText(/Pagamos a/)).toBeVisible();
  await expect(page.getByText(/Emitido/)).toBeVisible();

  await page.goto('/tesoreria');
  await page.getByRole('tab', { name: 'Cartera de cheques' }).click();
  await page.getByRole('button', { name: 'Propios' }).click();
  const row = page.getByRole('row').filter({ hasText: number });
  await row.getByRole('button', { name: 'Debitado' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Débito registrado.')).toBeVisible();
  await page.getByRole('tab', { name: 'Debitados' }).click();
  await expect(row).toBeVisible();
});

test('compras consulta los pagos pero no puede registrarlos', async ({ page }) => {
  await login(page, 'compras@ositos.demo');
  await page.goto('/pagos');
  await expect(page.getByRole('heading', { name: 'Pagos' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Nueva orden de pago/ })).toHaveCount(0);
});

/** "$ 1.234,56" → 1234.56 */
const parseMoney = (text: string) => Number(text.replace(/[^\d,-]/g, '').replace(',', '.'));

test('transferencia del banco a la caja y arqueo con faltante', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, 'tesoreria@ositos.demo');
  await page.goto('/tesoreria');
  await page.getByRole('tab', { name: 'Transferencias' }).click();
  await page.getByLabel('Desde', { exact: true }).selectOption({ label: 'Banco Provincia cta. cte.' });
  await page.getByLabel('Hacia').selectOption({ label: 'Caja principal' });
  await page.getByLabel('Importe').fill('5000');
  await page.getByLabel('Concepto').fill('Extracción E2E');
  await page.getByRole('button', { name: 'Transferir' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Extracción E2E' }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Arqueos' }).click();
  await page.getByLabel('Caja', { exact: true }).selectOption({ label: 'Caja principal' });
  const expected = page.getByText('Según sistema', { exact: true }).locator('xpath=following-sibling::p[1]');
  await expect(expected).toContainText('$');
  const counted = (parseMoney(await expected.innerText()) - 100).toFixed(2);
  await page.getByLabel('Efectivo contado').fill(counted);
  await expect(page.getByText('Faltante', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar arqueo' }).click();
  await expect(page.getByRole('status')).toContainText('Faltan $ 100,00');
  await expect(page.getByRole('row').filter({ hasText: 'Faltan $ 100,00' }).first()).toBeVisible();
});

test('gasto con centro de costo: suma en el resumen y se puede anular', async ({ page }) => {
  test.setTimeout(90_000);
  const concept = `Flete E2E ${Date.now()}`;
  await login(page, 'tesoreria@ositos.demo');
  await page.goto('/gastos');
  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  await page.getByLabel('Categoría').selectOption({ label: 'Fletes y envíos' });
  await page.getByLabel('Centro de costo').first().selectOption({ label: 'LOG · Logística' });
  await page.getByLabel('Pagado desde').selectOption({ label: 'Banco Provincia cta. cte.' });
  await page.getByLabel('Concepto').fill(concept);
  await page.getByLabel('Importe').fill('2500');
  await page.getByRole('button', { name: 'Registrar gasto' }).click();
  const row = page.getByRole('row').filter({ hasText: concept });
  await expect(row).toBeVisible();
  await expect(page.getByText('Por centro de costo')).toBeVisible();

  await row.getByRole('button', { name: 'Anular' }).click();
  await page.getByLabel('Motivo (obligatorio)').fill('Prueba E2E');
  await page.getByRole('button', { name: 'Anular gasto' }).click();
  await expect(row.getByText('Anulado')).toBeVisible();
});

test('el auditor consulta gastos y arqueos sin poder registrarlos', async ({ page }) => {
  await login(page, 'auditor@ositos.demo');
  await page.goto('/gastos');
  await expect(page.getByText('Total del período')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo gasto' })).toHaveCount(0);
  await page.goto('/tesoreria');
  await page.getByRole('tab', { name: 'Arqueos' }).click();
  await expect(page.getByRole('button', { name: 'Registrar arqueo' })).toHaveCount(0);
});

test('extracto bancario: importa, concilia sola la coincidencia inequívoca y registra la comisión', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const amount = (3000 + (stamp % 1000) + (stamp % 97) / 100).toFixed(2);
  const concept = `Flete conciliación ${stamp}`;
  await login(page, 'tesoreria@ositos.demo');

  // Un gasto pagado por banco: el extracto lo va a traer como débito.
  await page.goto('/gastos');
  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  await page.getByLabel('Categoría').selectOption({ label: 'Fletes y envíos' });
  await page.getByLabel('Centro de costo').first().selectOption({ label: 'LOG · Logística' });
  await page.getByLabel('Pagado desde').selectOption({ label: 'Banco Provincia cta. cte.' });
  await page.getByLabel('Concepto').fill(concept);
  await page.getByLabel('Importe').fill(amount);
  await page.getByRole('button', { name: 'Registrar gasto' }).click();
  await expect(page.getByRole('row').filter({ hasText: concept })).toBeVisible();

  const [y, m, d] = todayISO().split('-');
  const csv = ['Fecha;Concepto;Débito;Crédito;Comprobante', `${d}/${m}/${y};Pago flete;${amount.replace('.', ',')};;`, `${d}/${m}/${y};Comisión E2E ${stamp};123,45;;`].join('\n');
  await page.goto('/tesoreria');
  await page.getByRole('tab', { name: 'Conciliación' }).click();
  await page.getByLabel('Cuenta', { exact: true }).selectOption({ label: 'Banco Provincia cta. cte.' });
  const file = { name: `extracto-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') };
  await page.getByLabel('Archivo CSV').setInputFiles(file);
  await page.getByRole('button', { name: 'Importar' }).click();
  await expect(page.getByRole('status')).toContainText('Se importaron 2 líneas');
  await page.getByRole('button', { name: 'Conciliar ahora' }).click();

  await expect(page.getByRole('heading', { name: 'Extracto Banco Provincia cta. cte.' })).toBeVisible();
  await page.getByRole('button', { name: 'Conciliar sugeridas' }).click();
  await expect(page.getByText('Se conciliaron 1 líneas.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Pago flete' }).getByText('Conciliada')).toBeVisible();

  const commission = page.getByRole('row').filter({ hasText: `Comisión E2E ${stamp}` });
  await commission.getByRole('button', { name: 'Resolver' }).click();
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Movimiento registrado y conciliado.')).toBeVisible();
  await expect(page.getByText('Extracto conciliado')).toBeVisible();

  // El mismo archivo no se importa dos veces.
  await page.goto('/tesoreria');
  await page.getByRole('tab', { name: 'Conciliación' }).click();
  await page.getByLabel('Cuenta', { exact: true }).selectOption({ label: 'Banco Provincia cta. cte.' });
  await page.getByLabel('Archivo CSV').setInputFiles(file);
  await page.getByRole('button', { name: 'Importar' }).click();
  await expect(page.getByText('Todas las líneas de este archivo ya estaban importadas.')).toBeVisible();
});

test('flujo de fondos: proyección semanal con detalle por semana', async ({ page }) => {
  await login(page, 'tesoreria@ositos.demo');
  await page.goto('/flujo-de-fondos');
  await expect(page.getByText('Disponible hoy')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ingresos y egresos esperados por semana' })).toBeVisible();
  const rows = page.getByRole('table', { name: 'Flujo de fondos por semana' }).locator('tbody tr');
  await expect(rows).toHaveCount(13);
  await page.getByLabel('Horizonte').selectOption('4');
  await expect(rows).toHaveCount(4);
  await rows.first().getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.getByRole('heading', { name: /Detalle de la semana del/ })).toBeVisible();
});

/** Dirección reabre todo (con motivo) si hay un cierre: deja la base demo operable con cualquier fecha. */
async function reopenAll(page: Page, reason: string) {
  await login(page, 'direccion@ositos.demo');
  await page.goto('/cierre-de-periodo');
  const reopen = page.getByRole('button', { name: 'Reabrir período' });
  await expect(page.getByText(/No hay períodos cerrados|Cerrado hasta el/).first()).toBeVisible();
  if (await reopen.count()) {
    await page.getByLabel('Motivo (obligatorio)').fill(reason);
    await reopen.click();
    await expect(page.getByText('No hay períodos cerrados')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
}

test('cierre de período: bloquea fechas cerradas y solo Dirección reabre', async ({ page }) => {
  test.setTimeout(120_000);
  await reopenAll(page, 'Reapertura previa a la prueba E2E');
  try {
    await login(page, 'administracion@ositos.demo');
    await page.goto('/cierre-de-periodo');
    await expect(page.getByRole('list', { name: 'Controles antes de cerrar' })).toBeVisible();
    const until = await page.getByLabel('Cerrar hasta el día').inputValue();
    const [y, m, d] = until.split('-');
    await page.getByLabel('Observaciones').fill('Cierre E2E');
    await page.getByRole('button', { name: 'Cerrar período' }).click();
    await expect(page.getByText(`Cerrado hasta el ${d}/${m}/${y}. Se puede operar`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reabrir período' })).toHaveCount(0); // Administración no reabre

    // Un gasto fechado en el período cerrado se rechaza con un mensaje claro.
    await page.goto('/gastos');
    await page.getByRole('button', { name: 'Nuevo gasto' }).click();
    await page.getByLabel('Fecha', { exact: true }).fill(until);
    await page.getByLabel('Categoría').selectOption({ label: 'Fletes y envíos' });
    await page.getByLabel('Centro de costo').first().selectOption({ label: 'LOG · Logística' });
    await page.getByLabel('Pagado desde').selectOption({ label: 'Banco Provincia cta. cte.' });
    await page.getByLabel('Concepto').fill('Gasto en período cerrado');
    await page.getByLabel('Importe').fill('100');
    await page.getByRole('button', { name: 'Registrar gasto' }).click();
    await expect(page.getByText(/El período está cerrado hasta el/)).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  } finally {
    // Siempre se reabre, aunque algo falle: la base demo no puede quedar bloqueada.
    await reopenAll(page, 'Reapertura al terminar la prueba E2E');
  }
  await login(page, 'direccion@ositos.demo');
  await page.goto('/cierre-de-periodo');
  await expect(page.getByRole('row').filter({ hasText: 'Reapertura al terminar la prueba E2E' }).first()).toBeVisible();
});

test('orden de pago grande: queda pendiente y Dirección la aprueba', async ({ page }) => {
  test.setTimeout(120_000);
  const ref = `TRF-E2E-${Date.now()}`;
  await login(page, 'tesoreria@ositos.demo');
  await page.goto('/pagos/nuevo');
  await page.getByLabel('Proveedor o taller').selectOption({ index: 1 });
  await page.getByLabel('Medio', { exact: true }).selectOption('TRANSFER');
  await page.getByLabel('Importe').fill('600000');
  await page.getByLabel('Referencia').fill(ref);
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByText('Pendiente de aprobación.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprobar y pagar' })).toHaveCount(0); // Tesorería no aprueba
  const url = page.url();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await login(page, 'direccion@ositos.demo');
  await page.goto('/pagos');
  await page.getByLabel('Solo pendientes de aprobación').check();
  await expect(page.getByRole('row').filter({ hasText: 'Pendiente de aprobación' }).first()).toBeVisible();
  await page.goto(url);
  await page.getByRole('button', { name: 'Aprobar y pagar' }).click();
  await expect(page.getByText('Orden de pago aprobada: se pagó y se imputó.')).toBeVisible();
  await expect(page.getByText(/Aprobada por/)).toBeVisible();
  await expect(page.getByText('Pagada', { exact: true })).toBeVisible();
});

test('gasto recurrente: se crea la plantilla, se registra el mes y se desactiva', async ({ page }) => {
  test.setTimeout(120_000);
  const name = `Abono E2E ${Date.now()}`;
  await login(page, 'tesoreria@ositos.demo');
  await page.goto('/gastos');
  await page.getByRole('tab', { name: 'Recurrentes' }).click();
  await page.getByRole('button', { name: 'Nuevo gasto recurrente' }).click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Categoría').selectOption({ label: 'Servicios (luz, gas, internet)' });
  await page.getByLabel('Centro de costo').selectOption({ label: 'ADM · Administración' });
  await page.getByLabel('Se paga desde').selectOption({ label: 'Banco Provincia cta. cte.' });
  await page.getByLabel('Importe habitual').fill('12500');
  await page.getByLabel('Vence el día').fill('5');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByText('Gasto recurrente creado.')).toBeVisible();

  const card = page.getByRole('region', { name });
  const register = card.getByRole('button', { name: new RegExp(`^Registrar ${name}`) }).first();
  await card.getByLabel(new RegExp(`^Importe de ${name}`)).first().fill('12990');
  await register.click();
  await expect(page.getByText(new RegExp(`${name} de .* registrado`))).toBeVisible();
  await expect(card.getByText(/último registrado/)).toBeVisible();
  await card.getByRole('button', { name: 'Desactivar' }).click();
  await expect(card.getByText('Desactivado')).toBeVisible();
});
