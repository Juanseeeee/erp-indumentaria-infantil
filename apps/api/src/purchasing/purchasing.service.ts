import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { DomainError, ErrorCodes, computeInvoiceTotals, dec, priceDeviationPct, roundMoney } from '@erp/domain-core';
import {
  GoodsReceiptCreateInput,
  PurchaseOrderCreateInput,
  PurchaseRequestCreateSchema,
  SupplierInvoiceCreateInput,
} from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { StockService } from '../inventory/stock.service';
import { AccountsService } from '../accounts/accounts.service';

const NC_TYPES = new Set(['NCA', 'NCB', 'NCC']);

@Injectable()
export class PurchasingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly accounts: AccountsService,
  ) {}

  private async setting<T>(tx: Tx, companyId: string, key: string, fallback: T): Promise<T> {
    const s = await tx.setting.findUnique({ where: { companyId_key: { companyId, key } } });
    return (s?.value as T) ?? fallback;
  }

  private async assertSupplier(tx: Tx, partyId: string) {
    const p = await tx.party.findUnique({ where: { id: partyId }, include: { roles: true } });
    if (!p || !p.roles.some((r) => r.role === 'SUPPLIER' || r.role === 'WORKSHOP')) {
      throw new DomainError(ErrorCodes.VALIDACION, 'El tercero elegido no es proveedor.');
    }
    if (!p.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'El proveedor está inactivo.');
    return p;
  }

  // ─── Solicitudes ───

  createRequest(ctx: RequestContext, input: z.infer<typeof PurchaseRequestCreateSchema>, origin: 'MANUAL' | 'PRODUCTION' | 'MIN_STOCK' = 'MANUAL') {
    return this.uow.run(ctx, (tx) => this.createRequestInTx(tx, ctx, input, origin), { idempotent: true });
  }

  async createRequestInTx(tx: Tx, ctx: RequestContext, input: z.infer<typeof PurchaseRequestCreateSchema>, origin: 'MANUAL' | 'PRODUCTION' | 'MIN_STOCK') {
    const number = `SC-${await this.numbering.next(tx, ctx.companyId, 'PURCHASE_REQUEST', '', 6)}`;
    const materials = await tx.material.findMany({ where: { itemId: { in: input.lines.map((l) => l.itemId) } } });
    const req = await tx.purchaseRequest.create({
      data: {
        companyId: ctx.companyId,
        number,
        origin,
        productionOrderId: input.productionOrderId ?? null,
        neededBy: input.neededBy,
        notes: input.notes,
        createdBy: ctx.userId,
        lines: {
          create: input.lines.map((l) => ({
            companyId: ctx.companyId,
            itemId: l.itemId,
            qty: l.qty,
            supplierId: l.supplierId ?? materials.find((m) => m.itemId === l.itemId)?.defaultSupplierId ?? null,
          })),
        },
      },
      include: { lines: true },
    });
    await this.audit.log(tx, ctx, { entity: 'purchase_request', entityId: req.id, action: 'create', diff: { number, origin } });
    return req;
  }

  listRequests(ctx: RequestContext, status?: string) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.purchaseRequest.findMany({
        where: status ? { status: status as never } : {},
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return this.withItemsAndParties(tx, rows, (r) => r.lines.map((l) => l.itemId), (r) => r.lines.map((l) => l.supplierId));
    });
  }

  cancelRequest(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const r = await tx.purchaseRequest.findUniqueOrThrow({ where: { id } });
      if (r.status !== 'OPEN') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Solo se pueden cancelar solicitudes abiertas.');
      await tx.purchaseRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, ctx, { entity: 'purchase_request', entityId: id, action: 'cancel' });
      return { id, status: 'CANCELLED' };
    });
  }

  // ─── Órdenes de compra ───

  createOrder(ctx: RequestContext, input: PurchaseOrderCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await this.assertSupplier(tx, input.supplierId);
        const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
        if (items.length !== new Set(input.lines.map((l) => l.itemId)).size) throw new DomainError(ErrorCodes.VALIDACION, 'Hay artículos inexistentes.');
        const net = roundMoney(input.lines.reduce((a, l) => a.plus(dec(l.qty).times(l.unitPrice)), dec(0)));
        const number = `OC-${await this.numbering.next(tx, ctx.companyId, 'PURCHASE_ORDER', '', 6)}`;
        const needsApproval = await this.needsApproval(tx, ctx, net.toString());
        const po = await tx.purchaseOrder.create({
          data: {
            companyId: ctx.companyId,
            number,
            supplierId: input.supplierId,
            warehouseId: input.warehouseId,
            expectedAt: input.expectedAt,
            notes: input.notes,
            netTotal: net.toString(),
            status: needsApproval ? 'DRAFT' : 'APPROVED',
            approvedBy: needsApproval ? null : ctx.userId,
            createdBy: ctx.userId,
            lines: {
              create: input.lines.map((l) => ({ companyId: ctx.companyId, itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, vatRate: l.vatRate })),
            },
          },
          include: { lines: true },
        });
        // Vincula las líneas de solicitud que originaron la OC.
        if (input.requestLineIds?.length) {
          const reqLines = await tx.purchaseRequestLine.findMany({ where: { id: { in: input.requestLineIds } } });
          for (const rl of reqLines) {
            const pol = po.lines.find((l) => l.itemId === rl.itemId);
            await tx.purchaseRequestLine.update({ where: { id: rl.id }, data: { poLineId: pol?.id ?? null } });
          }
          for (const requestId of new Set(reqLines.map((r) => r.requestId))) {
            const pending = await tx.purchaseRequestLine.count({ where: { requestId, poLineId: null } });
            if (!pending) await tx.purchaseRequest.update({ where: { id: requestId }, data: { status: 'ORDERED' } });
          }
        }
        await this.audit.log(tx, ctx, { entity: 'purchase_order', entityId: po.id, action: 'create', diff: { number, net: net.toString(), status: po.status } });
        return po;
      },
      { idempotent: true },
    );
  }

  private async needsApproval(tx: Tx, ctx: RequestContext, amount: string) {
    if (can(ctx, 'purchasing.approve')) return false;
    const rule = await tx.approvalRule.findFirst({ where: { actionCode: 'purchasing.order', isActive: true } });
    return !!rule && dec(amount).gt(rule.threshold.toString());
  }

  approveOrder(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const po = await this.lockOrder(tx, id);
      if (po.status !== 'DRAFT') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La orden no está pendiente de aprobación.');
      if (po.createdBy === ctx.userId) throw new DomainError(ErrorCodes.SIN_PERMISO, 'Una orden no puede aprobarla quien la cargó.', 403);
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'APPROVED', approvedBy: ctx.userId, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { entity: 'purchase_order', entityId: id, action: 'approve' });
      return this.getOrderInTx(tx, id);
    });
  }

  cancelOrder(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      const po = await this.lockOrder(tx, id);
      if (!['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La orden ya está cerrada o cancelada.');
      }
      // Con recepciones parciales se cierra (lo pendiente se cancela); sin recepciones se cancela.
      const status: PurchaseOrderStatus = po.status === 'PARTIALLY_RECEIVED' ? 'CLOSED' : 'CANCELLED';
      await tx.purchaseOrder.update({ where: { id }, data: { status, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { entity: 'purchase_order', entityId: id, action: status === 'CLOSED' ? 'close' : 'cancel', reason });
      return this.getOrderInTx(tx, id);
    });
  }

  listOrders(ctx: RequestContext, q: { status?: string; supplierId?: string; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.PurchaseOrderWhereInput = {
        ...(q.status === 'PENDING' ? { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } : q.status ? { status: q.status as PurchaseOrderStatus } : {}),
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { lines: true } } } }),
        tx.purchaseOrder.count({ where }),
      ]);
      const parties = await tx.party.findMany({ where: { id: { in: rows.map((r) => r.supplierId) } }, select: { id: true, legalName: true } });
      return { total, rows: rows.map((r) => ({ ...r, supplier: parties.find((p) => p.id === r.supplierId)?.legalName })) };
    });
  }

  getOrder(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.getOrderInTx(tx, id));
  }

  private async getOrderInTx(tx: Tx, id: string) {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!po) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La orden de compra no existe.', 404);
    const [items, supplier, receipts] = await Promise.all([
      tx.item.findMany({ where: { id: { in: po.lines.map((l) => l.itemId) } }, select: { id: true, sku: true, name: true, baseUomId: true, trackLots: true } }),
      tx.party.findUnique({ where: { id: po.supplierId }, select: { id: true, legalName: true, code: true } }),
      tx.goodsReceipt.findMany({ where: { purchaseOrderId: id }, select: { id: true, number: true, receivedAt: true } }),
    ]);
    return { ...po, items, supplier, receipts };
  }

  private async lockOrder(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La orden de compra no existe.', 404);
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  }

  // ─── Recepciones (únicas que mueven stock) ───

  createReceipt(ctx: RequestContext, input: GoodsReceiptCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await this.assertSupplier(tx, input.supplierId);
        const tolerancePct = dec(String(await this.setting(tx, ctx.companyId, 'purchasing.overReceiptPct', 5)));
        let po: Awaited<ReturnType<PurchasingService['lockOrder']>> | null = null;
        if (input.purchaseOrderId) {
          po = await this.lockOrder(tx, input.purchaseOrderId);
          if (po.supplierId !== input.supplierId) throw new DomainError(ErrorCodes.VALIDACION, 'La orden de compra es de otro proveedor.');
          if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
            throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, po.status === 'DRAFT' ? 'La orden de compra todavía no está aprobada.' : 'La orden de compra ya no admite recepciones.');
          }
        }
        const number = `RE-${await this.numbering.next(tx, ctx.companyId, 'GOODS_RECEIPT', '', 6)}`;
        const receipt = await tx.goodsReceipt.create({
          data: {
            companyId: ctx.companyId,
            number,
            supplierId: input.supplierId,
            warehouseId: input.warehouseId,
            purchaseOrderId: po?.id ?? null,
            supplierDeliveryNote: input.supplierDeliveryNote,
            notes: input.notes,
            createdBy: ctx.userId,
          },
        });
        await this.stock.prelock(tx, ctx.companyId, input.lines.map((l) => ({ itemId: l.itemId, warehouseId: input.warehouseId })));

        for (const l of input.lines) {
          let unitCost = l.unitCost ?? null;
          if (l.poLineId) {
            const pol = po?.lines.find((x) => x.id === l.poLineId);
            if (!pol || pol.itemId !== l.itemId) throw new DomainError(ErrorCodes.VALIDACION, 'Hay líneas que no pertenecen a la orden de compra.');
            const pending = dec(pol.qty.toString()).minus(pol.receivedQty.toString());
            const max = dec(pol.qty.toString()).times(tolerancePct.div(100)).plus(pending);
            if (dec(l.qty).gt(max)) {
              throw new DomainError(
                ErrorCodes.VALIDACION,
                `Se recibe más de lo pedido (pendiente ${pending.toString()}, tolerancia ${tolerancePct.toString()} %). Ajustá la orden de compra o registrá la diferencia.`,
              );
            }
            unitCost ??= pol.unitPrice.toString();
            await tx.purchaseOrderLine.update({ where: { id: pol.id }, data: { receivedQty: { increment: l.qty } } });
          }
          if (unitCost === null) throw new DomainError(ErrorCodes.VALIDACION, 'Indicá el costo unitario de las líneas sin orden de compra.');
          const item = await tx.item.findUniqueOrThrow({ where: { id: l.itemId }, select: { trackLots: true, sku: true } });
          if (item.trackLots && !l.lotCode) {
            throw new DomainError(ErrorCodes.VALIDACION, `${item.sku} se controla por partida: indicá el lote o partida recibida.`);
          }
          const lotId = l.lotCode ? await this.resolveLot(tx, ctx.companyId, l.itemId, l.lotCode) : null;
          const line = await tx.goodsReceiptLine.create({
            data: { companyId: ctx.companyId, receiptId: receipt.id, poLineId: l.poLineId ?? null, itemId: l.itemId, qty: l.qty, unitCost, lotId },
          });
          await this.stock.move(tx, ctx, {
            itemId: l.itemId,
            warehouseId: input.warehouseId,
            lotId,
            type: 'PURCHASE_RECEIPT',
            qty: l.qty,
            unitCost,
            sourceDocType: 'GOODS_RECEIPT',
            sourceDocId: receipt.id,
            sourceLineId: line.id,
            reason: `Recepción ${number}`,
          });
          await tx.material.updateMany({ where: { itemId: l.itemId }, data: { lastCost: unitCost } });
        }
        if (po) {
          const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: po.id } });
          const complete = lines.every((x) => dec(x.receivedQty.toString()).gte(x.qty.toString()));
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', version: { increment: 1 } } });
        }
        await this.audit.log(tx, ctx, { entity: 'goods_receipt', entityId: receipt.id, action: 'create', diff: { number, purchaseOrder: po?.number ?? null } });
        return tx.goodsReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { lines: true } });
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  private async resolveLot(tx: Tx, companyId: string, itemId: string, code: string) {
    const existing = await tx.lot.findUnique({ where: { companyId_itemId_code: { companyId, itemId, code } } });
    return existing?.id ?? (await tx.lot.create({ data: { companyId, itemId, code } })).id;
  }

  listReceipts(ctx: RequestContext, q: { supplierId?: string; pendingInvoice?: boolean }) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.goodsReceipt.findMany({
        where: { ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
        include: { lines: true },
        orderBy: { receivedAt: 'desc' },
        take: 200,
      });
      const filtered = q.pendingInvoice ? rows.filter((r) => r.lines.some((l) => dec(l.invoicedQty.toString()).lt(l.qty.toString()))) : rows;
      return this.withItemsAndParties(tx, filtered, (r) => r.lines.map((l) => l.itemId), (r) => [r.supplierId]);
    });
  }

  getReceipt(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const r = await tx.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
      if (!r) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La recepción no existe.', 404);
      const [enriched] = await this.withItemsAndParties(tx, [r], (x) => x.lines.map((l) => l.itemId), (x) => [x.supplierId]);
      const lots = await tx.lot.findMany({ where: { id: { in: r.lines.map((l) => l.lotId).filter((x): x is string => !!x) } } });
      const po = r.purchaseOrderId ? await tx.purchaseOrder.findUnique({ where: { id: r.purchaseOrderId }, select: { id: true, number: true } }) : null;
      return { ...enriched, lots, purchaseOrder: po };
    });
  }

  // ─── Comprobantes de proveedor ───

  createInvoice(ctx: RequestContext, input: SupplierInvoiceCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const supplier = await this.assertSupplier(tx, input.supplierId);
        const dup = await tx.fiscalDocument.findFirst({
          where: { direction: 'PURCHASE', partyId: input.supplierId, docType: input.docType, pointOfSale: input.pointOfSale, number: input.number },
        });
        if (dup) {
          throw new DomainError(
            ErrorCodes.DUPLICADO,
            `El comprobante ${input.docType} ${String(input.pointOfSale).padStart(5, '0')}-${String(input.number).padStart(8, '0')} de ${supplier.legalName} ya está cargado.`,
            409,
            { existingId: dup.id },
          );
        }
        const tolerance = dec(String(await this.setting(tx, ctx.companyId, 'purchasing.priceTolerancePct', 2)));
        const warnings: string[] = [];
        for (const l of input.lines) {
          if (!l.receiptLineId) continue;
          const rl = await tx.goodsReceiptLine.findUnique({ where: { id: l.receiptLineId }, include: { receipt: true } });
          if (!rl || rl.receipt.supplierId !== input.supplierId) throw new DomainError(ErrorCodes.VALIDACION, 'Hay líneas vinculadas a recepciones de otro proveedor.');
          const pending = dec(rl.qty.toString()).minus(rl.invoicedQty.toString());
          if (!NC_TYPES.has(input.docType) && dec(l.qty).gt(pending)) {
            warnings.push(`${l.description}: se factura ${l.qty} y quedaban ${pending.toString()} recibidos sin facturar.`);
          }
          const dev = priceDeviationPct(l.unitPrice, rl.unitCost.toString());
          if (dev.abs().gt(tolerance)) warnings.push(`${l.description}: precio ${dev.isPositive() ? '+' : ''}${dev.toString()} % respecto de lo recibido.`);
          await tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { invoicedQty: { increment: NC_TYPES.has(input.docType) ? dec(l.qty).negated().toString() : l.qty } } });
        }
        const totals = computeInvoiceTotals(input.lines, input.otherTaxes);
        const sign = NC_TYPES.has(input.docType) ? -1 : 1;
        const dueDate = input.dueDate ?? (await this.accounts.defaultDueDate(tx, input.supplierId, input.issueDate));
        const doc = await tx.fiscalDocument.create({
          data: {
            companyId: ctx.companyId,
            direction: 'PURCHASE',
            partyId: input.supplierId,
            docType: input.docType,
            pointOfSale: input.pointOfSale,
            number: input.number,
            issueDate: input.issueDate,
            dueDate,
            netTotal: totals.netTotal.toString(),
            vatTotal: totals.vatTotal.toString(),
            otherTaxes: totals.otherTaxes.toString(),
            total: totals.total.toString(),
            sourceType: 'SUPPLIER_INVOICE',
            notes: input.notes,
            warnings,
            createdBy: ctx.userId,
            lines: {
              create: input.lines.map((l, i) => ({
                companyId: ctx.companyId,
                itemId: l.itemId ?? null,
                description: l.description,
                qty: l.qty,
                unitPrice: l.unitPrice,
                vatRate: l.vatRate,
                net: totals.lines[i]!.net.toString(),
                vat: totals.lines[i]!.vat.toString(),
                receiptLineId: l.receiptLineId ?? null,
              })),
            },
          },
        });
        const label = `${input.docType} ${String(input.pointOfSale).padStart(5, '0')}-${String(input.number).padStart(8, '0')}`;
        await this.accounts.post(tx, ctx, {
          partyId: input.supplierId,
          accountType: 'PAYABLE',
          entryType: sign > 0 ? 'INVOICE' : 'CREDIT_NOTE',
          sourceDocType: 'FISCAL_DOCUMENT',
          sourceDocId: doc.id,
          description: label,
          date: input.issueDate,
          dueDate,
          amount: totals.total.times(sign).toString(),
        });
        await this.audit.log(tx, ctx, { entity: 'fiscal_document', entityId: doc.id, action: 'create', diff: { label, total: totals.total.toString(), warnings } });
        return { ...doc, warnings };
      },
      { idempotent: true },
    );
  }

  listInvoices(ctx: RequestContext, q: { supplierId?: string; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.FiscalDocumentWhereInput = { direction: 'PURCHASE', ...(q.supplierId ? { partyId: q.supplierId } : {}) };
      const [rows, total] = await Promise.all([
        tx.fiscalDocument.findMany({ where, orderBy: { issueDate: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.fiscalDocument.count({ where }),
      ]);
      const parties = await tx.party.findMany({ where: { id: { in: rows.map((r) => r.partyId) } }, select: { id: true, legalName: true } });
      return { total, rows: rows.map((r) => ({ ...r, party: parties.find((p) => p.id === r.partyId)?.legalName })) };
    });
  }

  getInvoice(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const d = await tx.fiscalDocument.findUnique({ where: { id }, include: { lines: true } });
      if (!d) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El comprobante no existe.', 404);
      const party = await tx.party.findUnique({ where: { id: d.partyId }, select: { id: true, legalName: true, code: true } });
      return { ...d, party };
    });
  }

  private async withItemsAndParties<T>(tx: Tx, rows: T[], itemIds: (r: T) => string[], partyIds: (r: T) => (string | null)[]) {
    const items = await tx.item.findMany({ where: { id: { in: [...new Set(rows.flatMap(itemIds))] } }, select: { id: true, sku: true, name: true } });
    const parties = await tx.party.findMany({
      where: { id: { in: [...new Set(rows.flatMap(partyIds).filter((x): x is string => !!x))] } },
      select: { id: true, legalName: true },
    });
    return rows.map((r) => ({ ...r, items, parties }));
  }
}
