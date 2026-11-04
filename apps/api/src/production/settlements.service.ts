import { Injectable } from '@nestjs/common';
import { DomainError, ErrorCodes, computeInvoiceTotals, dec, roundMoney, sum } from '@erp/domain-core';
import type { WorkshopSettlementCreateInput } from '@erp/contracts';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { AccountsService } from '../accounts/accounts.service';

/**
 * Liquidación de talleres: el taller cobra por prenda terminada (tarifa por modelo vigente al recibir).
 * Se liquidan las prendas aprobadas y de segunda; el descarte no se paga. Descuentos manuales (faltantes, fallas).
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
  ) {}

  /** Recepciones de un taller pendientes de liquidar, con su importe. */
  pending(ctx: RequestContext, workshopId: string) {
    return this.uow.run(ctx, async (tx) => {
      const outputs = await tx.productionOutput.findMany({
        where: { workshopId, settlementId: null },
        include: { lines: true },
        orderBy: { createdAt: 'asc' },
      });
      const orders = await tx.productionOrder.findMany({ where: { id: { in: outputs.map((o) => o.orderId) } }, select: { id: true, number: true, productId: true } });
      const products = await tx.product.findMany({ where: { id: { in: orders.map((o) => o.productId) } }, select: { id: true, name: true } });
      return outputs.map((o) => {
        const order = orders.find((x) => x.id === o.orderId);
        const units = sum(o.lines.map((l) => dec(l.approvedQty.toString()).plus(l.secondQty.toString())));
        const amount = roundMoney(sum(o.lines.map((l) => dec(l.workshopRate?.toString() ?? '0').times(dec(l.approvedQty.toString()).plus(l.secondQty.toString())))));
        return {
          id: o.id,
          number: o.number,
          createdAt: o.createdAt,
          order: order?.number,
          product: products.find((p) => p.id === order?.productId)?.name,
          units: units.toString(),
          scrap: sum(o.lines.map((l) => l.scrapQty.toString())).toString(),
          rate: o.lines[0]?.workshopRate?.toString() ?? null,
          amount: amount.toFixed(2),
        };
      });
    });
  }

  create(ctx: RequestContext, input: WorkshopSettlementCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const outputs = await tx.productionOutput.findMany({ where: { id: { in: input.outputIds } }, include: { lines: true } });
        if (outputs.length !== input.outputIds.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'Hay recepciones inexistentes.', 404);
        if (outputs.some((o) => o.workshopId !== input.workshopId)) throw new DomainError(ErrorCodes.VALIDACION, 'Hay recepciones de otro taller.');
        // Bloqueo para que dos liquidaciones simultáneas no tomen la misma recepción.
        const locked = await tx.$queryRaw<{ id: string; settlement_id: string | null }[]>`
          SELECT id, settlement_id FROM production_outputs WHERE id = ANY(${input.outputIds}::uuid[]) FOR UPDATE`;
        if (locked.some((o) => o.settlement_id)) throw new DomainError(ErrorCodes.DUPLICADO, 'Alguna de las recepciones ya fue liquidada.', 409);

        const gross = roundMoney(
          sum(outputs.flatMap((o) => o.lines.map((l) => dec(l.workshopRate?.toString() ?? '0').times(dec(l.approvedQty.toString()).plus(l.secondQty.toString()))))),
        );
        const deductions = roundMoney(sum(input.deductions.map((d) => d.amount)));
        const net = gross.minus(deductions);
        if (net.isNegative()) throw new DomainError(ErrorCodes.VALIDACION, 'Los descuentos superan el importe a liquidar.');

        const number = `LT-${await this.numbering.next(tx, ctx.companyId, 'WORKSHOP_SETTLEMENT', '', 6)}`;
        const vatRate = input.invoice?.vatRate ?? '0';
        const totals = computeInvoiceTotals([{ qty: '1', unitPrice: net.toString(), vatRate }]);
        const docType = input.invoice?.docType ?? 'LIQ';
        const pointOfSale = input.invoice?.pointOfSale ?? 0;
        const docNumber = input.invoice?.number ?? Number(number.replace(/\D/g, ''));
        const dup = await tx.fiscalDocument.findFirst({ where: { direction: 'PURCHASE', partyId: input.workshopId, docType, pointOfSale, number: docNumber } });
        if (dup) throw new DomainError(ErrorCodes.DUPLICADO, 'Ese comprobante del taller ya está cargado.', 409, { existingId: dup.id });

        const settlement = await tx.workshopSettlement.create({
          data: {
            companyId: ctx.companyId, number, workshopId: input.workshopId, grossTotal: gross.toString(), deductions: deductions.toString(),
            total: totals.total.toString(), deductionDetail: input.deductions, notes: input.notes, createdBy: ctx.userId,
          },
        });
        const dueDate = input.dueDate ?? (await this.accounts.defaultDueDate(tx, input.workshopId, input.issueDate));
        const doc = await tx.fiscalDocument.create({
          data: {
            companyId: ctx.companyId, direction: 'PURCHASE', partyId: input.workshopId, docType, pointOfSale, number: docNumber,
            issueDate: input.issueDate, dueDate, netTotal: totals.netTotal.toString(), vatTotal: totals.vatTotal.toString(), total: totals.total.toString(),
            sourceType: 'WORKSHOP_SETTLEMENT', sourceId: settlement.id, notes: input.notes, createdBy: ctx.userId,
            lines: {
              create: [{
                companyId: ctx.companyId, description: `Confección según ${number}`, qty: '1', unitPrice: net.toString(), vatRate,
                net: totals.lines[0]!.net.toString(), vat: totals.lines[0]!.vat.toString(),
              }],
            },
          },
        });
        await tx.workshopSettlement.update({ where: { id: settlement.id }, data: { fiscalDocumentId: doc.id } });
        await tx.productionOutput.updateMany({ where: { id: { in: input.outputIds } }, data: { settlementId: settlement.id } });
        await this.accounts.post(tx, ctx, {
          partyId: input.workshopId, accountType: 'PAYABLE', entryType: 'INVOICE', sourceDocType: 'FISCAL_DOCUMENT', sourceDocId: doc.id,
          description: input.invoice ? `${docType} ${String(pointOfSale).padStart(5, '0')}-${String(docNumber).padStart(8, '0')} (${number})` : `Liquidación ${number}`,
          date: input.issueDate, dueDate, amount: totals.total.toString(),
        });
        await this.audit.log(tx, ctx, { entity: 'workshop_settlement', entityId: settlement.id, action: 'create', diff: { number, gross: gross.toString(), deductions: deductions.toString() } });
        return { ...settlement, total: totals.total.toString(), fiscalDocumentId: doc.id };
      },
      { idempotent: true },
    );
  }

  list(ctx: RequestContext, workshopId?: string) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.workshopSettlement.findMany({ where: workshopId ? { workshopId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
      const parties = await tx.party.findMany({ where: { id: { in: rows.map((r) => r.workshopId) } }, select: { id: true, legalName: true } });
      return rows.map((r) => ({ ...r, workshop: parties.find((p) => p.id === r.workshopId)?.legalName }));
    });
  }
}
