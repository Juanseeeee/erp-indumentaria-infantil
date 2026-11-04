import { Injectable } from '@nestjs/common';
import { StockDocType, StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';
import type { StockDocumentCreateInput } from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { StockService } from './stock.service';

const DOC_PERMISSION: Record<StockDocType, 'inventory.opening' | 'inventory.adjust' | 'inventory.transfer'> = {
  OPENING: 'inventory.opening',
  ADJUSTMENT: 'inventory.adjust',
  TRANSFER: 'inventory.transfer',
};

const DOC_PREFIX: Record<StockDocType, string> = { OPENING: 'SI', ADJUSTMENT: 'AJ', TRANSFER: 'TR' };

@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly stock: StockService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private assertPermission(ctx: RequestContext, type: StockDocType) {
    if (!can(ctx, DOC_PERMISSION[type])) {
      throw new DomainError(ErrorCodes.SIN_PERMISO, 'No tenés permiso para este tipo de movimiento.', 403);
    }
  }

  async create(ctx: RequestContext, input: StockDocumentCreateInput) {
    this.assertPermission(ctx, input.type);
    return this.uow.run(
      ctx,
      async (tx) => {
        const number = `${DOC_PREFIX[input.type]}-${await this.numbering.next(tx, ctx.companyId, `STOCK_${input.type}`)}`;
        const lines = await Promise.all(
          input.lines.map(async (l) => ({
            companyId: ctx.companyId,
            itemId: l.itemId,
            qty: l.qty,
            unitCost: l.unitCost ?? null,
            lotId: l.lotCode ? await this.resolveLot(tx, ctx.companyId, l.itemId, l.lotCode, dec(l.qty).isPositive()) : null,
          })),
        );
        const doc = await tx.stockDocument.create({
          data: {
            companyId: ctx.companyId,
            type: input.type,
            number,
            warehouseId: input.warehouseId,
            targetWarehouseId: input.targetWarehouseId ?? null,
            reason: input.reason,
            notes: input.notes,
            createdBy: ctx.userId,
            lines: { create: lines.map(({ companyId, ...l }) => ({ ...l, companyId })) },
          },
          include: { lines: true },
        });
        await this.audit.log(tx, ctx, { entity: 'stock_document', entityId: doc.id, action: 'create', diff: { number, type: input.type } });
        if (!input.post) return doc;
        return this.postInTx(tx, ctx, doc.id);
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  async post(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.postInTx(tx, ctx, id), { idempotent: true, timeoutMs: 60_000 });
  }

  /** Aprueba un ajuste pendiente. Segregación de funciones: no puede aprobar quien lo creó. */
  async approve(ctx: RequestContext, id: string) {
    if (!can(ctx, 'inventory.adjust.approve')) {
      throw new DomainError(ErrorCodes.SIN_PERMISO, 'No tenés permiso para aprobar ajustes.', 403);
    }
    return this.uow.run(
      ctx,
      async (tx) => {
        const doc = await this.lockDoc(tx, id);
        if (doc.status !== 'PENDING_APPROVAL') {
          throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El documento no está pendiente de aprobación.');
        }
        if (doc.createdBy === ctx.userId) {
          throw new DomainError(ErrorCodes.SIN_PERMISO, 'Un ajuste no puede ser aprobado por quien lo cargó.', 403);
        }
        await tx.stockDocument.update({ where: { id }, data: { approvedBy: ctx.userId } });
        await this.audit.log(tx, ctx, { entity: 'stock_document', entityId: id, action: 'approve' });
        return this.applyMovements(tx, ctx, id);
      },
      { idempotent: true, timeoutMs: 60_000 },
    );
  }

  /** Anula un documento. Si estaba posteado genera movimientos de reversa (nunca borra). */
  async void(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const doc = await this.lockDoc(tx, id);
        this.assertPermission(ctx, doc.type);
        if (doc.status === 'VOIDED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El documento ya está anulado.');
        if (doc.status === 'POSTED') {
          const movements = await tx.stockMovement.findMany({
            where: { sourceDocType: 'STOCK_DOCUMENT', sourceDocId: id },
            orderBy: { occurredAt: 'asc' },
          });
          await this.stock.prelock(tx, ctx.companyId, movements);
          // Primero se revierten las entradas al destino (transferencias), luego el resto.
          for (const m of [...movements].sort((a, b) => Number(b.qty.isPositive()) - Number(a.qty.isPositive()))) {
            const reverseType = reverseOf(m.type);
            await this.stock.move(tx, ctx, {
              itemId: m.itemId,
              warehouseId: m.warehouseId,
              lotId: m.lotId,
              type: reverseType,
              qty: m.qty.negated().toString(),
              unitCost: m.unitCost.toString(),
              sourceDocType: 'STOCK_DOCUMENT_VOID',
              sourceDocId: id,
              sourceLineId: m.sourceLineId,
              transferGroupId: m.transferGroupId,
              reason: `Anulación: ${reason}`,
            });
          }
        }
        await tx.stockDocument.update({ where: { id }, data: { status: 'VOIDED', version: { increment: 1 } } });
        await this.audit.log(tx, ctx, { entity: 'stock_document', entityId: id, action: 'void', reason });
        return tx.stockDocument.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      },
      { timeoutMs: 60_000 },
    );
  }

  private async postInTx(tx: Tx, ctx: RequestContext, id: string) {
    const doc = await this.lockDoc(tx, id);
    this.assertPermission(ctx, doc.type);
    if (doc.status !== 'DRAFT') {
      throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'Solo se pueden confirmar documentos en borrador.');
    }
    if (doc.type === 'ADJUSTMENT' && (await this.requiresApproval(tx, ctx, doc.id, doc.warehouseId))) {
      await tx.stockDocument.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
      await this.audit.log(tx, ctx, { entity: 'stock_document', entityId: id, action: 'request_approval' });
      return tx.stockDocument.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    }
    return this.applyMovements(tx, ctx, id);
  }

  private async applyMovements(tx: Tx, ctx: RequestContext, id: string) {
    const doc = await tx.stockDocument.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const keys = doc.lines.flatMap((l) => [
      { itemId: l.itemId, warehouseId: doc.warehouseId, lotId: l.lotId },
      ...(doc.targetWarehouseId ? [{ itemId: l.itemId, warehouseId: doc.targetWarehouseId, lotId: l.lotId }] : []),
    ]);
    await this.stock.prelock(tx, ctx.companyId, keys);

    let totalValue = dec(0);
    for (const line of doc.lines) {
      const base = {
        itemId: line.itemId,
        lotId: line.lotId,
        sourceDocType: 'STOCK_DOCUMENT',
        sourceDocId: doc.id,
        sourceLineId: line.id,
        reason: doc.reason,
      };
      const qty = dec(line.qty.toString());
      if (doc.type === 'TRANSFER') {
        const groupId = randomUUID();
        const out = await this.stock.move(tx, ctx, {
          ...base,
          warehouseId: doc.warehouseId,
          type: 'TRANSFER_OUT',
          qty: qty.negated().toString(),
          transferGroupId: groupId,
        });
        await this.stock.move(tx, ctx, {
          ...base,
          warehouseId: doc.targetWarehouseId!,
          type: 'TRANSFER_IN',
          qty: qty.toString(),
          unitCost: out.unitCost.toString(),
          transferGroupId: groupId,
        });
        totalValue = totalValue.plus(dec(out.totalCost.toString()).abs());
      } else {
        const m = await this.stock.move(tx, ctx, {
          ...base,
          warehouseId: doc.warehouseId,
          type: doc.type === 'OPENING' ? 'OPENING' : 'ADJUSTMENT',
          qty: qty.toString(),
          unitCost: line.unitCost?.toString() ?? null,
        });
        totalValue = totalValue.plus(m.totalCost.toString());
      }
    }
    await tx.stockDocument.update({
      where: { id },
      data: {
        status: 'POSTED',
        postedAt: new Date(),
        postedBy: ctx.userId,
        totalValue: roundMoney(totalValue).toString(),
        version: { increment: 1 },
      },
    });
    await this.audit.log(tx, ctx, { entity: 'stock_document', entityId: id, action: 'post', diff: { totalValue: totalValue.toString() } });
    return tx.stockDocument.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  }

  /** Valoriza el ajuste al costo promedio y lo compara con la regla de aprobación. */
  private async requiresApproval(tx: Tx, ctx: RequestContext, id: string, warehouseId: string): Promise<boolean> {
    if (can(ctx, 'inventory.adjust.approve')) return false;
    const rule = await tx.approvalRule.findFirst({ where: { actionCode: 'inventory.adjust', isActive: true } });
    if (!rule) return false;
    const lines = await tx.stockDocumentLine.findMany({ where: { documentId: id } });
    let value = dec(0);
    for (const l of lines) {
      const cost = l.unitCost?.toString() ?? (await this.stock.currentAvgCost(tx, l.itemId, warehouseId, l.lotId));
      value = value.plus(dec(l.qty.toString()).abs().times(cost));
    }
    return value.gt(rule.threshold.toString());
  }

  private async lockDoc(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_documents WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El documento no existe.', 404);
    return tx.stockDocument.findUniqueOrThrow({ where: { id } });
  }

  private async resolveLot(tx: Tx, companyId: string, itemId: string, code: string, createIfMissing: boolean) {
    const existing = await tx.lot.findUnique({ where: { companyId_itemId_code: { companyId, itemId, code } } });
    if (existing) return existing.id;
    if (!createIfMissing) throw new DomainError(ErrorCodes.NO_ENCONTRADO, `El lote ${code} no existe para este artículo.`, 404);
    return (await tx.lot.create({ data: { companyId, itemId, code } })).id;
  }

  list(ctx: RequestContext, q: { type?: StockDocType; page: number; pageSize: number }) {
    return this.uow.run(ctx, async (tx) => {
      const where = q.type ? { type: q.type } : {};
      const [rows, total] = await Promise.all([
        tx.stockDocument.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { _count: { select: { lines: true } } },
        }),
        tx.stockDocument.count({ where }),
      ]);
      return { rows, total };
    });
  }

  get(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const doc = await tx.stockDocument.findUnique({ where: { id }, include: { lines: true } });
      if (!doc) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El documento no existe.', 404);
      const items = await tx.item.findMany({
        where: { id: { in: doc.lines.map((l) => l.itemId) } },
        select: { id: true, sku: true, name: true },
      });
      const movements = await tx.stockMovement.findMany({
        where: { sourceDocId: id },
        orderBy: { occurredAt: 'asc' },
      });
      return { ...doc, items, movements };
    });
  }
}

function reverseOf(type: StockMovementType): StockMovementType {
  if (type === 'TRANSFER_IN') return 'TRANSFER_OUT';
  if (type === 'TRANSFER_OUT') return 'TRANSFER_IN';
  return 'ADJUSTMENT';
}
