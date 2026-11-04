import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreditNoteCreateInput, DebitNoteCreateInput, SalesInvoiceCreateInput } from '@erp/contracts';
import { DomainError, ErrorCodes, dec, roundMoney, roundUnitCost } from '@erp/domain-core';
import { SALES_DOC_LABELS, TaxCond, buildFeCaeDetail, docKind, docLetter, invoiceLetter, receivableSign, salesDocType, salesTotals } from '@erp/domain-sales';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, readSetting } from '../common/common.service';
import { businessDate } from '../common/dates';
import { StockService } from '../inventory/stock.service';
import { AccountsService } from '../accounts/accounts.service';
import { AllocationsService } from '../accounts/allocations.service';
import { ArcaService } from './arca.service';
import { CommissionsService } from './commissions.service';

export const docLabel = (d: { docType: string; pointOfSale: number; number: number | null }) =>
  `${d.docType} ${String(d.pointOfSale).padStart(5, '0')}-${d.number ? String(d.number).padStart(8, '0') : '(sin número)'}`;

interface DraftLine {
  itemId: string | null;
  description: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string;
  deliveryLineId?: string | null;
  relatedLineId?: string | null;
}

/**
 * Comprobantes de venta. Circuito en dos pasos para no perder ni duplicar números de ARCA:
 *  1. Se registra el comprobante "pendiente de CAE" y se reservan sus remitos (transacción corta).
 *  2. Se pide el CAE con el número siguiente al último autorizado, serializado por punto de venta y tipo.
 *     Aprobado: toma número, impacta en la cuenta corriente (y en stock si es una devolución).
 *     Rechazado: queda sin número ni efectos y libera los remitos. Error de red: queda pendiente y se reintenta.
 */
@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly accounts: AccountsService,
    private readonly allocations: AllocationsService,
    private readonly arca: ArcaService,
    private readonly commissions: CommissionsService,
  ) {}

  private async pointOfSale(tx: Tx, companyId: string) {
    const configured = await readSetting<number | null>(tx, companyId, 'sales.pointOfSale', null);
    if (configured) return Number(configured);
    const branch = await tx.branch.findFirst({ where: { isActive: true, arcaPointOfSale: { not: null } }, orderBy: { name: 'asc' } });
    if (!branch?.arcaPointOfSale) throw new DomainError(ErrorCodes.VALIDACION, 'Configurá el punto de venta de ARCA de la sucursal antes de facturar.');
    return branch.arcaPointOfSale;
  }

  private assertIssueDate(d: Date) {
    const today = businessDate();
    const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    // ARCA admite fechas hasta 5 días anteriores o posteriores para venta de productos.
    if (days > 5 || days < -5) throw new DomainError(ErrorCodes.VALIDACION, 'La fecha del comprobante puede estar como máximo 5 días antes o después de hoy.');
  }

  private async createPending(
    tx: Tx,
    ctx: RequestContext,
    h: { partyId: string; docType: string; pointOfSale: number; issueDate: Date; dueDate: Date | null; sourceType: string; notes: string | null; relatedDocumentId?: string | null; sellerUserId?: string | null; commissionPct?: string | null; returnWarehouseId?: string | null },
    lines: DraftLine[],
  ) {
    const totals = salesTotals(lines);
    if (totals.total.lte(0)) throw new DomainError(ErrorCodes.VALIDACION, 'El comprobante no puede quedar en cero.');
    return tx.fiscalDocument.create({
      data: {
        companyId: ctx.companyId,
        direction: 'SALE',
        partyId: h.partyId,
        docType: h.docType,
        pointOfSale: h.pointOfSale,
        number: null,
        issueDate: h.issueDate,
        dueDate: h.dueDate,
        netTotal: totals.netTotal.toString(),
        vatTotal: totals.vatTotal.toString(),
        total: totals.total.toString(),
        status: 'PENDING_AUTH',
        sourceType: h.sourceType,
        notes: h.notes,
        relatedDocumentId: h.relatedDocumentId ?? null,
        sellerUserId: h.sellerUserId ?? null,
        commissionPct: h.commissionPct ?? null,
        returnWarehouseId: h.returnWarehouseId ?? null,
        createdBy: ctx.userId,
        lines: {
          create: lines.map((l, i) => ({
            companyId: ctx.companyId,
            itemId: l.itemId,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            vatRate: l.vatRate,
            net: totals.lines[i]!.net.toString(),
            vat: totals.lines[i]!.vat.toString(),
            deliveryLineId: l.deliveryLineId ?? null,
            relatedLineId: l.relatedLineId ?? null,
          })),
        },
      },
    });
  }

  // ─── Facturas ───

  /** Factura uno o varios remitos del mismo cliente (el cliente todavía no definió si agrupa: se admiten ambos). */
  async createInvoice(ctx: RequestContext, input: SalesInvoiceCreateInput) {
    const doc = await this.uow.run(
      ctx,
      async (tx) => {
        const ids = [...new Set(input.deliveryIds)].sort();
        await tx.$queryRaw`SELECT id FROM delivery_notes WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
        const notes = await tx.deliveryNote.findMany({ where: { id: { in: ids } }, include: { lines: true }, orderBy: { number: 'asc' } });
        if (notes.length !== ids.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'Hay remitos inexistentes.', 404);
        for (const n of notes) {
          if (n.customerId !== input.customerId) throw new DomainError(ErrorCodes.VALIDACION, `El remito ${n.number} es de otro cliente.`);
          if (n.status !== 'ISSUED') throw new DomainError(ErrorCodes.VALIDACION, `El remito ${n.number} está anulado.`);
          if (n.invoiceId) throw new DomainError(ErrorCodes.DUPLICADO, `El remito ${n.number} ya está facturado.`, 409);
        }
        const [customer, company] = await Promise.all([
          tx.party.findUniqueOrThrow({ where: { id: input.customerId } }),
          tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } }),
        ]);
        const issueDate = input.issueDate ?? businessDate();
        this.assertIssueDate(issueDate);
        const items = await tx.item.findMany({ where: { id: { in: notes.flatMap((n) => n.lines.map((l) => l.itemId)) } }, select: { id: true, sku: true, name: true } });
        const lines: DraftLine[] = notes.flatMap((n) =>
          n.lines.map((l) => {
            const it = items.find((i) => i.id === l.itemId);
            return {
              itemId: l.itemId,
              description: `${it?.sku} ${it?.name} (remito ${n.number})`,
              qty: l.qty.toString(),
              unitPrice: l.unitPrice.toString(),
              discountPct: l.discountPct.toString(),
              vatRate: l.vatRate.toString(),
              deliveryLineId: l.id,
            };
          }),
        );
        const order = notes[0]!.orderId ? await tx.salesOrder.findUnique({ where: { id: notes[0]!.orderId } }) : null;
        const sellerUserId = order?.sellerUserId ?? (await tx.customerProfile.findUnique({ where: { partyId: customer.id } }))?.sellerUserId ?? null;
        const doc = await this.createPending(
          tx,
          ctx,
          {
            partyId: customer.id,
            docType: salesDocType('F', invoiceLetter(company.taxCondition, customer.taxCondition as TaxCond)),
            pointOfSale: await this.pointOfSale(tx, ctx.companyId),
            issueDate,
            dueDate: await this.accounts.defaultDueDate(tx, customer.id, issueDate, 'CUSTOMER', order?.paymentTermId),
            sourceType: 'DELIVERY_NOTES',
            notes: input.notes,
            sellerUserId,
            commissionPct: await this.commissions.currentPct(tx, ctx.companyId, sellerUserId),
          },
          lines,
        );
        await tx.deliveryNote.updateMany({ where: { id: { in: ids } }, data: { invoiceId: doc.id } });
        await this.audit.log(tx, ctx, { entity: 'fiscal_document', entityId: doc.id, action: 'create', diff: { docType: doc.docType, total: doc.total.toString(), deliveries: notes.map((n) => n.number) } });
        return doc;
      },
      { idempotent: true },
    );
    return this.authorize(ctx, doc.id);
  }

  // ─── Notas de crédito y débito ───

  private async lockInvoice(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM fiscal_documents WHERE id = ${id}::uuid FOR UPDATE`;
    const inv = await tx.fiscalDocument.findUnique({ where: { id }, include: { lines: true } });
    if (!inv || inv.direction !== 'SALE') throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La factura no existe.', 404);
    if (docKind(inv.docType) !== 'F') throw new DomainError(ErrorCodes.VALIDACION, 'Las notas de crédito y débito se emiten sobre una factura.');
    if (inv.status !== 'POSTED') throw new DomainError(ErrorCodes.VALIDACION, 'La factura todavía no está autorizada.');
    return inv;
  }

  async createCreditNote(ctx: RequestContext, input: CreditNoteCreateInput) {
    const doc = await this.uow.run(
      ctx,
      async (tx) => {
        const inv = await this.lockInvoice(tx, input.invoiceId);
        const issueDate = input.issueDate ?? businessDate();
        this.assertIssueDate(issueDate);
        if (input.returnWarehouseId) {
          const wh = await tx.warehouse.findUnique({ where: { id: input.returnWarehouseId } });
          if (!wh || !wh.isActive || wh.type === 'WORKSHOP') throw new DomainError(ErrorCodes.VALIDACION, 'Elegí un depósito propio para reingresar la mercadería.');
        }
        // Lo ya acreditado por línea (notas emitidas o pendientes de CAE).
        const credited = await tx.fiscalDocumentLine.groupBy({
          by: ['relatedLineId'],
          where: { relatedLineId: { in: inv.lines.map((l) => l.id) }, document: { status: { in: ['POSTED', 'PENDING_AUTH'] } } },
          _sum: { qty: true },
        });
        const lines: DraftLine[] = input.lines.map((l) => {
          const il = inv.lines.find((x) => x.id === l.invoiceLineId);
          if (!il) throw new DomainError(ErrorCodes.VALIDACION, 'Hay líneas que no son de la factura.');
          const done = dec(credited.find((c) => c.relatedLineId === il.id)?._sum.qty?.toString() ?? '0');
          const left = dec(il.qty.toString()).minus(done);
          if (dec(l.qty).gt(left)) throw new DomainError(ErrorCodes.VALIDACION, `${il.description}: se acreditan ${l.qty} y quedan ${left.toString()} sin acreditar.`);
          return { itemId: il.itemId, description: il.description, qty: l.qty, unitPrice: il.unitPrice.toString(), discountPct: il.discountPct.toString(), vatRate: il.vatRate.toString(), relatedLineId: il.id };
        });
        for (const c of input.concepts) lines.push({ itemId: null, description: c.description, qty: '1', unitPrice: c.net, discountPct: '0', vatRate: c.vatRate });
        const doc = await this.createPending(
          tx,
          ctx,
          {
            partyId: inv.partyId,
            docType: salesDocType('NC', docLetter(inv.docType)),
            pointOfSale: inv.pointOfSale,
            issueDate,
            dueDate: issueDate,
            sourceType: input.returnWarehouseId ? 'SALES_RETURN' : 'CREDIT_NOTE',
            notes: input.reason,
            relatedDocumentId: inv.id,
            returnWarehouseId: input.returnWarehouseId ?? null,
          },
          lines,
        );
        // No se puede acreditar más de lo facturado (sumando notas previas y débitos).
        const related = await tx.fiscalDocument.findMany({ where: { relatedDocumentId: inv.id, status: { in: ['POSTED', 'PENDING_AUTH'] } } });
        const net = related.reduce((a, d) => a.plus(dec(d.total.toString()).times(receivableSign(d.docType))), dec(inv.total.toString()));
        if (net.isNegative()) throw new DomainError(ErrorCodes.VALIDACION, `La nota de crédito supera el saldo de la factura en $ ${net.abs().toFixed(2)}.`);
        await this.audit.log(tx, ctx, { entity: 'fiscal_document', entityId: doc.id, action: 'create', diff: { docType: doc.docType, total: doc.total.toString(), invoice: docLabel(inv) }, reason: input.reason });
        return doc;
      },
      { idempotent: true },
    );
    return this.authorize(ctx, doc.id);
  }

  async createDebitNote(ctx: RequestContext, input: DebitNoteCreateInput) {
    const doc = await this.uow.run(
      ctx,
      async (tx) => {
        const inv = await this.lockInvoice(tx, input.invoiceId);
        const issueDate = input.issueDate ?? businessDate();
        this.assertIssueDate(issueDate);
        const doc = await this.createPending(
          tx,
          ctx,
          { partyId: inv.partyId, docType: salesDocType('ND', docLetter(inv.docType)), pointOfSale: inv.pointOfSale, issueDate, dueDate: issueDate, sourceType: 'DEBIT_NOTE', notes: input.reason, relatedDocumentId: inv.id },
          input.concepts.map((c) => ({ itemId: null, description: c.description, qty: '1', unitPrice: c.net, discountPct: '0', vatRate: c.vatRate })),
        );
        await this.audit.log(tx, ctx, { entity: 'fiscal_document', entityId: doc.id, action: 'create', diff: { docType: doc.docType, total: doc.total.toString(), invoice: docLabel(inv) }, reason: input.reason });
        return doc;
      },
      { idempotent: true },
    );
    return this.authorize(ctx, doc.id);
  }

  // ─── Autorización ───

  /** Pide el CAE. Idempotente: si ya no está pendiente devuelve el estado actual. */
  authorize(ctx: RequestContext, id: string) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM fiscal_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const doc = await tx.fiscalDocument.findUnique({ where: { id }, include: { lines: true } });
        if (!doc || doc.direction !== 'SALE') throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El comprobante no existe.', 404);
        if (doc.status !== 'PENDING_AUTH') return this.detailInTx(tx, id);
        // Serializa la numeración por punto de venta y tipo (como exige ARCA: correlativo y sin huecos).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arca:${ctx.companyId}:${doc.pointOfSale}:${doc.docType}`}))`;
        const provider = await this.arca.provider(tx, ctx.companyId);
        const number = (await provider.lastAuthorized(tx, ctx.companyId, doc.pointOfSale, doc.docType)) + 1;
        const [party, company, related] = await Promise.all([
          tx.party.findUniqueOrThrow({ where: { id: doc.partyId } }),
          tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } }),
          doc.relatedDocumentId ? tx.fiscalDocument.findUnique({ where: { id: doc.relatedDocumentId } }) : null,
        ]);
        const request = buildFeCaeDetail({
          docType: doc.docType,
          pointOfSale: doc.pointOfSale,
          number,
          issueDate: doc.issueDate,
          receiver: { taxIdType: party.taxIdType, taxId: party.taxId, taxCondition: party.taxCondition as TaxCond },
          netTotal: doc.netTotal.toString(),
          vatTotal: doc.vatTotal.toString(),
          otherTaxes: doc.otherTaxes.toString(),
          total: doc.total.toString(),
          lines: doc.lines.map((l) => ({ vatRate: l.vatRate.toString(), net: l.net.toString(), vat: l.vat.toString() })),
          associated: related ? { docType: related.docType, pointOfSale: related.pointOfSale, number: related.number!, issuerCuit: company.cuit, issueDate: related.issueDate } : null,
        });
        const result = await provider.authorize(tx, ctx.companyId, request, doc.id);
        if (!result.approved) {
          await tx.fiscalDocument.update({ where: { id }, data: { status: 'REJECTED', arcaMode: provider.mode, arcaResult: { messages: result.messages } as Prisma.InputJsonValue } });
          // Libera los remitos para volver a facturarlos.
          await tx.fiscalDocumentLine.updateMany({ where: { documentId: id }, data: { deliveryLineId: null } });
          await tx.deliveryNote.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
          await this.audit.log(tx, ctx, { entity: 'fiscal_document', entityId: id, action: 'arca_rejected', diff: { messages: result.messages } });
          return this.detailInTx(tx, id);
        }
        await tx.fiscalDocument.update({
          where: { id },
          data: { status: 'POSTED', number, cae: result.cae!, caeDueDate: result.caeDueDate!, arcaMode: provider.mode, arcaResult: { messages: result.messages } as Prisma.InputJsonValue },
        });
        const label = docLabel({ ...doc, number });
        const kind = docKind(doc.docType);
        const entry = await this.accounts.post(tx, ctx, {
          partyId: doc.partyId,
          accountType: 'RECEIVABLE',
          entryType: kind === 'F' ? 'INVOICE' : kind === 'NC' ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
          sourceDocType: 'FISCAL_DOCUMENT',
          sourceDocId: id,
          description: label,
          date: doc.issueDate,
          dueDate: doc.dueDate,
          amount: dec(doc.total.toString()).times(receivableSign(doc.docType)).toString(),
        });
        if (kind === 'NC') await this.afterCreditNote(tx, ctx, doc, entry.id, label);
        await this.audit.log(tx, ctx, { entity: 'fiscal_document', entityId: id, action: 'authorize', diff: { label, cae: result.cae, mode: provider.mode } });
        return this.detailInTx(tx, id);
      },
      { timeoutMs: 60_000 },
    );
  }

  /** Devolución: reingresa la mercadería al costo de salida. Luego aplica la nota a la factura. */
  private async afterCreditNote(tx: Tx, ctx: RequestContext, nc: Prisma.FiscalDocumentGetPayload<{ include: { lines: true } }>, entryId: string, label: string) {
    if (nc.returnWarehouseId) {
      const invLines = await tx.fiscalDocumentLine.findMany({ where: { id: { in: nc.lines.map((l) => l.relatedLineId).filter((x): x is string => !!x) } } });
      const dLines = await tx.deliveryNoteLine.findMany({ where: { id: { in: invLines.map((l) => l.deliveryLineId).filter((x): x is string => !!x) } } });
      const goods = nc.lines.filter((l) => l.itemId);
      await this.stock.prelock(tx, ctx.companyId, goods.map((l) => ({ itemId: l.itemId!, warehouseId: nc.returnWarehouseId! })));
      for (const l of goods) {
        const il = invLines.find((x) => x.id === l.relatedLineId);
        const dl = dLines.find((x) => x.id === il?.deliveryLineId);
        const unitCost = dl ? dl.unitCost.toString() : await this.stock.currentAvgCost(tx, l.itemId!, nc.returnWarehouseId);
        await this.stock.move(tx, ctx, {
          itemId: l.itemId!,
          warehouseId: nc.returnWarehouseId,
          type: 'SALE_RETURN',
          qty: l.qty.toString(),
          unitCost: roundUnitCost(unitCost).toString(),
          sourceDocType: 'FISCAL_DOCUMENT',
          sourceDocId: nc.id,
          sourceLineId: l.id,
          reason: `Devolución ${label}`,
        });
      }
    }
    const invEntry = await tx.accountEntry.findFirst({ where: { sourceDocType: 'FISCAL_DOCUMENT', sourceDocId: nc.relatedDocumentId! } });
    if (invEntry && invEntry.openAmount.gt(0)) {
      const amount = roundMoney(Prisma.Decimal.min(invEntry.openAmount, nc.total).toString());
      await this.allocations.allocateInTx(tx, ctx, entryId, [{ entryId: invEntry.id, amount: amount.toString() }], `Aplicación automática de ${label}`);
    }
  }

  // ─── Consultas ───

  list(ctx: RequestContext, q: { customerId?: string; status?: string; kind?: string; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.FiscalDocumentWhereInput = {
        direction: 'SALE',
        ...(q.customerId ? { partyId: q.customerId } : {}),
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.kind === 'F' ? { docType: { startsWith: 'F' } } : q.kind === 'NC' ? { docType: { startsWith: 'NC' } } : q.kind === 'ND' ? { docType: { startsWith: 'ND' } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.fiscalDocument.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.fiscalDocument.count({ where }),
      ]);
      const [parties, entries] = await Promise.all([
        tx.party.findMany({ where: { id: { in: rows.map((r) => r.partyId) } }, select: { id: true, legalName: true } }),
        tx.accountEntry.findMany({ where: { sourceDocType: 'FISCAL_DOCUMENT', sourceDocId: { in: rows.map((r) => r.id) } }, select: { sourceDocId: true, openAmount: true } }),
      ]);
      return {
        total,
        rows: rows.map((r) => ({
          ...r,
          netTotal: r.netTotal.toString(),
          vatTotal: r.vatTotal.toString(),
          total: r.total.toString(),
          label: SALES_DOC_LABELS[r.docType] ?? r.docType,
          party: parties.find((p) => p.id === r.partyId)?.legalName,
          openAmount: entries.find((e) => e.sourceDocId === r.id)?.openAmount.toString() ?? null,
        })),
      };
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, id));
  }

  private async detailInTx(tx: Tx, id: string) {
    const d = await tx.fiscalDocument.findUnique({ where: { id }, include: { lines: true } });
    if (!d || d.direction !== 'SALE') throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El comprobante no existe.', 404);
    const [party, company, deliveries, related, children, entry, seller, items] = await Promise.all([
      tx.party.findUnique({ where: { id: d.partyId }, select: { id: true, code: true, legalName: true, taxId: true, taxIdType: true, taxCondition: true, addresses: true } }),
      tx.company.findUnique({ where: { id: d.companyId }, select: { legalName: true, tradeName: true, cuit: true, address: true, taxCondition: true } }),
      tx.deliveryNote.findMany({ where: { invoiceId: id }, select: { id: true, number: true, issueDate: true } }),
      d.relatedDocumentId ? tx.fiscalDocument.findUnique({ where: { id: d.relatedDocumentId }, select: { id: true, docType: true, pointOfSale: true, number: true, issueDate: true } }) : null,
      tx.fiscalDocument.findMany({ where: { relatedDocumentId: id }, select: { id: true, docType: true, pointOfSale: true, number: true, status: true, total: true }, orderBy: { createdAt: 'asc' } }),
      tx.accountEntry.findFirst({ where: { sourceDocType: 'FISCAL_DOCUMENT', sourceDocId: id } }),
      d.sellerUserId ? tx.user.findUnique({ where: { id: d.sellerUserId }, select: { name: true } }) : null,
      tx.item.findMany({ where: { id: { in: d.lines.map((l) => l.itemId).filter((x): x is string => !!x) } }, select: { id: true, sku: true } }),
    ]);
    const credited = await tx.fiscalDocumentLine.groupBy({
      by: ['relatedLineId'],
      where: { relatedLineId: { in: d.lines.map((l) => l.id) }, document: { status: { in: ['POSTED', 'PENDING_AUTH'] } } },
      _sum: { qty: true },
    });
    const allocations = entry ? await this.allocations.activeFor(tx, entry.id) : [];
    const otherEntries = await tx.accountEntry.findMany({ where: { id: { in: allocations.flatMap((a) => [a.debitEntryId, a.creditEntryId]).filter((x) => x !== entry?.id) } } });
    return {
      ...d,
      netTotal: d.netTotal.toString(),
      vatTotal: d.vatTotal.toString(),
      otherTaxes: d.otherTaxes.toString(),
      total: d.total.toString(),
      commissionPct: d.commissionPct?.toString() ?? null,
      label: SALES_DOC_LABELS[d.docType] ?? d.docType,
      party,
      company,
      deliveries,
      related,
      children: children.map((c) => ({ ...c, total: c.total.toString(), label: SALES_DOC_LABELS[c.docType] })),
      seller: seller?.name ?? null,
      openAmount: entry?.openAmount.toString() ?? null,
      allocations: allocations.map((a) => {
        const other = otherEntries.find((e) => e.id === (a.debitEntryId === entry?.id ? a.creditEntryId : a.debitEntryId));
        return { id: a.id, amount: a.amount.toString(), createdAt: a.createdAt, counterpart: other?.description ?? '', counterpartType: other?.entryType };
      }),
      lines: d.lines.map((l) => ({
        ...l,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
        discountPct: l.discountPct.toString(),
        vatRate: l.vatRate.toString(),
        net: l.net.toString(),
        vat: l.vat.toString(),
        sku: items.find((i) => i.id === l.itemId)?.sku ?? null,
        creditedQty: credited.find((c) => c.relatedLineId === l.id)?._sum.qty?.toString() ?? '0',
      })),
    };
  }
}
