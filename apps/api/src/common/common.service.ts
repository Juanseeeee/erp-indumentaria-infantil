import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from './context';
import { toJson } from './unit-of-work';

/** Auditoría append-only. Se escribe dentro de la misma transacción de la operación. */
@Injectable()
export class AuditService {
  async log(
    tx: Tx,
    ctx: Pick<RequestContext, 'companyId' | 'userId' | 'ip'>,
    entry: { entity: string; entityId: string; action: string; diff?: unknown; reason?: string | null },
  ) {
    await tx.auditLog.create({
      data: {
        companyId: ctx.companyId,
        userId: ctx.userId,
        ip: ctx.ip,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        diff: entry.diff === undefined ? Prisma.JsonNull : toJson(entry.diff),
        reason: entry.reason ?? null,
      },
    });
  }
}

/** Numeración de documentos con bloqueo de fila: sin duplicados bajo concurrencia. */
@Injectable()
export class NumberingService {
  async next(tx: Tx, companyId: string, docType: string, seriesKey = '', padding = 8): Promise<string> {
    await tx.$executeRaw`
      INSERT INTO document_sequences (company_id, doc_type, series_key, prefix, next_number, padding, gapless)
      VALUES (${companyId}::uuid, ${docType}, ${seriesKey}, '', 1, ${padding}, false)
      ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<{ n: number; prefix: string; padding: number }[]>`
      UPDATE document_sequences SET next_number = next_number + 1
      WHERE company_id = ${companyId}::uuid AND doc_type = ${docType} AND series_key = ${seriesKey}
      RETURNING next_number - 1 AS n, prefix, padding`;
    const row = rows[0]!;
    return `${row.prefix}${String(row.n).padStart(row.padding, '0')}`;
  }
}

/** Diff superficial para auditoría: solo los campos que cambiaron. */
export function shallowDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] instanceof Prisma.Decimal ? String(before[k]) : before[k];
    const b = after[k] instanceof Prisma.Decimal ? String(after[k]) : after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b };
  }
  return out;
}

/** Lee una configuración por empresa (tabla settings) con valor por defecto. */
export async function readSetting<T>(tx: Tx, companyId: string, key: string, fallback: T): Promise<T> {
  const s = await tx.setting.findUnique({ where: { companyId_key: { companyId, key } } });
  return (s?.value as T) ?? fallback;
}
