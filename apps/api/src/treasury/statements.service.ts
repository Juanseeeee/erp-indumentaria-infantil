import { Injectable } from '@nestjs/common';
import { Prisma, type TreasuryMovement } from '@prisma/client';
import { StatementImportInput, StatementLineCreateInput } from '@erp/contracts';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { matchCandidates, parseStatementCsv, pickAutoMatches, signedAmount, statementKey } from '@erp/domain-finance';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { TreasuryService } from './treasury.service';
import { ExpensesService } from './expenses.service';

/** Días de diferencia admitidos entre la fecha del banco y la fecha de valor del movimiento. */
const TOLERANCE_DAYS = 5;
const DAY = 86_400_000;

type Line = Prisma.BankStatementLineGetPayload<object>;

const movementView = (m: TreasuryMovement) => ({
  id: m.id,
  operationDate: m.operationDate,
  valueDate: m.valueDate,
  concept: m.concept,
  amount: signedAmount(m.direction, m.amount.toString()).toFixed(2),
});

/**
 * Importación de extractos (CSV del home banking) y conciliación línea por línea: con un movimiento
 * existente, registrando lo que solo está en el banco (comisiones, impuestos, débitos automáticos) o
 * ignorándola con motivo. Una línea ya importada no se vuelve a cargar aunque venga en otro archivo.
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly treasury: TreasuryService,
    private readonly expenses: ExpensesService,
  ) {}

  import(ctx: RequestContext, cashAccountId: string, input: StatementImportInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const account = await tx.cashAccount.findUnique({ where: { id: cashAccountId } });
        if (!account) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
        if (account.type !== 'BANK' && account.type !== 'WALLET') throw new DomainError(ErrorCodes.VALIDACION, 'Los extractos se importan en un banco o una billetera.');
        if (!account.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `La cuenta ${account.name} está inactiva.`);

        const { rows, errors } = parseStatementCsv(input.content);
        if (!rows.length) {
          throw new DomainError(ErrorCodes.VALIDACION, `No se pudo leer ningún movimiento.${errors.length ? ` Línea ${errors[0]!.line}: ${errors[0]!.message}` : ''}`);
        }
        // La misma línea repetida dentro del archivo (dos comisiones iguales el mismo día) lleva su número de aparición.
        const seen = new Map<string, number>();
        const keyed = rows.map((r, i) => {
          const base = statementKey(r, 0);
          const occurrence = seen.get(base) ?? 0;
          seen.set(base, occurrence + 1);
          return { ...r, lineNumber: i + 1, key: statementKey(r, occurrence) };
        });
        const existing = new Set(
          (await tx.bankStatementLine.findMany({ where: { cashAccountId, lineKey: { in: keyed.map((k) => k.key) } }, select: { lineKey: true } })).map((l) => l.lineKey),
        );
        const fresh = keyed.filter((k) => !existing.has(k.key));
        if (!fresh.length) throw new DomainError(ErrorCodes.DUPLICADO, 'Todas las líneas de este archivo ya estaban importadas.', 409);

        const dates = fresh.map((r) => r.date.getTime());
        const statement = await tx.bankStatement.create({
          data: {
            companyId: ctx.companyId,
            cashAccountId,
            fileName: input.fileName,
            periodFrom: new Date(Math.min(...dates)),
            periodTo: new Date(Math.max(...dates)),
            lineCount: fresh.length,
            skippedCount: keyed.length - fresh.length,
            createdBy: ctx.userId,
          },
        });
        await tx.bankStatementLine.createMany({
          data: fresh.map((r) => ({
            companyId: ctx.companyId,
            statementId: statement.id,
            cashAccountId,
            lineNumber: r.lineNumber,
            date: r.date,
            description: r.description,
            reference: r.reference,
            amount: r.amount.toFixed(2),
            lineKey: r.key,
          })),
        });
        await this.audit.log(tx, ctx, {
          entity: 'bank_statement',
          entityId: statement.id,
          action: 'import',
          diff: { fileName: input.fileName, lines: fresh.length, skipped: keyed.length - fresh.length, unreadable: errors.length },
        });
        return { ...(await this.detailInTx(tx, statement.id)), errors };
      },
      { idempotent: true },
    );
  }

  list(ctx: RequestContext, cashAccountId?: string) {
    return this.uow.run(ctx, async (tx) => {
      const rows = await tx.bankStatement.findMany({
        where: cashAccountId ? { cashAccountId } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { cashAccount: { select: { name: true } } },
      });
      const counts = await tx.bankStatementLine.groupBy({ by: ['statementId', 'status'], where: { statementId: { in: rows.map((r) => r.id) } }, _count: true });
      return rows.map(({ cashAccount, ...r }) => {
        const of = (status: string) => counts.find((c) => c.statementId === r.id && c.status === status)?._count ?? 0;
        return { ...r, account: cashAccount.name, pending: of('PENDING'), resolved: r.lineCount - of('PENDING') };
      });
    });
  }

  detail(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, (tx) => this.detailInTx(tx, id));
  }

  /** Movimientos de la cuenta todavía sin conciliar, en el período del extracto (con tolerancia). */
  private unreconciled(tx: Tx, cashAccountId: string, from: Date, to: Date) {
    return tx.treasuryMovement.findMany({
      where: {
        cashAccountId,
        statementLine: null,
        valueDate: { gte: new Date(from.getTime() - TOLERANCE_DAYS * DAY), lte: new Date(to.getTime() + TOLERANCE_DAYS * DAY) },
      },
      orderBy: [{ valueDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private candidatesFor(line: Line, movements: TreasuryMovement[]) {
    return matchCandidates(
      { date: line.date, amount: line.amount.toString(), reference: line.reference },
      movements.map((m) => ({ ...m, amount: signedAmount(m.direction, m.amount.toString()), reference: m.concept })),
      TOLERANCE_DAYS,
    );
  }

  private async detailInTx(tx: Tx, id: string) {
    const statement = await tx.bankStatement.findUnique({ where: { id }, include: { cashAccount: { select: { id: true, name: true } } } });
    if (!statement) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El extracto no existe.', 404);
    const [lines, open] = await Promise.all([
      tx.bankStatementLine.findMany({ where: { statementId: id }, orderBy: [{ date: 'asc' }, { lineNumber: 'asc' }], include: { movement: true } }),
      this.unreconciled(tx, statement.cashAccountId, statement.periodFrom, statement.periodTo),
    ]);
    const inPeriod = open.filter((m) => m.valueDate >= statement.periodFrom && m.valueDate <= statement.periodTo);
    const sum = (xs: { amount: Prisma.Decimal | string }[]) => xs.reduce((a, x) => a.plus(x.amount), new Prisma.Decimal(0)).toFixed(2);
    return {
      ...statement,
      account: statement.cashAccount.name,
      summary: {
        lines: lines.length,
        pending: lines.filter((l) => l.status === 'PENDING').length,
        bankTotal: sum(lines),
        pendingTotal: sum(lines.filter((l) => l.status === 'PENDING')),
      },
      lines: lines.map(({ movement, ...l }) => ({
        ...l,
        amount: l.amount.toFixed(2),
        movement: movement ? movementView(movement) : null,
        suggestions: l.status === 'PENDING' ? this.candidatesFor(l, open).slice(0, 3).map(movementView) : [],
      })),
      /** En el sistema y todavía no en el banco: cheques propios sin debitar, depósitos en tránsito, errores de carga. */
      systemOnly: inPeriod.map(movementView),
    };
  }

  autoMatch(ctx: RequestContext, statementId: string) {
    return this.uow.run(ctx, async (tx) => {
      const statement = await tx.bankStatement.findUnique({ where: { id: statementId } });
      if (!statement) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El extracto no existe.', 404);
      // Las pendientes de toda la cuenta compiten por los mismos movimientos, no solo las de este extracto.
      const pending = await tx.bankStatementLine.findMany({ where: { cashAccountId: statement.cashAccountId, status: 'PENDING' } });
      const open = await this.unreconciled(tx, statement.cashAccountId, statement.periodFrom, statement.periodTo);
      const matches = pickAutoMatches(pending, (l) => this.candidatesFor(l, open)).filter((m) => pending.find((l) => l.id === m.lineId)!.statementId === statementId);
      for (const m of matches) {
        await tx.bankStatementLine.updateMany({
          where: { id: m.lineId, status: 'PENDING' },
          data: { status: 'MATCHED', movementId: m.movementId, resolvedAt: new Date(), resolvedBy: ctx.userId, notes: 'Conciliada automáticamente' },
        });
      }
      await this.audit.log(tx, ctx, { entity: 'bank_statement', entityId: statementId, action: 'auto_match', diff: { matched: matches.length } });
      return { matched: matches.length, statement: await this.detailInTx(tx, statementId) };
    });
  }

  /** Bloquea la línea y exige que siga pendiente. */
  private async pendingLine(tx: Tx, lineId: string) {
    await tx.$queryRaw`SELECT id FROM bank_statement_lines WHERE id = ${lineId}::uuid FOR UPDATE`;
    const line = await tx.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La línea del extracto no existe.', 404);
    if (line.status !== 'PENDING') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La línea ya fue resuelta.');
    return line;
  }

  match(ctx: RequestContext, lineId: string, movementId: string) {
    return this.uow.run(ctx, async (tx) => {
      const line = await this.pendingLine(tx, lineId);
      const movement = await tx.treasuryMovement.findUnique({ where: { id: movementId }, include: { statementLine: { select: { id: true } } } });
      if (!movement || movement.cashAccountId !== line.cashAccountId) throw new DomainError(ErrorCodes.VALIDACION, 'El movimiento no es de esta cuenta.');
      if (movement.statementLine) throw new DomainError(ErrorCodes.DUPLICADO, 'Ese movimiento ya está conciliado con otra línea.', 409);
      if (!signedAmount(movement.direction, movement.amount.toString()).eq(line.amount.toString())) {
        throw new DomainError(ErrorCodes.VALIDACION, 'El importe del movimiento no coincide con el del banco.');
      }
      await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'MATCHED', movementId, resolvedAt: new Date(), resolvedBy: ctx.userId } });
      await this.audit.log(tx, ctx, { entity: 'bank_statement_line', entityId: lineId, action: 'match', diff: { movementId } });
      return this.detailInTx(tx, line.statementId);
    });
  }

  /** Registra en tesorería (o como gasto) lo que solo figura en el banco, con la fecha del banco. */
  create(ctx: RequestContext, lineId: string, input: StatementLineCreateInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const line = await this.pendingLine(tx, lineId);
        const date = line.date.toISOString().slice(0, 10);
        let movementId: string;
        if (input.categoryId && input.costCenterId) {
          if (!line.amount.isNegative()) throw new DomainError(ErrorCodes.VALIDACION, 'Solo un débito del banco puede registrarse como gasto.');
          ({ movementId } = await this.expenses.createInTx(tx, ctx, {
            date,
            categoryId: input.categoryId,
            costCenterId: input.costCenterId,
            cashAccountId: line.cashAccountId,
            supplierId: null,
            description: input.concept,
            documentReference: line.reference,
            amount: line.amount.abs().toFixed(2),
          }));
        } else {
          movementId = (
            await this.treasury.postInTx(tx, ctx, {
              cashAccountId: line.cashAccountId,
              direction: line.amount.isNegative() ? 'OUT' : 'IN',
              amount: line.amount.abs().toFixed(2),
              operationDate: line.date,
              concept: input.concept,
              sourceDocType: 'BANK_STATEMENT_LINE',
              sourceDocId: line.id,
            })
          ).id;
        }
        await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'CREATED', movementId, resolvedAt: new Date(), resolvedBy: ctx.userId } });
        await this.audit.log(tx, ctx, { entity: 'bank_statement_line', entityId: lineId, action: 'create_movement', diff: { movementId, expense: !!input.categoryId } });
        return this.detailInTx(tx, line.statementId);
      },
      { idempotent: true },
    );
  }

  ignore(ctx: RequestContext, lineId: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      const line = await this.pendingLine(tx, lineId);
      await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'IGNORED', notes: reason, resolvedAt: new Date(), resolvedBy: ctx.userId } });
      await this.audit.log(tx, ctx, { entity: 'bank_statement_line', entityId: lineId, action: 'ignore', reason });
      return this.detailInTx(tx, line.statementId);
    });
  }

  /** Deshace una conciliación o un "ignorar". Lo registrado desde el extracto se corrige anulando ese documento. */
  undo(ctx: RequestContext, lineId: string) {
    return this.uow.run(ctx, async (tx) => {
      await tx.$queryRaw`SELECT id FROM bank_statement_lines WHERE id = ${lineId}::uuid FOR UPDATE`;
      const line = await tx.bankStatementLine.findUnique({ where: { id: lineId } });
      if (!line) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La línea del extracto no existe.', 404);
      if (line.status === 'PENDING') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La línea está pendiente.');
      if (line.status === 'CREATED') {
        throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El movimiento se registró desde el extracto: para corregirlo, anulá el gasto o registrá un contramovimiento.');
      }
      await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'PENDING', movementId: null, notes: null, resolvedAt: null, resolvedBy: null } });
      await this.audit.log(tx, ctx, { entity: 'bank_statement_line', entityId: lineId, action: 'undo', diff: { from: line.status, movementId: line.movementId } });
      return this.detailInTx(tx, line.statementId);
    });
  }
}
