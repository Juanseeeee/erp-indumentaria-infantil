import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { PrismaService, Tx } from '../prisma/prisma.service';
import type { RequestContext } from './context';

export interface RunOptions {
  /** Aplica la Idempotency-Key del contexto (solo en operaciones que crean documentos). */
  idempotent?: boolean;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
}

export interface UowResult<T> {
  value: T;
  replayed: boolean;
}

/**
 * Unidad de trabajo: una transacción por caso de uso.
 *  - Fija `app.company_id` para que RLS filtre por empresa.
 *  - Con `idempotent`, registra la Idempotency-Key DENTRO de la transacción: un reintento
 *    concurrente queda bloqueado por la PK y, al confirmar la primera, recibe la misma respuesta.
 */
@Injectable()
export class UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    ctx: Pick<RequestContext, 'companyId' | 'userId' | 'idempotencyKey' | 'requestHash'>,
    fn: (tx: Tx) => Promise<T>,
    opts: RunOptions = {},
  ): Promise<T> {
    return (await this.runDetailed(ctx, fn, opts)).value;
  }

  async runDetailed<T>(
    ctx: Pick<RequestContext, 'companyId' | 'userId' | 'idempotencyKey' | 'requestHash'>,
    fn: (tx: Tx) => Promise<T>,
    opts: RunOptions = {},
  ): Promise<UowResult<T>> {
    const key = opts.idempotent ? ctx.idempotencyKey : undefined;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true)`;
          if (key) {
            const existing = await this.findKey(tx, ctx.companyId, key);
            if (existing) return { value: this.replay<T>(existing, ctx.requestHash), replayed: true };
            await tx.idempotencyKey.create({
              data: {
                companyId: ctx.companyId,
                key,
                userId: ctx.userId,
                requestHash: ctx.requestHash ?? '',
                statusCode: 0,
                response: {},
              },
            });
          }
          const value = await fn(tx);
          if (key) {
            await tx.idempotencyKey.update({
              where: { companyId_key: { companyId: ctx.companyId, key } },
              data: { statusCode: 201, response: toJson(value) },
            });
          }
          return { value, replayed: false };
        },
        // TX_TIMEOUT_MS: piso para cargas desde lejos de la base (p. ej. el seed contra Supabase desde otra región).
        {
          isolationLevel: opts.isolationLevel,
          timeout: Math.max(opts.timeoutMs ?? 20_000, Number(process.env.TX_TIMEOUT_MS ?? 0)),
          maxWait: 10_000,
        },
      );
    } catch (err) {
      // Reintento concurrente con la misma clave: la primera transacción ya confirmó.
      if (key && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const stored = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true)`;
          return this.findKey(tx, ctx.companyId, key);
        });
        if (stored) return { value: this.replay<T>(stored, ctx.requestHash), replayed: true };
      }
      throw err;
    }
  }

  private findKey(tx: Tx, companyId: string, key: string) {
    return tx.idempotencyKey.findUnique({ where: { companyId_key: { companyId, key } } });
  }

  private replay<T>(row: { requestHash: string; response: Prisma.JsonValue }, requestHash?: string): T {
    if (requestHash && row.requestHash && row.requestHash !== requestHash) {
      throw new DomainError(
        ErrorCodes.VALIDACION,
        'La clave de idempotencia ya se usó con otros datos. Generá una nueva operación.',
        422,
      );
    }
    return row.response as T;
  }
}

/** Serializa Decimal/Date/BigInt a JSON estable. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}
