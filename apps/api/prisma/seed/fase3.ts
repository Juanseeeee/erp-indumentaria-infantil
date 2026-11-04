/**
 * Datos demo de la Fase 3 (ventas, cuentas a cobrar y comisiones) para la empresa ficticia.
 * Se ejecuta una sola vez: si ya hay listas de precios, se omite.
 * Los comprobantes se autorizan con ARCA en modo SIMULADO (sin validez fiscal).
 */
import type { INestApplicationContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '../../src/common/context';
import { PricingService } from '../../src/sales/pricing.service';
import { CommissionsService } from '../../src/sales/commissions.service';
import { SalesOrdersService } from '../../src/sales/sales-orders.service';
import { DeliveriesService } from '../../src/sales/deliveries.service';
import { SalesInvoicesService } from '../../src/sales/sales-invoices.service';
import { ReceiptsService } from '../../src/sales/receipts.service';
import { TreasuryService } from '../../src/treasury/treasury.service';
import { CatalogService } from '../../src/catalog/catalog.service';
import { dec, roundMoney } from '@erp/domain-core';

const PRICES: Record<string, string> = {
  'BODY-ML': '9800',
  'BODY-MC': '8600',
  'ENT-OSITO': '18500',
  'ENT-ZORRO': '21900',
  'PANT-RIB': '7900',
  'CONJ-BOSQUE': '32500',
  'BABERO-X3': '6400',
  'GORRO-NUDO': '4900',
};

export async function seedFase3(app: INestApplicationContext, owner: PrismaClient, ctx: RequestContext) {
  const companyId = ctx.companyId;
  // ─── Tesorería: donde entran los cobros (la cartera de cheques se crea sola) ───
  const treasury = app.get(TreasuryService);
  if ((await owner.cashAccount.count({ where: { companyId } })) === 0) {
    await treasury.createAccount(ctx, { name: 'Caja principal', type: 'CASH_BOX', currency: 'ARS', bank: null, accountReference: null });
    await treasury.createAccount(ctx, { name: 'Banco Provincia cta. cte.', type: 'BANK', currency: 'ARS', bank: 'Banco Provincia', accountReference: 'CBU 0140000000000000000000' });
    await treasury.createAccount(ctx, { name: 'Mercado Pago', type: 'WALLET', currency: 'ARS', bank: null, accountReference: null });
  }

  if ((await owner.priceList.count({ where: { companyId } })) > 0) {
    console.log('Fase 3 ya cargada: se omite.');
    return;
  }
  const pricing = app.get(PricingService);
  const commissions = app.get(CommissionsService);
  const orders = app.get(SalesOrdersService);
  const deliveries = app.get(DeliveriesService);
  const invoices = app.get(SalesInvoicesService);
  const receipts = app.get(ReceiptsService);
  const catalog = app.get(CatalogService);

  // ─── Listas de precios ───
  const mayorista = await pricing.upsertList(ctx, { name: 'Mayorista', kind: 'WHOLESALE', includesVat: false, baseListId: null, markupPct: null, isActive: true });
  await pricing.upsertList(ctx, { name: 'Minorista (local)', kind: 'RETAIL', includesVat: true, baseListId: mayorista.id, markupPct: '75', isActive: true });
  const products = await owner.product.findMany({ where: { companyId, code: { in: Object.keys(PRICES) } } });
  await pricing.setPrices(ctx, mayorista.id, { validFrom: null, prices: products.map((p) => ({ productId: p.id, itemId: null, price: PRICES[p.code]! })) });

  // ─── Vendedora con comisión del 3 % sobre lo cobrado ───
  const vendedora = await owner.user.findUniqueOrThrow({ where: { email: 'ventas@ositos.demo' } });
  await commissions.upsertRep(ctx, { userId: vendedora.id, commissionPct: '3', isActive: true });
  const customers = await owner.party.findMany({ where: { companyId, roles: { some: { role: 'CUSTOMER' } } }, orderBy: { code: 'asc' } });
  for (const [i, c] of customers.entries()) {
    await owner.customerProfile.update({ where: { partyId: c.id }, data: { priceListId: mayorista.id, sellerUserId: i < 4 ? vendedora.id : null } });
  }
  const customer = (name: string) => customers.find((c) => c.legalName.startsWith(name))!.id;
  const pt = (await owner.warehouse.findFirstOrThrow({ where: { companyId, code: 'PT' } })).id;

  /** Elige variantes del modelo con stock suficiente en PT. */
  const pick = async (code: string, qty: number, cells: number, includeShortage = false) => {
    const product = products.find((p) => p.code === code)!;
    const m = await catalog.matrix(ctx, product.id, pt);
    const ok = m.cells.filter((c) => Number(c.available) >= qty).slice(0, cells);
    const lines = ok.map((c) => ({ itemId: c.itemId, qty: String(qty) }));
    if (includeShortage) {
      const short = m.cells.find((c) => Number(c.available) < qty);
      if (short) lines.push({ itemId: short.itemId, qty: String(qty) });
    }
    return lines;
  };
  const newOrder = async (name: string, lines: { itemId: string; qty: string }[]) =>
    orders.create(ctx, { customerId: customer(name), warehouseId: pt, lines, priceListId: null, sellerUserId: null, paymentTermId: null, promisedAt: null, deliveryAddress: null, notes: null });
  const deliverAll = async (orderId: string, share = 1) => {
    const o = await orders.detail(ctx, orderId);
    const lines = o.lines
      .map((l) => ({ orderLineId: l.id, qty: String(Math.floor(Math.min(Number(l.pendingQty), Number(l.reservedQty)) * share)) }))
      .filter((l) => Number(l.qty) > 0);
    return deliveries.create(ctx, { orderId, lines, issueDate: null, carrier: 'Transporte Rápido Oeste', packages: 2, notes: null });
  };
  const entryOf = async (docId: string) => (await owner.accountEntry.findFirstOrThrow({ where: { companyId, sourceDocId: docId } })).id;

  // 1. Los Ositos de Flores: entregado completo, facturado, cobrado a medias y con una devolución.
  const o1 = await newOrder('Pañalera Los Ositos', [...(await pick('BODY-ML', 6, 4)), ...(await pick('GORRO-NUDO', 4, 2))]);
  await orders.confirm(ctx, o1.id, { creditOverrideNote: null });
  const d1 = await deliverAll(o1.id);
  const f1 = await invoices.createInvoice(ctx, { customerId: customer('Pañalera Los Ositos'), deliveryIds: [d1.id], issueDate: null, notes: null });
  const half = roundMoney(dec(f1.total).div(2)).toFixed(2);
  await receipts.create(ctx, {
    customerId: customer('Pañalera Los Ositos'),
    date: null,
    notes: 'Pago a cuenta',
    payments: [{ method: 'TRANSFER', amount: half, reference: 'Transferencia 00045871', bank: null, dueDate: null, cashAccountId: null, drawerName: null, drawerTaxId: null, issueDate: null }],
    allocations: [{ entryId: await entryOf(f1.id), amount: half }],
  });
  const lineToReturn = f1.lines.find((l) => l.itemId);
  if (lineToReturn) {
    await invoices.createCreditNote(ctx, {
      invoiceId: f1.id,
      reason: 'Devolución: costura abierta',
      issueDate: null,
      returnWarehouseId: pt,
      lines: [{ invoiceLineId: lineToReturn.id, qty: '1' }],
      concepts: [],
    });
  }

  // 2. Baby Mundo: entrega parcial facturada y un segundo remito pendiente de facturar.
  const o2 = await newOrder('Baby Mundo', [...(await pick('BODY-MC', 10, 3)), ...(await pick('PANT-RIB', 8, 3))]);
  await orders.confirm(ctx, o2.id, { creditOverrideNote: null });
  const d2 = await deliverAll(o2.id, 0.5);
  await invoices.createInvoice(ctx, { customerId: customer('Baby Mundo'), deliveryIds: [d2.id], issueDate: null, notes: null });
  await deliverAll(o2.id);

  // 3. Chiquitines: confirmado con faltante (queda pendiente hasta que producción entregue).
  const o3 = await newOrder('Chiquitines', await pick('ENT-OSITO', 5, 3, true));
  await orders.confirm(ctx, o3.id, { creditOverrideNote: null });

  // 4. Mi Primer Ajuar: borrador.
  await newOrder('Mi Primer Ajuar', await pick('BABERO-X3', 6, 1));

  // 5. Mimitos (monotributo): facturado y cobrado con cheque; sin vendedor asignado.
  const o5 = await newOrder('Valeria Gómez', await pick('BODY-ML', 2, 3));
  await orders.confirm(ctx, o5.id, { creditOverrideNote: null });
  const d5 = await deliverAll(o5.id);
  const f5 = await invoices.createInvoice(ctx, { customerId: customer('Valeria Gómez'), deliveryIds: [d5.id], issueDate: null, notes: null });
  await receipts.create(ctx, {
    customerId: customer('Valeria Gómez'),
    date: null,
    notes: null,
    payments: [{ method: 'CHEQUE', amount: f5.total, reference: '00321456', bank: 'Banco Provincia', dueDate: new Date(Date.now() + 30 * 86_400_000), cashAccountId: null, drawerName: null, drawerTaxId: null, issueDate: null }],
    allocations: [{ entryId: await entryOf(f5.id), amount: f5.total }],
  });

  console.log('Fase 3: listas de precios, 5 pedidos, remitos, facturas (CAE simulado), cobros y comisiones.');
}
