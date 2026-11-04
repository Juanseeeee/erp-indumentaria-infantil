import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CASHFLOW_KIND_LABELS, CashflowKind, CashflowQuery } from '@erp/contracts';
import { projectCashflow, signedAmount } from '@erp/domain-finance';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { ExpensesService } from './expenses.service';
import { businessDate } from '../common/dates';

const LIQUID = ['CASH_BOX', 'BANK', 'WALLET'] as const;
const OWN_CHEQUE_METHODS = ['OWN_CHEQUE', 'OWN_ECHEQ'];
const DAY = 86_400_000;
const MAX_ITEMS = 1000;

interface Item {
  date: Date;
  amount: Prisma.Decimal;
  kind: CashflowKind;
  description: string;
  party: string | null;
  overdue: boolean;
}

/**
 * Flujo de fondos proyectado semana a semana. Parte del saldo disponible hoy (cajas, bancos y
 * billeteras a fecha de valor) y suma lo que se espera: movimientos con fecha de valor futura (entre
 * ellos los cheques propios emitidos), cheques de terceros en cartera o depositados por su fecha de
 * pago, lo pendiente en tarjetas a acreditar y las facturas abiertas a cobrar y a pagar por vencimiento.
 * No se cuenta dos veces: un cobro con cheque ya bajó la factura y el cheque entra por su fecha.
 */
@Injectable()
export class CashflowService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly expenses: ExpensesService,
  ) {}

  project(ctx: RequestContext, q: CashflowQuery) {
    return this.uow.run(ctx, async (tx) => {
      const today = businessDate();
      const accounts = await tx.cashAccount.findMany({ where: { isActive: true, type: { in: [...LIQUID, 'CARD_CLEARING'] } } });
      const liquidIds = accounts.filter((a) => (LIQUID as readonly string[]).includes(a.type)).map((a) => a.id);
      const cardIds = accounts.filter((a) => a.type === 'CARD_CLEARING').map((a) => a.id);

      const [opening, future, cardAll, cheques, entries] = await Promise.all([
        tx.treasuryMovement.groupBy({ by: ['direction'], where: { cashAccountId: { in: liquidIds }, valueDate: { lte: today } }, _sum: { amount: true } }),
        tx.treasuryMovement.findMany({ where: { cashAccountId: { in: [...liquidIds, ...cardIds] }, valueDate: { gt: today } } }),
        tx.treasuryMovement.groupBy({ by: ['direction'], where: { cashAccountId: { in: cardIds } }, _sum: { amount: true } }),
        tx.cheque.findMany({ where: { ownership: 'THIRD', status: { in: ['IN_PORTFOLIO', 'DEPOSITED'] } } }),
        tx.accountEntry.findMany({ where: { openAmount: { gt: 0 } } }),
      ]);
      const net = (rows: { direction: 'IN' | 'OUT'; _sum: { amount: Prisma.Decimal | null } }[]) =>
        rows.reduce((a, r) => a.plus(signedAmount(r.direction, (r._sum.amount ?? 0).toString())), new Prisma.Decimal(0));

      const parties = await tx.party.findMany({
        where: { id: { in: [...new Set([...entries.map((e) => e.partyId), ...cheques.map((c) => c.receivedFromId).filter((x): x is string => !!x)])] } },
        select: { id: true, legalName: true },
      });
      const partyName = (id: string | null) => (id ? (parties.find((p) => p.id === id)?.legalName ?? null) : null);

      const items: Item[] = [];
      for (const m of future.filter((x) => liquidIds.includes(x.cashAccountId))) {
        const kind: CashflowKind = OWN_CHEQUE_METHODS.includes(m.paymentMethod ?? '') ? 'CHEQUES_PROPIOS' : 'DIFERIDOS';
        items.push({ date: m.valueDate, amount: new Prisma.Decimal(signedAmount(m.direction, m.amount.toString()).toString()), kind, description: m.concept, party: null, overdue: false });
      }
      // Tarjetas: se acredita lo que queda en la cuenta (su saldo total). Los cobros con fecha de valor futura
      // entran en su fecha; el resto, ya. Si se transfirió antes de la fecha, el saldo manda.
      const cardPending = net(cardAll);
      const cardFuture = future.filter((m) => cardIds.includes(m.cashAccountId) && m.direction === 'IN');
      const cardFutureTotal = cardFuture.reduce((a, m) => a.plus(m.amount), new Prisma.Decimal(0));
      if (cardPending.gte(cardFutureTotal)) {
        for (const m of cardFuture) items.push({ date: m.valueDate, amount: new Prisma.Decimal(m.amount), kind: 'TARJETAS', description: m.concept, party: null, overdue: false });
        const rest = cardPending.minus(cardFutureTotal);
        if (rest.gt(0)) items.push({ date: today, amount: rest, kind: 'TARJETAS', description: 'Saldo en tarjetas a acreditar', party: null, overdue: false });
      } else if (cardPending.gt(0)) {
        items.push({ date: today, amount: cardPending, kind: 'TARJETAS', description: 'Saldo en tarjetas a acreditar', party: null, overdue: false });
      }
      for (const c of cheques) {
        items.push({
          date: c.paymentDate,
          amount: new Prisma.Decimal(c.amount),
          kind: 'CHEQUES_A_COBRAR',
          description: `${c.isEcheq ? 'E-cheq' : 'Cheque'} ${c.bank} ${c.number}${c.status === 'DEPOSITED' ? ' (depositado)' : ''}`,
          party: partyName(c.receivedFromId),
          overdue: false,
        });
      }
      for (const e of entries) {
        const date = e.dueDate ?? e.date;
        const receivable = e.accountType === 'RECEIVABLE';
        items.push({
          date,
          amount: receivable ? new Prisma.Decimal(e.openAmount) : new Prisma.Decimal(e.openAmount).negated(),
          kind: receivable ? 'COBRANZAS' : 'PAGOS',
          description: e.description,
          party: partyName(e.partyId),
          overdue: date < today,
        });
      }

      // Gastos recurrentes que todavía no se registraron, por su día de vencimiento.
      const horizonEnd = projectCashflow('0', [], today, q.weeks).at(-1)!.to;
      const templates = await tx.expenseTemplate.findMany({ where: { isActive: true } });
      for (const p of await this.expenses.pendingInTx(tx, templates, today, horizonEnd)) {
        const t = templates.find((x) => x.id === p.templateId)!;
        items.push({ date: p.dueDate, amount: new Prisma.Decimal(t.amount).negated(), kind: 'GASTOS_FIJOS', description: `${t.name} · ${p.period}`, party: null, overdue: p.dueDate < today });
      }

      const overdue = items.filter((i) => i.overdue);
      const considered = q.includeOverdue ? items : items.filter((i) => !i.overdue);
      const openingBalance = net(opening);
      const buckets = projectCashflow(openingBalance.toString(), considered, today, q.weeks);
      const inHorizon = considered.filter((i) => i.date <= horizonEnd).sort((a, b) => a.date.getTime() - b.date.getTime() || a.amount.comparedTo(b.amount));
      const sumWhere = (pred: (i: Item) => boolean) => overdue.filter(pred).reduce((a, i) => a.plus(i.amount), new Prisma.Decimal(0)).toFixed(2);
      const firstNegative = buckets.find((b) => b.balance.isNegative());

      return {
        today,
        opening: openingBalance.toFixed(2),
        includeOverdue: q.includeOverdue,
        weeks: buckets.map((b) => ({
          from: b.from,
          to: b.to,
          inflow: b.inflow.toFixed(2),
          outflow: b.outflow.toFixed(2),
          balance: b.balance.toFixed(2),
          byKind: Object.fromEntries(Object.entries(b.byKind).map(([k, v]) => [k, v.toFixed(2)])),
        })),
        overdue: { receivable: sumWhere((i) => i.kind === 'COBRANZAS'), payable: sumWhere((i) => i.kind === 'PAGOS' || i.kind === 'GASTOS_FIJOS') },
        firstNegativeWeek: firstNegative ? firstNegative.from : null,
        kinds: CASHFLOW_KIND_LABELS,
        items: inHorizon.slice(0, MAX_ITEMS).map((i) => ({
          // Lo vencido se muestra en la primera semana, que es cuando debería cobrarse o pagarse.
          date: i.date,
          weekIndex: Math.max(0, Math.floor((i.date.getTime() - buckets[0]!.from.getTime()) / (7 * DAY))),
          amount: i.amount.toFixed(2),
          kind: i.kind,
          description: i.description,
          party: i.party,
          overdue: i.overdue,
        })),
        truncated: inHorizon.length > MAX_ITEMS,
      };
    });
  }
}
