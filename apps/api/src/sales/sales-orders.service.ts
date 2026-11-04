import { Injectable } from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { SalesOrderUpsertInput } from '@erp/contracts';
import { Dec, DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import { applyPromotions, assertOrderTransition, creditCheck, netUnitPrice, orderStatusFromLines, salesTotals, type PromotionScope } from '@erp/domain-sales';
import type { Tx } from '../prisma/prisma.service';
import { can, type RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService, readSetting } from '../common/common.service';
import { businessDate } from '../common/dates';
import { StockService } from '../inventory/stock.service';
import { AccountsService } from '../accounts/accounts.service';
import { PricingService } from './pricing.service';
import { CommissionsService } from './commissions.service';

const OPEN_STATUSES: SalesOrderStatus[] = ['CONFIRMED', 'PARTIALLY_DELIVERED'];

/** Pendiente de entregar de una línea. */
export const linePending = (l: { qty: Prisma.Decimal; deliveredQty: Prisma.Decimal; cancelledQty: Prisma.Decimal }) =>
  dec(l.qty.toString()).minus(l.deliveredQty.toString()).minus(l.cancelledQty.toString());

/** Valor con IVA de una cantidad de la línea (para crédito y pendientes). */
const grossOf = (qty: Dec, l: { unitPrice: Prisma.Decimal; discountPct: Prisma.Decimal; vatRate: Prisma.Decimal }) =>
  qty.times(l.unitPrice.toString()).times(dec(1).minus(dec(l.discountPct.toString()).div(100))).times(dec(1).plus(dec(l.vatRate.toString()).div(100)));

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly accounts: AccountsService,
    private readonly pricing: PricingService,
    private readonly commissions: CommissionsService,
  ) {}

  private async customer(tx: Tx, id: string) {
    const p = await tx.party.findUnique({ where: { id }, include: { roles: true, customerProfile: true } });
    if (!p || !p.roles.some((r) => r.role === 'CUSTOMER')) throw new DomainError(ErrorCodes.VALIDACION, 'El tercero elegido no es cliente.');
    if (!p.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'El cliente está inactivo.');
    return p;
  }

  /**
   * Arma las líneas valorizadas: precio de la lista (neto de IVA) y descuento. Sin descuento manual, cada
   * línea toma el mejor entre el del cliente y las promociones vigentes (no se acumulan). Las promociones
   * ya están autorizadas: no cuentan para el tope de descuento del vendedor.
   */
  private async buildLines(tx: Tx, ctx: RequestContext, input: SalesOrderUpsertInput, priceListId: string, customerDiscount: string) {
    const itemIds = input.lines.map((l) => l.itemId);
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, sku: true, kind: true, isActive: true, variant: { select: { productId: true, product: { select: { categoryId: true, collectionId: true } } } } },
    });
    const prices = await this.pricing.resolve(tx, priceListId, itemIds);
    const vatRate = String(await readSetting(tx, ctx.companyId, 'sales.vatRate', '21'));
    const maxDiscount = dec(String(await readSetting(tx, ctx.companyId, 'sales.maxDiscountPct', 15)));
    const managesPrices = can(ctx, 'sales.prices.manage');
    const today = businessDate();
    const promotions = await tx.promotion.findMany({ where: { isActive: true, validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gte: today } }] } });
    const auto = applyPromotions({
      lines: input.lines.flatMap((l) => {
        const v = items.find((i) => i.id === l.itemId)?.variant;
        return v ? [{ itemId: l.itemId, qty: l.qty, productId: v.productId, categoryId: v.product.categoryId, collectionId: v.product.collectionId }] : [];
      }),
      promotions: promotions.map((p) => ({ ...p, discountPct: p.discountPct.toString(), minQty: p.minQty.toString(), scope: p.scope as PromotionScope })),
      customerId: input.customerId,
      priceListId,
      customerDiscountPct: customerDiscount,
      date: today,
    });
    return input.lines.map((l) => {
      const item = items.find((i) => i.id === l.itemId);
      if (!item || item.kind !== 'VARIANT') throw new DomainError(ErrorCodes.VALIDACION, 'Solo se venden variantes de productos terminados.');
      if (!item.isActive) throw new DomainError(ErrorCodes.VALIDACION, `${item.sku} está inactivo.`);
      const listed = prices.get(l.itemId);
      const listNet = listed ? netUnitPrice(listed.price, listed.includesVat, vatRate) : null;
      let unitPrice = listNet;
      if (l.unitPrice !== null && l.unitPrice !== undefined && (!listNet || !dec(l.unitPrice).eq(listNet))) {
        if (!managesPrices) throw new DomainError(ErrorCodes.SIN_PERMISO, `No podés cambiar el precio de lista de ${item.sku}.`, 403);
        unitPrice = dec(l.unitPrice);
      }
      if (!unitPrice) throw new DomainError(ErrorCodes.VALIDACION, `${item.sku} no tiene precio en la lista elegida.`, 422, { itemId: item.id });
      const best = auto.find((a) => a.itemId === l.itemId)!;
      const manual = l.discountPct !== null && l.discountPct !== undefined;
      const discountPct = manual ? dec(l.discountPct!) : best.discountPct;
      const promotionId = manual ? null : best.promotionId;
      if (!promotionId && discountPct.gt(maxDiscount) && !managesPrices) {
        throw new DomainError(ErrorCodes.SIN_PERMISO, `El descuento máximo sin autorización es ${maxDiscount.toString()} %.`, 403);
      }
      return { itemId: l.itemId, qty: l.qty, unitPrice: unitPrice.toString(), discountPct: discountPct.toString(), vatRate, promotionId };
    });
  }

  /** Cómo quedaría el pedido (precios, descuentos y promociones) sin guardarlo. */
  preview(ctx: RequestContext, input: SalesOrderUpsertInput) {
    return this.uow.run(ctx, async (tx) => {
      const h = await this.header(tx, ctx, input);
      const promos = await tx.promotion.findMany({ where: { id: { in: h.lines.map((l) => l.promotionId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      const totals = salesTotals(h.lines);
      return {
        priceListId: h.data.priceListId,
        netTotal: h.data.netTotal,
        total: h.data.total,
        lines: h.lines.map((l, i) => ({ ...l, net: totals.lines[i]!.net.toString(), promotionName: promos.find((p) => p.id === l.promotionId)?.name ?? null })),
      };
    });
  }

  private async header(tx: Tx, ctx: RequestContext, input: SalesOrderUpsertInput) {
    const c = await this.customer(tx, input.customerId);
    const priceListId = input.priceListId ?? c.customerProfile?.priceListId ?? (await readSetting<string | null>(tx, ctx.companyId, 'sales.defaultPriceListId', null));
    if (!priceListId) throw new DomainError(ErrorCodes.VALIDACION, 'El cliente no tiene lista de precios asignada: elegí una.');
    const wh = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh || wh.type === 'WORKSHOP' || !wh.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'Elegí un depósito propio activo para despachar.');
    let sellerUserId = input.sellerUserId ?? c.customerProfile?.sellerUserId ?? null;
    if (!sellerUserId && (await this.commissions.currentPct(tx, ctx.companyId, ctx.userId)) !== null) sellerUserId = ctx.userId;
    const lines = await this.buildLines(tx, ctx, input, priceListId, c.customerProfile?.discountPct.toString() ?? '0');
    const totals = salesTotals(lines);
    return {
      customer: c,
      data: {
        customerId: c.id,
        sellerUserId,
        priceListId,
        warehouseId: input.warehouseId,
        paymentTermId: input.paymentTermId ?? c.customerProfile?.paymentTermId ?? null,
        promisedAt: input.promisedAt,
        deliveryAddress: input.deliveryAddress,
        notes: input.notes,
        netTotal: totals.netTotal.toString(),
        total: totals.total.toString(),
      },
      lines,
    };
  }

  create(ctx: RequestContext, input: SalesOrderUpsertInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const h = await this.header(tx, ctx, input);
        const number = `PV-${await this.numbering.next(tx, ctx.companyId, 'SALES_ORDER', '', 6)}`;
        const order = await tx.salesOrder.create({
          data: {
            companyId: ctx.companyId,
            number,
            orderDate: businessDate(),
            ...h.data,
            createdBy: ctx.userId,
            lines: { create: h.lines.map((l) => ({ companyId: ctx.companyId, ...l })) },
          },
        });
        await this.audit.log(tx, ctx, { entity: 'sales_order', entityId: order.id, action: 'create', diff: { number, total: h.data.total } });
        return order;
      },
      { idempotent: true },
    );
  }

  update(ctx: RequestContext, id: string, input: SalesOrderUpsertInput) {
    return this.uow.run(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      if (o.status !== 'DRAFT') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Solo se editan pedidos en borrador.');
      if (input.version !== undefined && input.version !== o.version) {
        throw new DomainError(ErrorCodes.CONFLICTO_VERSION, 'Otra persona modificó el pedido. Recargá para ver los cambios.', 409);
      }
      const h = await this.header(tx, ctx, input);
      await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
      await tx.salesOrder.update({
        where: { id },
        data: { ...h.data, version: { increment: 1 }, lines: { create: h.lines.map((l) => ({ companyId: ctx.companyId, ...l })) } },
      });
      await this.audit.log(tx, ctx, { entity: 'sales_order', entityId: id, action: 'update', diff: { total: { from: o.total.toString(), to: h.data.total } } });
      return this.detailInTx(tx, id);
    });
  }

  private async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El pedido no existe.', 404);
    return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  }

  /** Exposición de crédito: saldo + pendiente de entregar de otros pedidos abiertos + este pedido. */
  async creditStatus(tx: Tx, customerId: string, orderTotal: Dec, excludeOrderId?: string) {
    const profile = await tx.customerProfile.findUnique({ where: { partyId: customerId } });
    const balance = await this.accounts.balanceOf(tx, customerId, 'RECEIVABLE');
    const open = await tx.salesOrderLine.findMany({
      where: { order: { customerId, status: { in: OPEN_STATUSES }, ...(excludeOrderId ? { NOT: { id: excludeOrderId } } : {}) } },
    });
    // Lo entregado sin facturar también es deuda en curso.
    const uninvoiced = await tx.deliveryNoteLine.findMany({ where: { delivery: { customerId, status: 'ISSUED', invoiceId: null } } });
    const openOrders = roundMoney(
      open.reduce((a, l) => a.plus(grossOf(linePending(l), l)), dec(0)).plus(uninvoiced.reduce((a, l) => a.plus(grossOf(dec(l.qty.toString()), l)), dec(0))),
    );
    const r = creditCheck({ limit: profile?.creditLimit?.toString() ?? null, balance, openOrders, order: orderTotal });
    return { ...r, balance, openOrders };
  }

  confirm(ctx: RequestContext, id: string, input: { creditOverrideNote: string | null }) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const o = await this.lock(tx, id);
        assertOrderTransition(o.status, 'CONFIRMED');
        const credit = await this.creditStatus(tx, o.customerId, dec(o.total.toString()), o.id);
        let creditApprovedBy: string | null = null;
        if (credit.exceeded) {
          const details = { limit: credit.limit?.toFixed(2), exposure: credit.exposure.toFixed(2), excess: credit.excess.toFixed(2), balance: credit.balance.toFixed(2) };
          if (!can(ctx, 'sales.credit.override')) {
            throw new DomainError(
              ErrorCodes.REQUIERE_APROBACION,
              `El pedido supera el límite de crédito del cliente por $ ${credit.excess.toFixed(2)}. Tiene que autorizarlo Administración.`,
              409,
              details,
            );
          }
          if (!input.creditOverrideNote) {
            throw new DomainError(ErrorCodes.REQUIERE_APROBACION, `El pedido supera el límite de crédito por $ ${credit.excess.toFixed(2)}. Indicá el motivo para autorizarlo.`, 409, details);
          }
          creditApprovedBy = ctx.userId;
        }
        const shortages = await this.reserveLines(tx, ctx, o);
        await tx.salesOrder.update({
          where: { id },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), creditApprovedBy, creditNote: creditApprovedBy ? input.creditOverrideNote : null, version: { increment: 1 } },
        });
        await this.audit.log(tx, ctx, {
          entity: 'sales_order',
          entityId: id,
          action: 'confirm',
          diff: { shortages: shortages.length, credit: credit.exceeded ? { excess: credit.excess.toFixed(2), approvedBy: ctx.userId } : 'ok' },
          reason: creditApprovedBy ? input.creditOverrideNote : null,
        });
        return { ...(await this.detailInTx(tx, id)), shortages };
      },
      { idempotent: true },
    );
  }

  /**
   * Reserva lo pendiente de cada línea hasta el disponible. Lo que no alcanza queda pendiente (backorder):
   * "Reservar pendientes" lo vuelve a intentar cuando entra mercadería.
   */
  private async reserveLines(tx: Tx, ctx: RequestContext, o: Awaited<ReturnType<SalesOrdersService['lock']>>) {
    await this.stock.prelock(tx, ctx.companyId, o.lines.map((l) => ({ itemId: l.itemId, warehouseId: o.warehouseId })));
    const shortages: { itemId: string; missing: string }[] = [];
    for (const l of o.lines) {
      const pending = linePending(l);
      const reserved = await this.stock.reservationPending(tx, l.reservationId);
      const need = pending.minus(reserved);
      if (need.lte(0)) continue;
      const free = await this.stock.available(tx, l.itemId, o.warehouseId);
      const extra = Dec.max(0, Dec.min(need, free));
      if (extra.gt(0)) {
        if (l.reservationId) await this.stock.release(tx, ctx, l.reservationId, { strict: false });
        const r = await this.stock.reserve(tx, ctx, {
          itemId: l.itemId,
          warehouseId: o.warehouseId,
          qty: reserved.plus(extra).toString(),
          sourceDocType: 'SALES_ORDER',
          sourceDocId: o.id,
          sourceLineId: l.id,
        });
        await tx.salesOrderLine.update({ where: { id: l.id }, data: { reservationId: r.id } });
      }
      if (need.gt(extra)) shortages.push({ itemId: l.itemId, missing: need.minus(extra).toString() });
    }
    return shortages;
  }

  reservePending(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      if (!OPEN_STATUSES.includes(o.status)) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El pedido no tiene pendientes para reservar.');
      const shortages = await this.reserveLines(tx, ctx, o);
      await this.audit.log(tx, ctx, { entity: 'sales_order', entityId: id, action: 'reserve_pending', diff: { shortages: shortages.length } });
      return { ...(await this.detailInTx(tx, id)), shortages };
    });
  }

  private async releaseAll(tx: Tx, ctx: RequestContext, lines: { reservationId: string | null }[]) {
    for (const l of lines) if (l.reservationId) await this.stock.release(tx, ctx, l.reservationId, { strict: false });
  }

  /** Sin entregas: cancela el pedido. Con entregas parciales: cancela lo pendiente y queda entregado. */
  cancel(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      if (!['DRAFT', ...OPEN_STATUSES].includes(o.status)) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El pedido ya está entregado, cerrado o cancelado.');
      await this.releaseAll(tx, ctx, o.lines);
      for (const l of o.lines) {
        await tx.salesOrderLine.update({ where: { id: l.id }, data: { cancelledQty: dec(l.cancelledQty.toString()).plus(linePending(l)).toString() } });
      }
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: id } });
      const status = orderStatusFromLines(lines.map((l) => ({ qty: l.qty.toString(), deliveredQty: l.deliveredQty.toString(), cancelledQty: l.cancelledQty.toString() })));
      await tx.salesOrder.update({ where: { id }, data: { status, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { entity: 'sales_order', entityId: id, action: status === 'CANCELLED' ? 'cancel' : 'close_pending', reason });
      return this.detailInTx(tx, id);
    });
  }

  /** Datos para cargar un pedido: condiciones comerciales del cliente y situación de crédito. */
  customerContext(ctx: RequestContext, customerId: string) {
    return this.uow.run(ctx, async (tx) => {
      const c = await this.customer(tx, customerId);
      const p = c.customerProfile;
      const [priceList, seller, term, credit] = await Promise.all([
        p?.priceListId ? tx.priceList.findUnique({ where: { id: p.priceListId }, select: { id: true, name: true, includesVat: true } }) : null,
        p?.sellerUserId ? tx.user.findUnique({ where: { id: p.sellerUserId }, select: { id: true, name: true } }) : null,
        p?.paymentTermId ? tx.paymentTerm.findUnique({ where: { id: p.paymentTermId }, select: { id: true, name: true } }) : null,
        this.creditStatus(tx, c.id, dec(0)),
      ]);
      const address = await tx.partyAddress.findFirst({ where: { partyId: c.id }, orderBy: { isDefault: 'desc' } });
      // Depósito de despacho sugerido: el configurado o, si no hay, el propio con más prendas en stock.
      let defaultWarehouseId = await readSetting<string | null>(tx, ctx.companyId, 'sales.defaultWarehouseId', null);
      if (!defaultWarehouseId) {
        const rows = await tx.$queryRaw<{ warehouse_id: string }[]>`
          SELECT b.warehouse_id FROM stock_balances b
          JOIN items i ON i.id = b.item_id AND i.kind = 'VARIANT'
          JOIN warehouses w ON w.id = b.warehouse_id AND w.type = 'OWN' AND w.is_active
          GROUP BY b.warehouse_id ORDER BY SUM(b.on_hand) DESC LIMIT 1`;
        defaultWarehouseId = rows[0]?.warehouse_id ?? null;
      }
      return {
        id: c.id,
        legalName: c.legalName,
        taxCondition: c.taxCondition,
        discountPct: p?.discountPct.toString() ?? '0',
        priceList,
        seller,
        paymentTerm: term,
        deliveryAddress: address ? [address.street, address.city, address.province].filter(Boolean).join(', ') : null,
        defaultWarehouseId,
        credit: { limit: credit.limit?.toFixed(2) ?? null, balance: credit.balance.toFixed(2), openOrders: credit.openOrders.toFixed(2), available: credit.limit ? credit.limit.minus(credit.exposure).toFixed(2) : null },
      };
    });
  }

  list(ctx: RequestContext, q: { status?: string; customerId?: string; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.SalesOrderWhereInput = {
        ...(q.status === 'OPEN' ? { status: { in: OPEN_STATUSES } } : q.status ? { status: q.status as SalesOrderStatus } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.salesOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { lines: true } }),
        tx.salesOrder.count({ where }),
      ]);
      const [parties, users] = await Promise.all([
        tx.party.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, legalName: true } }),
        tx.user.findMany({ where: { id: { in: rows.map((r) => r.sellerUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      ]);
      return {
        total,
        rows: rows.map(({ lines, ...r }) => ({
          ...r,
          netTotal: r.netTotal.toString(),
          total: r.total.toString(),
          customer: parties.find((p) => p.id === r.customerId)?.legalName,
          seller: users.find((u) => u.id === r.sellerUserId)?.name ?? null,
          units: lines.reduce((a, l) => a.plus(l.qty.toString()), dec(0)).toString(),
          pendingUnits: lines.reduce((a, l) => a.plus(linePending(l)), dec(0)).toString(),
        })),
      };
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, id));
  }

  async detailInTx(tx: Tx, id: string) {
    const o = await tx.salesOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!o) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El pedido no existe.', 404);
    const [items, customer, warehouse, priceList, seller, deliveries, approver] = await Promise.all([
      tx.item.findMany({ where: { id: { in: o.lines.map((l) => l.itemId) } }, select: { id: true, sku: true, name: true, variant: { select: { productId: true } } } }),
      tx.party.findUnique({ where: { id: o.customerId }, select: { id: true, code: true, legalName: true, taxCondition: true, customerProfile: true } }),
      tx.warehouse.findUnique({ where: { id: o.warehouseId }, select: { id: true, name: true } }),
      o.priceListId ? tx.priceList.findUnique({ where: { id: o.priceListId }, select: { id: true, name: true, includesVat: true } }) : null,
      o.sellerUserId ? tx.user.findUnique({ where: { id: o.sellerUserId }, select: { id: true, name: true } }) : null,
      tx.deliveryNote.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, number: true, issueDate: true, status: true, invoiceId: true } }),
      o.creditApprovedBy ? tx.user.findUnique({ where: { id: o.creditApprovedBy }, select: { name: true } }) : null,
    ]);
    const reservations = await tx.stockReservation.findMany({ where: { id: { in: o.lines.map((l) => l.reservationId).filter((x): x is string => !!x) } } });
    const promotions = await tx.promotion.findMany({ where: { id: { in: o.lines.map((l) => l.promotionId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const balances = await tx.stockBalance.groupBy({ by: ['itemId'], where: { itemId: { in: o.lines.map((l) => l.itemId) }, warehouseId: o.warehouseId }, _sum: { onHand: true, reserved: true } });
    const totals = salesTotals(o.lines.map((l) => ({ qty: l.qty.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), vatRate: l.vatRate.toString() })));
    const credit = OPEN_STATUSES.includes(o.status) || o.status === 'DRAFT' ? await this.creditStatus(tx, o.customerId, o.status === 'DRAFT' ? dec(o.total.toString()) : dec(0)) : null;
    return {
      ...o,
      netTotal: o.netTotal.toString(),
      total: o.total.toString(),
      vatTotal: totals.vatTotal.toString(),
      customer: customer && { ...customer, customerProfile: undefined, creditLimit: customer.customerProfile?.creditLimit?.toString() ?? null },
      warehouse,
      priceList,
      seller,
      deliveries,
      creditApprover: approver?.name ?? null,
      credit: credit && { exceeded: credit.exceeded, excess: credit.excess.toFixed(2), exposure: credit.exposure.toFixed(2), limit: credit.limit?.toFixed(2) ?? null, balance: credit.balance.toFixed(2) },
      lines: o.lines.map((l, i) => {
        const r = reservations.find((x) => x.id === l.reservationId);
        const b = balances.find((x) => x.itemId === l.itemId);
        const item = items.find((x) => x.id === l.itemId);
        return {
          ...l,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
          discountPct: l.discountPct.toString(),
          vatRate: l.vatRate.toString(),
          deliveredQty: l.deliveredQty.toString(),
          cancelledQty: l.cancelledQty.toString(),
          pendingQty: linePending(l).toString(),
          reservedQty: r && r.status === 'ACTIVE' ? dec(r.qty.toString()).minus(r.consumedQty.toString()).toString() : '0',
          availableQty: dec(b?._sum.onHand?.toString() ?? '0').minus(b?._sum.reserved?.toString() ?? '0').toString(),
          net: totals.lines[i]!.net.toString(),
          sku: item?.sku,
          name: item?.name,
          productId: item?.variant?.productId,
          promotionName: promotions.find((p) => p.id === l.promotionId)?.name ?? null,
        };
      }),
    };
  }
}
