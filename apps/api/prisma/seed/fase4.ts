/**
 * Datos demo de la Fase 4 (finanzas): centros de costo, categorías de gastos y algunos gastos pagados
 * desde el banco. Se ejecuta una sola vez: si ya hay centros de costo, se omite.
 */
import type { INestApplicationContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '../../src/common/context';
import { SettingsService } from '../../src/settings/settings.service';
import { ExpensesService } from '../../src/treasury/expenses.service';
import { TreasuryService } from '../../src/treasury/treasury.service';

const OPENING_CONCEPT = 'Saldo inicial (migración desde SISAGO)';
/** Saldos de apertura de las cuentas demo, como los traería la migración. */
const OPENING_BALANCES: Record<string, string> = { 'Banco Provincia cta. cte.': '4850000', 'Mercado Pago': '312400' };

const COST_CENTERS = [
  ['ADM', 'Administración'],
  ['PRO', 'Producción'],
  ['COM', 'Comercial'],
  ['LOG', 'Logística'],
] as const;

const EXPENSE_CATEGORIES = ['Fletes y envíos', 'Servicios (luz, gas, internet)', 'Alquiler', 'Librería y limpieza', 'Mantenimiento', 'Publicidad'];

export async function seedFase4(app: INestApplicationContext, owner: PrismaClient, ctx: RequestContext) {
  const companyId = ctx.companyId;
  // Fuera de la guardia: bases cargadas antes también lo reciben (una sola vez por cuenta).
  const treasury = app.get(TreasuryService);
  for (const [name, amount] of Object.entries(OPENING_BALANCES)) {
    const account = await owner.cashAccount.findFirst({ where: { companyId, name } });
    if (!account || (await owner.treasuryMovement.count({ where: { cashAccountId: account.id, concept: OPENING_CONCEPT } }))) continue;
    await treasury.createMovement(ctx, account.id, { direction: 'IN', amount, operationDate: '2026-10-01', valueDate: '2026-10-01', concept: OPENING_CONCEPT, paymentMethod: null });
    console.log(`Fase 4: saldo inicial de "${name}".`);
  }
  if ((await owner.costCenter.count({ where: { companyId } })) > 0) {
    await seedRecurringAndApprovals(app, owner, ctx);
    console.log('Fase 4 ya cargada: se omite.');
    return;
  }
  const settings = app.get(SettingsService);
  const centers: Record<string, string> = {};
  for (const [code, name] of COST_CENTERS) centers[code] = (await settings.createCostCenter(ctx, { code, name })).id;
  const categories: Record<string, string> = {};
  for (const name of EXPENSE_CATEGORIES) {
    const existing = await owner.category.findFirst({ where: { companyId, kind: 'EXPENSE', name } });
    categories[name] = existing?.id ?? (await settings.createCategory(ctx, { name, kind: 'EXPENSE', parentId: null })).id;
  }

  const bank = await owner.cashAccount.findFirst({ where: { companyId, type: 'BANK', isActive: true }, orderBy: { name: 'asc' } });
  if (!bank) return;
  const expenses = app.get(ExpensesService);
  const demo: [string, string, string, string, string | null][] = [
    ['Fletes y envíos', 'LOG', 'Envío a cliente mayorista (Rosario)', '18500', 'Remito transporte 0003-00004521'],
    ['Servicios (luz, gas, internet)', 'PRO', 'Energía eléctrica planta (octubre)', '96400', 'Factura Edenor B 0021-00877340'],
    ['Alquiler', 'ADM', 'Alquiler oficina y depósito', '450000', null],
    ['Publicidad', 'COM', 'Campaña redes sociales temporada PV', '120000', null],
  ];
  for (const [category, center, description, amount, documentReference] of demo) {
    await expenses.create(ctx, { categoryId: categories[category]!, costCenterId: centers[center]!, cashAccountId: bank.id, description, amount, documentReference, supplierId: null });
  }
  await seedRecurringAndApprovals(app, owner, ctx);
  console.log(`Fase 4: ${COST_CENTERS.length} centros de costo, ${EXPENSE_CATEGORIES.length} categorías de gastos y ${demo.length} gastos.`);
}

/** Gastos recurrentes de ejemplo y la regla de aprobación de pagos (una sola vez). */
async function seedRecurringAndApprovals(app: INestApplicationContext, owner: PrismaClient, ctx: RequestContext) {
  const companyId = ctx.companyId;
  if (!(await owner.approvalRule.findFirst({ where: { companyId, actionCode: 'payables.payment' } }))) {
    await app.get(SettingsService).upsertApprovalRule(ctx, { actionCode: 'payables.payment', threshold: '500000', isActive: true });
    console.log('Fase 4: las órdenes de pago de más de $ 500.000 requieren aprobación de Dirección.');
  }
  if (await owner.expenseTemplate.count({ where: { companyId } })) return;
  const bank = await owner.cashAccount.findFirst({ where: { companyId, name: 'Banco Provincia cta. cte.' } });
  const category = (name: string) => owner.category.findFirst({ where: { companyId, kind: 'EXPENSE', name } });
  const center = (code: string) => owner.costCenter.findFirst({ where: { companyId, code } });
  if (!bank) return;
  const expenses = app.get(ExpensesService);
  // El alquiler de octubre ya está cargado como gasto suelto: la plantilla arranca en noviembre.
  const demo: [string, string, string, string, number, string][] = [
    ['Alquiler oficina y depósito', 'Alquiler', 'ADM', '450000', 10, '2026-11-01'],
    ['Energía eléctrica planta', 'Servicios (luz, gas, internet)', 'PRO', '96000', 18, '2026-10-01'],
    ['Internet y telefonía', 'Servicios (luz, gas, internet)', 'ADM', '38500', 5, '2026-10-01'],
  ];
  for (const [name, cat, cc, amount, dayOfMonth, startsOn] of demo) {
    const [c, k] = await Promise.all([category(cat), center(cc)]);
    if (!c || !k) continue;
    await expenses.createTemplate(ctx, { name, categoryId: c.id, costCenterId: k.id, cashAccountId: bank.id, supplierId: null, amount, dayOfMonth, startsOn });
  }
  console.log(`Fase 4: ${demo.length} gastos recurrentes de ejemplo.`);
}
