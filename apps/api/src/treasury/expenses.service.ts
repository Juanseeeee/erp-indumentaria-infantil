import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseCreateInput, ExpenseQuery, ExpenseTemplateCreateInput, ExpenseTemplateRegisterInput } from '@erp/contracts';
import { pendingRecurring } from '@erp/domain-finance';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService, NumberingService } from '../common/common.service';
import { businessDate } from '../common/dates';
import { TreasuryService, asDate } from './treasury.service';

/** Cuentas desde las que se paga un gasto, y el medio que queda en el movimiento. */
const METHOD_BY_ACCOUNT: Partial<Record<string, string>> = {
  CASH_BOX: 'CASH',
  BANK: 'TRANSFER',
  WALLET: 'TRANSFER',
};

const include = {
  category: { select: { name: true } },
  costCenter: { select: { code: true, name: true } },
  cashAccount: { select: { name: true } },
} satisfies Prisma.ExpenseInclude;

/**
 * Gastos pagados en el momento (fletes, servicios, librería, mantenimiento) con categoría y centro
 * de costo. Sale el dinero de la cuenta elegida; anular devuelve el dinero con un contramovimiento.
 * Los gastos con factura a plazo de un proveedor se cargan como factura de compra (cuenta corriente).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly treasury: TreasuryService,
  ) {}

  create(ctx: RequestContext, input: ExpenseCreateInput) {
    return this.uow.run(ctx, async (tx) => (await this.createInTx(tx, ctx, input)).expense, { idempotent: true });
  }

  /** Dentro de la transacción de otro documento (p. ej., una línea de extracto); devuelve también el movimiento. */
  async createInTx(tx: Tx, ctx: RequestContext, input: ExpenseCreateInput, recurring?: { templateId: string; period: string }) {
    const [category, costCenter, account, supplier] = await Promise.all([
      tx.category.findUnique({ where: { id: input.categoryId } }),
      tx.costCenter.findUnique({ where: { id: input.costCenterId } }),
      tx.cashAccount.findUnique({ where: { id: input.cashAccountId } }),
      input.supplierId ? tx.party.findUnique({ where: { id: input.supplierId } }) : null,
    ]);
    if (!category || category.kind !== 'EXPENSE' || !category.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'Elegí una categoría de gastos activa.');
    if (!costCenter || !costCenter.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'Elegí un centro de costo activo.');
    if (!account) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La cuenta de tesorería no existe.', 404);
    const method = METHOD_BY_ACCOUNT[account.type];
    if (!method) throw new DomainError(ErrorCodes.VALIDACION, 'Un gasto se paga desde una caja, un banco o una billetera.');
    if (input.supplierId && !supplier) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El proveedor no existe.', 404);

    const date = input.date ? asDate(input.date) : businessDate();
    const number = `GA-${await this.numbering.next(tx, ctx.companyId, 'EXPENSE', '', 8)}`;
    const expense = await tx.expense.create({
      data: {
        companyId: ctx.companyId,
        number,
        date,
        categoryId: category.id,
        costCenterId: costCenter.id,
        supplierId: supplier?.id ?? null,
        description: input.description,
        documentReference: input.documentReference,
        amount: input.amount,
        cashAccountId: account.id,
        templateId: recurring?.templateId ?? null,
        period: recurring?.period ?? null,
        createdBy: ctx.userId,
      },
    });
    const movement = await this.treasury.postInTx(tx, ctx, {
      cashAccountId: account.id,
      direction: 'OUT',
      amount: expense.amount.toString(),
      operationDate: date,
      concept: `Gasto ${number} · ${category.name} · ${input.description}`,
      paymentMethod: method,
      sourceDocType: 'EXPENSE',
      sourceDocId: expense.id,
    });
    await this.audit.log(tx, ctx, {
      entity: 'expense',
      entityId: expense.id,
      action: 'create',
      diff: {
        number,
        amount: expense.amount.toString(),
        costCenter: costCenter.code,
      },
    });
    return {
      expense: await this.detailInTx(tx, expense.id),
      movementId: movement.id,
    };
  }

  void(ctx: RequestContext, id: string, reason: string) {
    return this.uow.run(ctx, async (tx) => {
      await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id}::uuid FOR UPDATE`;
      const expense = await tx.expense.findUnique({ where: { id } });
      if (!expense) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El gasto no existe.', 404);
      if (expense.status === 'VOIDED') throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'El gasto ya está anulado.');
      const account = await tx.cashAccount.findUniqueOrThrow({
        where: { id: expense.cashAccountId },
      });
      await this.treasury.postInTx(tx, ctx, {
        cashAccountId: expense.cashAccountId,
        direction: 'IN',
        amount: expense.amount.toString(),
        operationDate: businessDate(),
        concept: `Anulación gasto ${expense.number}: ${reason}`,
        paymentMethod: METHOD_BY_ACCOUNT[account.type] ?? null,
        sourceDocType: 'EXPENSE_VOID',
        sourceDocId: id,
      });
      await tx.expense.update({ where: { id }, data: { status: 'VOIDED' } });
      await this.audit.log(tx, ctx, {
        entity: 'expense',
        entityId: id,
        action: 'void',
        reason,
      });
      return this.detailInTx(tx, id);
    });
  }

  // ─── Gastos recurrentes ───

  createTemplate(ctx: RequestContext, input: ExpenseTemplateCreateInput) {
    return this.uow.run(ctx, async (tx) => {
      const [category, costCenter, account] = await Promise.all([
        tx.category.findUnique({ where: { id: input.categoryId } }),
        tx.costCenter.findUnique({ where: { id: input.costCenterId } }),
        tx.cashAccount.findUnique({ where: { id: input.cashAccountId } }),
      ]);
      if (!category || category.kind !== 'EXPENSE' || !category.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'Elegí una categoría de gastos activa.');
      if (!costCenter || !costCenter.isActive) throw new DomainError(ErrorCodes.VALIDACION, 'Elegí un centro de costo activo.');
      if (!account || !METHOD_BY_ACCOUNT[account.type]) throw new DomainError(ErrorCodes.VALIDACION, 'Un gasto se paga desde una caja, un banco o una billetera.');
      const template = await tx.expenseTemplate.create({
        data: {
          companyId: ctx.companyId,
          name: input.name,
          categoryId: category.id,
          costCenterId: costCenter.id,
          cashAccountId: account.id,
          supplierId: input.supplierId ?? null,
          amount: input.amount,
          dayOfMonth: input.dayOfMonth,
          startsOn: input.startsOn ? asDate(input.startsOn) : businessDate(),
          createdBy: ctx.userId,
        },
      });
      await this.audit.log(tx, ctx, { entity: 'expense_template', entityId: template.id, action: 'create', diff: input });
      return template;
    });
  }

  /** Plantillas con los meses que faltan registrar hasta fin del mes en curso. */
  listTemplates(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const today = businessDate();
      const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
      const templates = await tx.expenseTemplate.findMany({
        orderBy: [{ isActive: 'desc' }, { dayOfMonth: 'asc' }, { name: 'asc' }],
        include: { category: { select: { name: true } }, costCenter: { select: { code: true, name: true } }, cashAccount: { select: { name: true } } },
      });
      const pending = await this.pendingInTx(tx, templates.filter((t) => t.isActive), today, monthEnd);
      const last = await tx.expense.groupBy({ by: ['templateId'], where: { templateId: { in: templates.map((t) => t.id) }, status: 'POSTED' }, _max: { period: true } });
      return templates.map(({ category, costCenter, cashAccount, ...t }) => ({
        ...t,
        amount: t.amount.toString(),
        category: category.name,
        costCenter: `${costCenter.code} · ${costCenter.name}`,
        account: cashAccount.name,
        lastPeriod: last.find((l) => l.templateId === t.id)?._max.period ?? null,
        pending: pending.filter((p) => p.templateId === t.id).map(({ period, dueDate }) => ({ period, dueDate, overdue: dueDate < today })),
      }));
    });
  }

  /** Meses sin registrar de las plantillas indicadas hasta `until` (lo usa también el flujo de fondos). */
  async pendingInTx(tx: Tx, templates: { id: string; dayOfMonth: number; startsOn: Date }[], today: Date, until: Date) {
    if (!templates.length) return [];
    const done = await tx.expense.findMany({ where: { templateId: { in: templates.map((t) => t.id) }, status: 'POSTED' }, select: { templateId: true, period: true } });
    return pendingRecurring(templates, new Set(done.map((d) => `${d.templateId}|${d.period}`)), today, until);
  }

  registerFromTemplate(ctx: RequestContext, templateId: string, input: ExpenseTemplateRegisterInput) {
    return this.uow.run(
      ctx,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM expense_templates WHERE id = ${templateId}::uuid FOR UPDATE`;
        const t = await tx.expenseTemplate.findUnique({ where: { id: templateId } });
        if (!t) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La plantilla no existe.', 404);
        if (!t.isActive) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'La plantilla está desactivada.');
        const already = await tx.expense.findFirst({ where: { templateId, period: input.period, status: 'POSTED' } });
        if (already) throw new DomainError(ErrorCodes.DUPLICADO, `${t.name} de ${input.period} ya está registrado (${already.number}).`, 409);
        const [y, m] = input.period.split('-').map(Number);
        const { expense } = await this.createInTx(
          tx,
          ctx,
          {
            date: input.date ?? new Date(Date.UTC(y!, m! - 1, t.dayOfMonth)).toISOString().slice(0, 10),
            categoryId: t.categoryId,
            costCenterId: t.costCenterId,
            cashAccountId: t.cashAccountId,
            supplierId: t.supplierId,
            description: `${t.name} · ${input.period}`,
            documentReference: input.documentReference,
            amount: input.amount ?? t.amount.toString(),
          },
          { templateId, period: input.period },
        );
        return expense;
      },
      { idempotent: true },
    );
  }

  setTemplateActive(ctx: RequestContext, templateId: string, isActive: boolean) {
    return this.uow.run(ctx, async (tx) => {
      const t = await tx.expenseTemplate.update({ where: { id: templateId }, data: { isActive } });
      await this.audit.log(tx, ctx, { entity: 'expense_template', entityId: t.id, action: isActive ? 'activate' : 'deactivate' });
      return t;
    });
  }

  /** Listado paginado más los totales del período por centro de costo y por categoría (sin anulados). */
  list(ctx: RequestContext, q: ExpenseQuery) {
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.ExpenseWhereInput = {
        ...(q.from || q.to
          ? {
              date: {
                ...(q.from ? { gte: asDate(q.from) } : {}),
                ...(q.to ? { lte: asDate(q.to) } : {}),
              },
            }
          : {}),
        ...(q.costCenterId ? { costCenterId: q.costCenterId } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      };
      const posted = { ...where, status: 'POSTED' as const };
      const [rows, total, byCostCenter, byCategory] = await Promise.all([
        tx.expense.findMany({
          where,
          include,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.expense.count({ where }),
        tx.expense.groupBy({
          by: ['costCenterId'],
          where: posted,
          _sum: { amount: true },
        }),
        tx.expense.groupBy({
          by: ['categoryId'],
          where: posted,
          _sum: { amount: true },
        }),
      ]);
      const [centers, categories] = await Promise.all([
        tx.costCenter.findMany({
          where: { id: { in: byCostCenter.map((r) => r.costCenterId) } },
        }),
        tx.category.findMany({
          where: { id: { in: byCategory.map((r) => r.categoryId) } },
        }),
      ]);
      const sum = (r: { _sum: { amount: Prisma.Decimal | null } }) => new Prisma.Decimal(r._sum.amount ?? 0);
      const byAmount = (a: { total: string }, b: { total: string }) => Number(b.total) - Number(a.total);
      return {
        total,
        rows: rows.map((r) => this.serialize(r)),
        totalAmount: byCostCenter.reduce((a, r) => a.plus(sum(r)), new Prisma.Decimal(0)).toFixed(2),
        byCostCenter: byCostCenter
          .map((r) => {
            const c = centers.find((x) => x.id === r.costCenterId);
            return {
              id: r.costCenterId,
              code: c?.code ?? '',
              name: c?.name ?? '',
              total: sum(r).toFixed(2),
            };
          })
          .sort(byAmount),
        byCategory: byCategory
          .map((r) => ({
            id: r.categoryId,
            name: categories.find((x) => x.id === r.categoryId)?.name ?? '',
            total: sum(r).toFixed(2),
          }))
          .sort(byAmount),
      };
    });
  }

  private async detailInTx(tx: Tx, id: string) {
    return this.serialize(await tx.expense.findUniqueOrThrow({ where: { id }, include }));
  }

  private serialize({ category, costCenter, cashAccount, ...e }: Prisma.ExpenseGetPayload<{ include: typeof include }>) {
    return {
      ...e,
      amount: e.amount.toString(),
      category: category.name,
      costCenter: `${costCenter.code} · ${costCenter.name}`,
      account: cashAccount.name,
    };
  }
}
