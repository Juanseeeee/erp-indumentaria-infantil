import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeliveryCreateInput } from '@erp/contracts';
import { DomainError, ErrorCodes, dec, roundUnitCost } from '@erp/domain-core';
import { orderStatusFromLines, salesTotals } from '@erp/domain-sales';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { businessDate } from '../common/dates';
import { StockService } from '../inventory/stock.service';
import { linePending } from './sales-orders.service';

/**
 * Remitos. Son la única salida de stock por venta: consumen la reserva del pedido (y, si hay,
 * stock libre) y guardan el costo de salida. Se anulan por reversa mientras no estén facturados.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  private async refreshOrderStatus(tx: Tx, orderId: string) {
    const lines = await tx.salesOrderLine.findMany({ where: { orderId } });
    const status = orderStatusFromLines(lines.map((l) => ({ qty: l.qty.toString(), deliveredQty: l.deliveredQty.toString(), cancelledQty: l.cancelledQty.toString() })));
    await tx.salesOrder.update({ where: { id: orderId }, data: { status, version: { increment: 1 } } });
    return status;
  }

  create(ctx: RequestContext, input: DeliveryCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_orders WHERE id = ${input.orderId}::uuid FOR UPDATE`;
        if (!rows.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El pedido no existe.', 404);
        const order = await tx.salesOrder.findUniqueOrThrow({ where: { id: input.orderId }, include: { lines: true } });
        if (!['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(order.status)) {
          throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, order.status === 'DRAFT' ? 'Confirmá el pedido antes de despachar.' : 'El pedido no tiene pendientes de entrega.');
        }
        const number = `R-${await this.numbering.next(tx, ctx.companyId, 'DELIVERY_NOTE', '', 8)}`;
        const note = await tx.deliveryNote.create({
          data: {
            companyId: ctx.companyId,
            number,
            customerId: order.customerId,
            orderId: order.id,
            warehouseId: order.warehouseId,
            issueDate: input.issueDate ?? businessDate(),
            carrier: input.carrier,
            packages: input.packages ?? null,
            notes: input.notes,
            createdBy: ctx.userId,
          },
        });
        await this.stock.prelock(tx, ctx.companyId, input.lines.map((l) => ({ itemId: order.lines.find((x) => x.id === l.orderLineId)?.itemId ?? l.orderLineId, warehouseId: order.warehouseId })));
        for (const l of input.lines) {
          const ol = order.lines.find((x) => x.id === l.orderLineId);
          if (!ol) throw new DomainError(ErrorCodes.VALIDACION, 'Hay líneas que no pertenecen al pedido.');
          const pending = linePending(ol);
          if (dec(l.qty).gt(pending)) {
            const item = await tx.item.findUnique({ where: { id: ol.itemId }, select: { sku: true } });
            throw new DomainError(ErrorCodes.VALIDACION, `${item?.sku}: se entregan ${l.qty} y quedan ${pending.toString()} pendientes.`);
          }
          const line = await tx.deliveryNoteLine.create({
            data: {
              companyId: ctx.companyId,
              deliveryId: note.id,
              orderLineId: ol.id,
              itemId: ol.itemId,
              qty: l.qty,
              unitPrice: ol.unitPrice,
              discountPct: ol.discountPct,
              vatRate: ol.vatRate,
            },
          });
          const moves = await this.stock.moveOutFifo(tx, ctx, {
            itemId: ol.itemId,
            warehouseId: order.warehouseId,
            type: 'SALE_DELIVERY',
            qty: dec(l.qty).negated().toString(),
            reservationId: ol.reservationId,
            sourceDocType: 'DELIVERY_NOTE',
            sourceDocId: note.id,
            sourceLineId: line.id,
            reason: `Remito ${number}`,
          });
          const cost = moves.reduce((a, m) => a.plus(m.totalCost.toString()), dec(0)).abs();
          await tx.deliveryNoteLine.update({ where: { id: line.id }, data: { unitCost: roundUnitCost(cost.div(l.qty)).toString() } });
          await tx.salesOrderLine.update({ where: { id: ol.id }, data: { deliveredQty: { increment: l.qty } } });
        }
        const status = await this.refreshOrderStatus(tx, order.id);
        await this.audit.log(tx, ctx, { entity: 'delivery_note', entityId: note.id, action: 'create', diff: { number, order: order.number, orderStatus: status } });
        return this.detailInTx(tx, note.id);
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  /** Anula el remito: reingresa cada movimiento con su lote y costo, y deja lo entregado otra vez pendiente. */
  void(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM delivery_notes WHERE id = ${id}::uuid FOR UPDATE`;
      if (!rows.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El remito no existe.', 404);
      const note = await tx.deliveryNote.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (note.status === 'VOIDED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El remito ya está anulado.');
      if (note.invoiceId) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El remito ya está facturado: la devolución se hace con una nota de crédito.');
      if (note.orderId) await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${note.orderId}::uuid FOR UPDATE`;
      const moves = await tx.stockMovement.findMany({ where: { sourceDocType: 'DELIVERY_NOTE', sourceDocId: id }, orderBy: { occurredAt: 'asc' } });
      await this.stock.prelock(tx, ctx.companyId, moves.map((m) => ({ itemId: m.itemId, warehouseId: m.warehouseId, lotId: m.lotId })));
      for (const m of moves) {
        await this.stock.move(tx, ctx, {
          itemId: m.itemId,
          warehouseId: m.warehouseId,
          lotId: m.lotId,
          type: 'SALE_RETURN',
          qty: m.qty.negated().toString(),
          unitCost: m.unitCost.toString(),
          sourceDocType: 'DELIVERY_NOTE_VOID',
          sourceDocId: id,
          sourceLineId: m.sourceLineId,
          reason: `Anulación del remito ${note.number}: ${reason}`,
        });
      }
      for (const l of note.lines) {
        if (l.orderLineId) await tx.salesOrderLine.update({ where: { id: l.orderLineId }, data: { deliveredQty: { decrement: l.qty } } });
      }
      await tx.deliveryNote.update({ where: { id }, data: { status: 'VOIDED', voidReason: reason } });
      if (note.orderId) await this.refreshOrderStatus(tx, note.orderId);
      await this.audit.log(tx, ctx, { entity: 'delivery_note', entityId: id, action: 'void', reason });
      return this.detailInTx(tx, id);
    });
  }

  list(ctx: RequestContext, q: { customerId?: string; pendingInvoice?: boolean; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.DeliveryNoteWhereInput = {
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.pendingInvoice ? { status: 'ISSUED', invoiceId: null } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.deliveryNote.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { lines: true } }),
        tx.deliveryNote.count({ where }),
      ]);
      const [parties, orders, invoices] = await Promise.all([
        tx.party.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, legalName: true } }),
        tx.salesOrder.findMany({ where: { id: { in: rows.map((r) => r.orderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
        tx.fiscalDocument.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, docType: true, pointOfSale: true, number: true, status: true } }),
      ]);
      return {
        total,
        rows: rows.map(({ lines, ...r }) => {
          const t = salesTotals(lines.map((l) => ({ qty: l.qty.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), vatRate: l.vatRate.toString() })));
          return {
            ...r,
            customer: parties.find((p) => p.id === r.customerId)?.legalName,
            order: orders.find((o) => o.id === r.orderId)?.number ?? null,
            invoice: invoices.find((i) => i.id === r.invoiceId) ?? null,
            units: lines.reduce((a, l) => a.plus(l.qty.toString()), dec(0)).toString(),
            netTotal: t.netTotal.toString(),
            total: t.total.toString(),
          };
        }),
      };
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, id));
  }

  private async detailInTx(tx: Tx, id: string) {
    const n = await tx.deliveryNote.findUnique({ where: { id }, include: { lines: true } });
    if (!n) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El remito no existe.', 404);
    const [items, customer, warehouse, order, invoice, company] = await Promise.all([
      tx.item.findMany({ where: { id: { in: n.lines.map((l) => l.itemId) } }, select: { id: true, sku: true, name: true, barcode: true } }),
      tx.party.findUnique({ where: { id: n.customerId }, select: { id: true, code: true, legalName: true, taxId: true, taxCondition: true, addresses: true } }),
      tx.warehouse.findUnique({ where: { id: n.warehouseId }, select: { id: true, name: true } }),
      n.orderId ? tx.salesOrder.findUnique({ where: { id: n.orderId }, select: { id: true, number: true, deliveryAddress: true } }) : null,
      n.invoiceId ? tx.fiscalDocument.findUnique({ where: { id: n.invoiceId }, select: { id: true, docType: true, pointOfSale: true, number: true, status: true } }) : null,
      tx.company.findUnique({ where: { id: n.companyId }, select: { legalName: true, cuit: true, address: true, taxCondition: true } }),
    ]);
    return {
      ...n,
      customer,
      warehouse,
      order,
      invoice,
      company,
      lines: n.lines.map((l) => {
        const item = items.find((i) => i.id === l.itemId);
        return { ...l, qty: l.qty.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), vatRate: l.vatRate.toString(), unitCost: undefined, sku: item?.sku, name: item?.name, barcode: item?.barcode };
      }),
    };
  }
}
