import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, createTenant, login, owner, type Client, type Tenant } from './helpers';

let app: INestApplication;
let t: Tenant;
let admin: Client;
let customer: string;
let supplier: string;

/** Día calendario de negocio en formato AAAA-MM-DD, con desplazamiento. */
function day(offset = 0) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Factura abierta en cuenta corriente (lo que generan ventas y compras), cargada directo para aislar la proyección. */
const openEntry = (partyId: string, accountType: 'RECEIVABLE' | 'PAYABLE', amount: string, dueOffset: number, description: string) =>
  owner.accountEntry.create({
    data: {
      companyId: t.companyId,
      partyId,
      accountType,
      entryType: 'INVOICE',
      sourceDocType: 'TEST',
      sourceDocId: randomUUID(),
      description,
      date: new Date(`${day(Math.min(dueOffset, 0) - 30)}T00:00:00.000Z`),
      dueDate: new Date(`${day(dueOffset)}T00:00:00.000Z`),
      amount,
      openAmount: amount,
      createdBy: randomUUID(),
    },
  });

const project = async (query = '') => (await admin.get(`/treasury/cashflow${query}`).expect(200)).body;
const total = (weeks: { inflow: string; outflow: string }[]) => weeks.reduce((a, w) => a + Number(w.inflow) + Number(w.outflow), 0);

beforeAll(async () => {
  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  customer = (await admin.post('/parties', { legalName: 'Bebés del Sur SA', taxIdType: 'CUIT', taxId: '30700000016', taxCondition: 'RI', roles: ['CUSTOMER'] }).expect(201)).body.id;
  supplier = (await admin.post('/parties', { legalName: 'Textil Norte SRL', taxIdType: 'CUIT', taxId: '30711111111', taxCondition: 'RI', roles: ['SUPPLIER'] }).expect(201)).body.id;

  const mov = (account: string, direction: 'IN' | 'OUT', amount: string, operation: number, value: number, concept: string, paymentMethod?: string) =>
    admin.post(`/treasury/accounts/${account}/movements`, { direction, amount, operationDate: day(operation), valueDate: day(value), concept, paymentMethod }).expect(201);
  await mov(t.bankId, 'IN', '100000', -10, -10, 'Saldo inicial');
  await mov(t.bankId, 'OUT', '30000', -1, 10, 'Cheque propio 000777', 'OWN_CHEQUE');
  const cards = (await admin.post('/treasury/accounts', { name: 'Tarjetas', type: 'CARD_CLEARING' }).expect(201)).body.id;
  await mov(cards, 'IN', '1000', -3, -1, 'Ventas con tarjeta (acreditable ya)');
  await mov(cards, 'IN', '5000', -1, 2, 'Ventas con tarjeta (48 h)');
  // Cheque de tercero en cartera, cobrado sin imputar: el recibo deja un crédito (no se proyecta) y el cheque sí.
  await admin
    .post('/sales/receipts', { customerId: customer, payments: [{ method: 'CHEQUE', amount: '15000', bank: 'Banco Galicia', reference: '0001', dueDate: day(5) }] })
    .expect(201);
  await openEntry(customer, 'RECEIVABLE', '50000', 20, 'Factura A 0001-00000010');
  await openEntry(customer, 'RECEIVABLE', '8000', -30, 'Factura A 0001-00000002 (vencida)');
  await openEntry(supplier, 'PAYABLE', '20000', 3, 'Factura proveedor 0003-00000456');
});

afterAll(async () => {
  await app.close();
});

describe('flujo de fondos proyectado', () => {
  it('parte del disponible a fecha de valor y suma lo esperado por semana', async () => {
    const r = await project();
    expect(r.opening).toBe('100000.00'); // el cheque propio todavía no bajó a fecha de valor
    expect(r.weeks).toHaveLength(13);
    expect(new Date(r.weeks[0].from).getUTCDay()).toBe(1); // semanas de lunes a domingo
    expect(total(r.weeks)).toBe(-30000 + 6000 + 15000 + 50000 + 8000 - 20000);
    expect(r.weeks.at(-1).balance).toBe('129000.00');
    expect(r.firstNegativeWeek).toBeNull();
    expect(r.overdue).toEqual({ receivable: '8000.00', payable: '0.00' });

    const byKind = (kind: string) => r.items.filter((i: { kind: string }) => i.kind === kind).map((i: { amount: string }) => i.amount).sort();
    expect(byKind('CHEQUES_PROPIOS')).toEqual(['-30000.00']);
    expect(byKind('TARJETAS')).toEqual(['1000.00', '5000.00']);
    expect(byKind('CHEQUES_A_COBRAR')).toEqual(['15000.00']);
    expect(byKind('COBRANZAS')).toEqual(['50000.00', '8000.00']);
    expect(byKind('PAGOS')).toEqual(['-20000.00']);
    // Lo vencido cae en la primera semana.
    const vencida = r.items.find((i: { overdue: boolean }) => i.overdue);
    expect(vencida).toMatchObject({ weekIndex: 0, party: 'Bebés del Sur SA' });
  });

  it('sin vencidos, el horizonte corto y un pago grande que deja el saldo negativo', async () => {
    const sinVencidos = await project('?includeOverdue=false');
    expect(sinVencidos.weeks.at(-1).balance).toBe('121000.00');
    expect(sinVencidos.overdue.receivable).toBe('8000.00'); // se informa aparte

    const corto = await project('?weeks=1');
    expect(corto.weeks).toHaveLength(1);
    expect(corto.items.every((i: { weekIndex: number }) => i.weekIndex === 0)).toBe(true);

    await openEntry(supplier, 'PAYABLE', '500000', 8, 'Factura tela temporada');
    const r = await project();
    expect(r.firstNegativeWeek).not.toBeNull();
    await admin.get('/treasury/cashflow?weeks=40').expect(400);
  });

  it('permisos: tesorería y auditoría lo ven; ventas no', async () => {
    const auditor = await login(app, t.users.AUDITOR);
    await auditor.get('/treasury/cashflow').expect(200);
    const sales = await login(app, t.users.SALES);
    await sales.get('/treasury/cashflow').expect(403);
  });
});
