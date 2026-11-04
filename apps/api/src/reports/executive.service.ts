import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { businessDate } from '../common/dates';
import { CashflowService } from '../treasury/cashflow.service';

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const money = (v: Prisma.Decimal | string | number | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);

/** Variación porcentual con un decimal; null si el período anterior es cero. */
function change(current: string, previous: string) {
  const p = new Prisma.Decimal(previous);
  if (p.isZero()) return null;
  return new Prisma.Decimal(current).minus(p).div(p.abs()).times(100).toDecimalPlaces(1).toNumber();
}

/**
 * Tablero de Dirección: el negocio en diez segundos. Cada indicador sigue la definición de
 * EXECUTIVE_METRICS (contracts) y docs/METRICS.md; todo se calcula al momento sobre datos reales.
 */
@Injectable()
export class ExecutiveService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly cashflow: CashflowService,
  ) {}

  async dashboard(ctx: RequestContext) {
    const today = businessDate();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const prevStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const prevEnd = new Date(Math.min(addDays(prevStart, today.getUTCDate() - 1).getTime(), addDays(monthStart, -1).getTime()));

    const data = await this.uow.run(ctx, async (tx) => {
      const [salesNow, salesPrev, collectedNow, collectedPrev, availableNow, availablePrev] = await Promise.all([
        this.sales(tx, monthStart, today),
        this.sales(tx, prevStart, prevEnd),
        this.collected(tx, monthStart, today),
        this.collected(tx, prevStart, prevEnd),
        this.available(tx, today),
        this.available(tx, prevEnd),
      ]);
      const [cheques, overdue, payables] = await Promise.all([
        tx.cheque.aggregate({ where: { ownership: 'THIRD', status: 'IN_PORTFOLIO', paymentDate: { lte: addDays(today, 30) } }, _sum: { amount: true }, _count: true }),
        tx.accountEntry.aggregate({ where: { accountType: 'RECEIVABLE', openAmount: { gt: 0 }, dueDate: { lt: today } }, _sum: { openAmount: true }, _count: true }),
        tx.accountEntry.aggregate({ where: { accountType: 'PAYABLE', openAmount: { gt: 0 }, OR: [{ dueDate: { lte: addDays(today, 30) } }, { dueDate: null }] }, _sum: { openAmount: true }, _count: true }),
      ]);
      return {
        kpis: {
          sales: { value: salesNow, previous: salesPrev, change: change(salesNow, salesPrev), href: '/ventas/comprobantes' },
          collected: { value: collectedNow, previous: collectedPrev, change: change(collectedNow, collectedPrev), href: '/cobros' },
          available: { value: availableNow, previous: availablePrev, change: change(availableNow, availablePrev), href: '/tesoreria' },
          chequesDue: { value: money(cheques._sum.amount), count: cheques._count, href: '/tesoreria' },
          overdueReceivables: { value: money(overdue._sum.openAmount), count: overdue._count, href: '/cuentas-a-cobrar' },
          payablesDue: { value: money(payables._sum.openAmount), count: payables._count, href: '/cuentas-a-pagar' },
        },
        attention: await this.attention(tx, today),
        topProducts: await this.topProducts(tx, addDays(today, -29), today),
        idleProducts: await this.idleProducts(tx, addDays(today, -90)),
        production: await this.production(tx),
      };
    });
    const flow = await this.cashflow.project(ctx, { weeks: 8, includeOverdue: true });
    return {
      today,
      period: { from: monthStart, to: today, previousFrom: prevStart, previousTo: prevEnd },
      ...data,
      cashflow: { opening: flow.opening, weeks: flow.weeks.map(({ byKind: _byKind, ...w }) => w), firstNegativeWeek: flow.firstNegativeWeek },
    };
  }

  /** Facturación neta de IVA: F + ND − NC vigentes. */
  private async sales(tx: Tx, from: Date, to: Date) {
    const [row] = await tx.$queryRaw<{ net: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN doc_type LIKE 'NC%' THEN -net_total ELSE net_total END), 0)::text AS net
      FROM fiscal_documents
      WHERE direction = 'SALE' AND status = 'POSTED' AND issue_date BETWEEN ${from}::date AND ${to}::date`;
    return money(row?.net);
  }

  private async collected(tx: Tx, from: Date, to: Date) {
    const r = await tx.customerReceipt.aggregate({ where: { status: 'POSTED', date: { gte: from, lte: to } }, _sum: { total: true } });
    return money(r._sum.total);
  }

  /** Cajas, bancos y billeteras activas a fecha de valor. */
  private async available(tx: Tx, at: Date) {
    const [row] = await tx.$queryRaw<{ balance: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END), 0)::text AS balance
      FROM treasury_movements m JOIN cash_accounts a ON a.id = m.cash_account_id
      WHERE a.is_active AND a.type IN ('CASH_BOX', 'BANK', 'WALLET') AND m.value_date <= ${at}::date`;
    return money(row?.balance);
  }

  /** Lo que pide intervención: cheques rechazados, OP atrasadas, materiales faltantes y clientes excedidos. */
  private async attention(tx: Tx, today: Date) {
    const [rejected, lateOrders, overLimit, shortages] = await Promise.all([
      tx.$queryRaw<{ id: string; bank: string; number: string; amount: string; date: Date; customer: string | null }[]>`
        SELECT c.id, c.bank, c.number, c.amount::text AS amount, e.date, p.legal_name AS customer
        FROM cheque_events e JOIN cheques c ON c.id = e.cheque_id LEFT JOIN parties p ON p.id = c.received_from_id
        WHERE e.event = 'REJECT' AND e.date >= ${addDays(today, -30)}::date
        ORDER BY e.date DESC LIMIT 10`,
      tx.productionOrder.findMany({
        where: { status: { in: ['RELEASED', 'IN_PROGRESS'] }, dueDate: { lt: today } },
        select: { id: true, number: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      tx.$queryRaw<{ id: string; name: string; limit: string; balance: string }[]>`
        SELECT p.id, p.legal_name AS name, cp.credit_limit::text AS limit, SUM(e.amount)::text AS balance
        FROM customer_profiles cp JOIN parties p ON p.id = cp.party_id
        JOIN account_entries e ON e.party_id = cp.party_id AND e.account_type = 'RECEIVABLE'
        WHERE cp.credit_limit IS NOT NULL
        GROUP BY p.id, p.legal_name, cp.credit_limit
        HAVING SUM(e.amount) > cp.credit_limit
        ORDER BY SUM(e.amount) - cp.credit_limit DESC LIMIT 10`,
      tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM production_requirements r JOIN production_orders o ON o.id = r.order_id
        WHERE o.status IN ('RELEASED', 'IN_PROGRESS') AND r.required_qty > r.issued_qty
          AND NOT EXISTS (
            SELECT 1 FROM stock_balances b WHERE b.item_id = r.material_item_id AND b.warehouse_id = o.materials_warehouse_id
            GROUP BY b.item_id HAVING SUM(b.on_hand) >= r.required_qty - r.issued_qty
          )`,
    ]);
    return {
      rejectedCheques: rejected.map((r) => ({ ...r, amount: money(r.amount) })),
      lateOrders,
      customersOverLimit: overLimit.map((c) => ({ ...c, limit: money(c.limit), balance: money(c.balance) })),
      materialShortages: Number(shortages[0]?.count ?? 0),
    };
  }

  /** Modelos más facturados (neto) en los últimos 30 días. */
  private topProducts(tx: Tx, from: Date, to: Date) {
    return tx.$queryRaw<{ id: string; name: string; units: string; net: string }[]>`
      SELECT p.id, p.name,
             SUM(CASE WHEN d.doc_type LIKE 'NC%' THEN -l.qty ELSE l.qty END)::text AS units,
             ROUND(SUM(CASE WHEN d.doc_type LIKE 'NC%' THEN -l.net ELSE l.net END), 2)::text AS net
      FROM fiscal_document_lines l
      JOIN fiscal_documents d ON d.id = l.document_id
      JOIN product_variants v ON v.item_id = l.item_id
      JOIN products p ON p.id = v.product_id
      WHERE d.direction = 'SALE' AND d.status = 'POSTED' AND d.issue_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY p.id, p.name
      HAVING SUM(CASE WHEN d.doc_type LIKE 'NC%' THEN -l.net ELSE l.net END) > 0
      ORDER BY SUM(CASE WHEN d.doc_type LIKE 'NC%' THEN -l.net ELSE l.net END) DESC
      LIMIT 10`;
  }

  /** Modelos con stock que no se entregaron a clientes en 90 días (candidatos a liquidar). */
  private idleProducts(tx: Tx, since: Date) {
    return tx.$queryRaw<{ id: string; name: string; units: string }[]>`
      SELECT p.id, p.name, SUM(b.on_hand)::text AS units
      FROM products p
      JOIN product_variants v ON v.product_id = p.id
      JOIN stock_balances b ON b.item_id = v.item_id
      WHERE NOT EXISTS (
        SELECT 1 FROM stock_movements m JOIN product_variants v2 ON v2.item_id = m.item_id
        WHERE v2.product_id = p.id AND m.type = 'SALE_DELIVERY' AND m.occurred_at >= ${since}::date
      )
      GROUP BY p.id, p.name
      HAVING SUM(b.on_hand) > 0
      ORDER BY SUM(b.on_hand) DESC
      LIMIT 10`;
  }

  /** Producción en curso: por etapa, unidades terminadas sobre las planificadas en OP liberadas o en proceso. */
  private production(tx: Tx) {
    return tx.$queryRaw<{ stage: string; sort_order: number; orders: bigint; planned: string; completed: string }[]>`
      SELECT s.name AS stage, MIN(s.sort_order) AS sort_order, COUNT(DISTINCT o.id) AS orders,
             SUM(q.planned)::text AS planned, SUM(os.completed_qty)::text AS completed
      FROM production_order_stages os
      JOIN production_orders o ON o.id = os.order_id
      JOIN production_stages s ON s.id = os.stage_id
      JOIN (SELECT order_id, SUM(planned_qty) AS planned FROM production_order_lines GROUP BY order_id) q ON q.order_id = o.id
      WHERE o.status IN ('RELEASED', 'IN_PROGRESS')
      GROUP BY s.name
      ORDER BY MIN(s.sort_order)`.then((rows) => rows.map((r) => ({ stage: r.stage, orders: Number(r.orders), planned: r.planned, completed: r.completed })));
  }
}
