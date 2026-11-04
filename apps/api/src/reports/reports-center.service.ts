import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { REPORTS, findReport, reportParamsSchema, type ReportColumn, type ReportDefinition, type ReportFormat, type ReportResult } from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { BUSINESS_TZ, businessDate } from '../common/dates';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import { CashflowService } from '../treasury/cashflow.service';
import { ProfitabilityService } from './profitability.service';
import { exportFileName, toPdf, toXlsx } from './report-export';

type Params = Record<string, string | number | undefined>;
type Row = Record<string, string | number | null>;
interface Table {
  columns: ReportColumn[];
  rows: Row[];
  totals?: Row | null;
  notes?: string[];
}

const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const money = (v: Prisma.Decimal.Value | null | undefined) => D(v).toFixed(2);
const qty = (v: Prisma.Decimal.Value | null | undefined) => D(v).toString();
const pct = (part: Prisma.Decimal.Value, base: Prisma.Decimal.Value) => (D(base).isZero() ? null : D(part).div(D(base).abs()).times(100).toDecimalPlaces(1).toNumber());
const ymd = (d: Date | string | null) => (d == null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const dmy = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
const sum = (rows: Row[], key: string) => rows.reduce((a, r) => a.plus(D(r[key] ?? 0)), D(0));
const col = (key: string, label: string, type: ReportColumn['type'] = 'text'): ReportColumn => ({ key, label, type });

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: 'Stock inicial',
  PURCHASE_RECEIPT: 'Recepción de compra',
  PURCHASE_RETURN: 'Devolución a proveedor',
  SALE_DELIVERY: 'Entrega (remito)',
  SALE_RETURN: 'Devolución de cliente',
  PROD_ISSUE: 'Consumo de producción',
  PROD_RETURN: 'Devolución de producción',
  PROD_OUTPUT: 'Ingreso de producción',
  PROD_SCRAP: 'Descarte de producción',
  TRANSFER_OUT: 'Transferencia (salida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  ADJUSTMENT: 'Ajuste',
  COUNT_ADJUSTMENT: 'Ajuste por inventario',
};
const ORDER_STATUS: Record<string, string> = { RELEASED: 'Liberada', IN_PROGRESS: 'En proceso', COMPLETED: 'Terminada' };
const PRIORITY: Record<number, string> = { 1: 'Alta', 2: 'Normal', 3: 'Baja' };
const CHEQUE_STATUS: Record<string, string> = {
  IN_PORTFOLIO: 'En cartera',
  DELIVERED: 'Entregado',
  DEPOSITED: 'Depositado',
  CREDITED: 'Acreditado',
  REJECTED: 'Rechazado',
  RETURNED: 'Devuelto',
};
const ACCOUNT_TYPES: Record<string, string> = { CASH_BOX: 'Caja', BANK: 'Banco', WALLET: 'Billetera', CARD_CLEARING: 'Tarjetas a acreditar', CHEQUE_PORTFOLIO: 'Cartera de cheques' };

/** Unidades vendidas por línea: las NC solo restan si hubo devolución; los conceptos sin artículo no suman. */
const UNITS_SQL = Prisma.sql`CASE WHEN l.item_id IS NULL THEN 0 WHEN d.doc_type LIKE 'NC%' THEN CASE WHEN d.return_warehouse_id IS NOT NULL THEN -l.qty ELSE 0 END ELSE l.qty END`;
const NET_SQL = Prisma.sql`CASE WHEN d.doc_type LIKE 'NC%' THEN -l.net ELSE l.net END`;

/**
 * Centro de reportes (RF §12). Cada reporte devuelve una tabla tipada; la pantalla, el Excel y el PDF salen
 * del mismo resultado. Los permisos y parámetros vienen del catálogo compartido (contracts/reports.ts).
 */
@Injectable()
export class ReportsCenterService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly cashflow: CashflowService,
    private readonly profitability: ProfitabilityService,
    private readonly audit: AuditService,
  ) {}

  /** Reportes que el usuario puede abrir. */
  catalog(ctx: RequestContext) {
    return (REPORTS as readonly ReportDefinition[]).filter((r) => r.permissions.every((p) => ctx.permissions.has(p)));
  }

  definition(ctx: RequestContext, code: string) {
    const def = findReport(code);
    if (!def) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El reporte no existe.', 404);
    const missing = def.permissions.filter((p) => !ctx.permissions.has(p));
    if (missing.length) throw new DomainError(ErrorCodes.SIN_PERMISO, `No tenés permiso para este reporte (${missing.join(', ')}).`, 403);
    return def;
  }

  async run(ctx: RequestContext, code: string, raw: Record<string, unknown>): Promise<ReportResult> {
    const def = this.definition(ctx, code);
    const today = ymd(businessDate())!;
    const parsed = reportParamsSchema(def, { today }).safeParse(raw);
    if (!parsed.success) throw new DomainError(ErrorCodes.VALIDACION, parsed.error.issues[0]?.message ?? 'Parámetros inválidos.', 400);
    const p = parsed.data as Params;
    const table = await this.table(ctx, def.code, p, today);
    return {
      code: def.code,
      title: def.title,
      subtitle: await this.subtitle(ctx, def, p),
      columns: table.columns,
      rows: table.rows,
      totals: table.totals ?? null,
      notes: table.notes ?? [],
      generatedAt: new Date().toISOString(),
    };
  }

  /** Excel o PDF del mismo resultado que se ve en pantalla. Queda en auditoría (qué, con qué parámetros y quién). */
  async export(ctx: RequestContext, code: string, raw: Record<string, unknown>, format: ReportFormat) {
    const result = await this.run(ctx, code, raw);
    const meta = await this.uow.run(ctx, async (tx) => {
      const [company, user] = await Promise.all([
        tx.company.findUnique({ where: { id: ctx.companyId }, select: { legalName: true, tradeName: true } }),
        tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
      ]);
      await this.audit.log(tx, ctx, { entity: 'report', entityId: code, action: 'export', diff: { format, subtitle: result.subtitle, rows: result.rows.length } });
      return { company: company?.tradeName ?? company?.legalName ?? '', user: user?.name ?? '' };
    });
    return format === 'xlsx'
      ? { buffer: await toXlsx(result, meta), fileName: exportFileName(result, 'xlsx'), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      : { buffer: await toPdf(result, meta), fileName: exportFileName(result, 'pdf'), type: 'application/pdf' };
  }

  private async subtitle(ctx: RequestContext, def: ReportDefinition, p: Params) {
    const parts: string[] = [];
    if (typeof p.from === 'string' && typeof p.to === 'string') parts.push(`Del ${dmy(p.from)} al ${dmy(p.to)}`);
    for (const param of def.params) {
      const v = p[param.key];
      if (param.type === 'select') parts.push(`${param.label}: ${param.options.find((o) => o.value === v)?.label ?? v}`);
      else if (param.type === 'int') parts.push(`${param.label}: ${v}`);
      else if (param.type === 'text' && v) parts.push(`${param.label}: ${v}`);
      else if (param.type === 'warehouse') {
        const wh = v ? await this.uow.run(ctx, (tx) => tx.warehouse.findUnique({ where: { id: String(v) }, select: { name: true } })) : null;
        parts.push(`${param.label}: ${wh?.name ?? 'todos'}`);
      }
    }
    if (!def.params.some((x) => x.type === 'date')) parts.unshift(`Al ${dmy(ymd(businessDate())!)}`);
    return parts.join(' · ');
  }

  private table(ctx: RequestContext, code: string, p: Params, today: string): Promise<Table> {
    const costs = ctx.permissions.has('costs.view');
    switch (code) {
      case 'ventas':
        return this.uow.run(ctx, (tx) => this.sales(tx, p));
      case 'ranking':
        return this.uow.run(ctx, (tx) => this.ranking(tx, p));
      case 'baja-rotacion':
        return this.uow.run(ctx, (tx) => this.slowMovers(tx, Number(p.days), today));
      case 'pedidos-pendientes':
        return this.uow.run(ctx, (tx) => this.pendingOrders(tx, today));
      case 'rentabilidad':
        return this.margin(ctx, p);
      case 'stock-valorizado':
        return this.uow.run(ctx, (tx) => this.valuedStock(tx, p.warehouseId as string | undefined));
      case 'stock-critico':
        return this.uow.run(ctx, (tx) => this.criticalStock(tx));
      case 'kardex':
        return this.uow.run(ctx, (tx) => this.kardex(tx, p, costs));
      case 'op-abiertas':
        return this.uow.run(ctx, (tx) => this.openOrders(tx, today));
      case 'materiales-talleres':
        return this.uow.run(ctx, (tx) => this.atWorkshops(tx, costs));
      case 'antiguedad-cobrar':
        return this.uow.run(ctx, (tx) => this.aging(tx, 'RECEIVABLE', today));
      case 'antiguedad-pagar':
        return this.uow.run(ctx, (tx) => this.aging(tx, 'PAYABLE', today));
      case 'cheques':
        return this.uow.run(ctx, (tx) => this.cheques(tx, String(p.status), today));
      case 'caja-bancos':
        return this.uow.run(ctx, (tx) => this.cashAndBanks(tx, p));
      case 'flujo-90':
        return this.flow(ctx);
      case 'gastos':
        return this.uow.run(ctx, (tx) => this.expenses(tx, p));
      default:
        throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'El reporte no existe.', 404);
    }
  }

  // ─── Ventas ───

  private async sales(tx: Tx, p: Params): Promise<Table> {
    const g = String(p.groupBy);
    const dim = {
      month: { key: Prisma.sql`to_char(d.issue_date, 'YYYY-MM')`, label: Prisma.sql`to_char(d.issue_date, 'YYYY-MM')`, code: Prisma.sql`NULL::text`, title: 'Mes' },
      customer: { key: Prisma.sql`pa.id::text`, label: Prisma.sql`pa.legal_name`, code: Prisma.sql`pa.tax_id`, title: 'Cliente' },
      seller: { key: Prisma.sql`u.id::text`, label: Prisma.sql`COALESCE(u.name, 'Sin vendedor asignado')`, code: Prisma.sql`NULL::text`, title: 'Vendedor' },
      product: { key: Prisma.sql`p.id::text`, label: Prisma.sql`COALESCE(p.name, 'Otros conceptos (fletes, bonificaciones)')`, code: Prisma.sql`p.code`, title: 'Modelo' },
    }[g]!;
    const rows = await tx.$queryRaw<{ key: string | null; label: string; code: string | null; docs: bigint; units: string; net: string }[]>`
      SELECT ${dim.key} AS key, ${dim.label} AS label, ${dim.code} AS code, COUNT(DISTINCT d.id) AS docs,
             SUM(${UNITS_SQL})::text AS units, ROUND(SUM(${NET_SQL}), 2)::text AS net
      FROM fiscal_document_lines l
      JOIN fiscal_documents d ON d.id = l.document_id
      LEFT JOIN parties pa ON pa.id = d.party_id
      LEFT JOIN users u ON u.id = d.seller_user_id
      LEFT JOIN product_variants v ON v.item_id = l.item_id
      LEFT JOIN products p ON p.id = v.product_id
      WHERE d.direction = 'SALE' AND d.status = 'POSTED' AND d.issue_date BETWEEN ${p.from}::date AND ${p.to}::date
      GROUP BY 1, 2, 3
      ORDER BY ${g === 'month' ? Prisma.sql`1` : Prisma.sql`SUM(${NET_SQL}) DESC`}`;
    const [count] = await tx.$queryRaw<{ docs: bigint }[]>`
      SELECT COUNT(*) AS docs FROM fiscal_documents d
      WHERE d.direction = 'SALE' AND d.status = 'POSTED' AND d.issue_date BETWEEN ${p.from}::date AND ${p.to}::date`;
    const total = rows.reduce((a, r) => a.plus(D(r.net)), D(0));
    const out = rows.map((r) => ({
      label: g === 'month' ? `${MONTHS[Number(r.label.slice(5, 7)) - 1]} ${r.label.slice(0, 4)}` : r.label,
      code: r.code,
      docs: Number(r.docs),
      units: qty(r.units),
      net: money(r.net),
      share: pct(r.net, total),
    }));
    return {
      columns: [col('label', dim.title), ...(g === 'customer' ? [col('code', 'CUIT')] : g === 'product' ? [col('code', 'Código')] : []), col('docs', 'Comprobantes', 'int'), col('units', 'Unidades', 'qty'), col('net', 'Neto', 'money'), col('share', '% del total', 'pct')],
      rows: out,
      totals: { label: 'Total', docs: Number(count?.docs ?? 0), units: sum(out, 'units').toString(), net: total.toFixed(2), share: out.length ? 100 : null },
      notes: ['Neto de IVA: facturas y notas de débito menos notas de crédito vigentes. Las notas de crédito solo restan unidades cuando hubo devolución.'],
    };
  }

  private async ranking(tx: Tx, p: Params): Promise<Table> {
    const rows = await tx.$queryRaw<{ code: string; name: string; units: string; net: string }[]>`
      SELECT p.code, p.name, SUM(${UNITS_SQL})::text AS units, ROUND(SUM(${NET_SQL}), 2)::text AS net
      FROM fiscal_document_lines l
      JOIN fiscal_documents d ON d.id = l.document_id
      JOIN product_variants v ON v.item_id = l.item_id
      JOIN products p ON p.id = v.product_id
      WHERE d.direction = 'SALE' AND d.status = 'POSTED' AND d.issue_date BETWEEN ${p.from}::date AND ${p.to}::date
      GROUP BY p.id, p.code, p.name
      ORDER BY SUM(${NET_SQL}) DESC, p.name`;
    const total = rows.reduce((a, r) => a.plus(D(r.net)), D(0));
    let acc = D(0);
    const out = rows.map((r, i) => {
      const before = pct(acc, total) ?? 0;
      acc = acc.plus(D(r.net));
      return {
        rank: i + 1,
        code: r.code,
        name: r.name,
        units: qty(r.units),
        net: money(r.net),
        share: pct(r.net, total),
        cumulative: pct(acc, total),
        // ABC: A hasta el 80 % del total acumulado, B hasta el 95 %, el resto C (por dónde empieza el modelo).
        abc: before < 80 ? 'A' : before < 95 ? 'B' : 'C',
      };
    });
    return {
      columns: [col('rank', 'N.º', 'int'), col('code', 'Código'), col('name', 'Modelo'), col('units', 'Unidades', 'qty'), col('net', 'Neto', 'money'), col('share', '% del total', 'pct'), col('cumulative', '% acumulado', 'pct'), col('abc', 'Clase')],
      rows: out,
      totals: { name: 'Total', units: sum(out, 'units').toString(), net: total.toFixed(2), share: out.length ? 100 : null },
      notes: ['Clase A: modelos que juntan el primer 80 % de la facturación; B: hasta el 95 %; C: el resto.'],
    };
  }

  private async slowMovers(tx: Tx, days: number, today: string): Promise<Table> {
    const rows = await tx.$queryRaw<{ code: string; name: string; units: string; last: Date | null }[]>`
      SELECT p.code, p.name, SUM(b.on_hand)::text AS units,
             (SELECT MAX((m.occurred_at AT TIME ZONE ${BUSINESS_TZ})::date) FROM stock_movements m JOIN product_variants v2 ON v2.item_id = m.item_id
              WHERE v2.product_id = p.id AND m.type = 'SALE_DELIVERY') AS last
      FROM products p
      JOIN product_variants v ON v.product_id = p.id
      JOIN stock_balances b ON b.item_id = v.item_id
      JOIN warehouses w ON w.id = b.warehouse_id AND w.type = 'OWN'
      GROUP BY p.id, p.code, p.name
      HAVING SUM(b.on_hand) > 0`;
    const limit = new Date(`${today}T00:00:00.000Z`).getTime() - days * 86_400_000;
    const out = rows
      .filter((r) => !r.last || r.last.getTime() < limit)
      .map((r) => ({
        code: r.code,
        name: r.name,
        units: qty(r.units),
        last: ymd(r.last),
        days: r.last ? Math.round((new Date(`${today}T00:00:00.000Z`).getTime() - r.last.getTime()) / 86_400_000) : null,
      }))
      .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || D(b.units).comparedTo(D(a.units)));
    return {
      columns: [col('code', 'Código'), col('name', 'Modelo'), col('units', 'Stock (u.)', 'qty'), col('last', 'Última entrega', 'date'), col('days', 'Días sin ventas', 'int')],
      rows: out,
      totals: { name: 'Total', units: sum(out, 'units').toString() },
      notes: ['Stock en depósitos propios. "Última entrega" es el último remito a un cliente; vacío si nunca se vendió.'],
    };
  }

  private async pendingOrders(tx: Tx, today: string): Promise<Table> {
    const rows = await tx.$queryRaw<{ number: string; customer: string; date: Date; promised: Date | null; units: string; net: string }[]>`
      SELECT o.number, pa.legal_name AS customer, o.order_date AS date, o.promised_at AS promised,
             SUM(l.qty - l.delivered_qty - l.cancelled_qty)::text AS units,
             ROUND(SUM((l.qty - l.delivered_qty - l.cancelled_qty) * l.unit_price * (1 - l.discount_pct / 100)), 2)::text AS net
      FROM sales_orders o
      JOIN sales_order_lines l ON l.order_id = o.id
      JOIN parties pa ON pa.id = o.customer_id
      WHERE o.status IN ('CONFIRMED', 'PARTIALLY_DELIVERED') AND l.qty - l.delivered_qty - l.cancelled_qty > 0
      GROUP BY o.id, o.number, pa.legal_name, o.order_date, o.promised_at
      ORDER BY o.promised_at NULLS LAST, o.order_date`;
    const t = new Date(`${today}T00:00:00.000Z`).getTime();
    const out = rows.map((r) => ({
      number: r.number,
      customer: r.customer,
      date: ymd(r.date),
      promised: ymd(r.promised),
      late: r.promised && r.promised.getTime() < t ? Math.round((t - r.promised.getTime()) / 86_400_000) : null,
      units: qty(r.units),
      net: money(r.net),
    }));
    return {
      columns: [col('number', 'Pedido'), col('customer', 'Cliente'), col('date', 'Fecha', 'date'), col('promised', 'Prometido', 'date'), col('late', 'Días de atraso', 'int'), col('units', 'Unidades pendientes', 'qty'), col('net', 'Neto pendiente', 'money')],
      rows: out,
      totals: { number: 'Total', units: sum(out, 'units').toString(), net: sum(out, 'net').toFixed(2) },
      notes: ['Pendiente = pedido − entregado − cancelado. El neto es a precio del pedido, con descuento y sin IVA.'],
    };
  }

  private async margin(ctx: RequestContext, p: Params): Promise<Table> {
    const r = await this.profitability.report(ctx, { from: String(p.from), to: String(p.to), groupBy: p.groupBy as 'product' });
    const title = { product: 'Modelo', category: 'Categoría', customer: 'Cliente', order: 'Pedido', seller: 'Vendedor' }[String(p.groupBy)] ?? 'Detalle';
    return {
      columns: [col('label', title), col('sub', 'Detalle'), col('units', 'Unidades', 'qty'), col('net', 'Vendido neto', 'money'), col('cost', 'Costo', 'money'), col('margin', 'Margen bruto estimado', 'money'), col('marginPct', 'Margen %', 'pct')],
      rows: r.rows.map((x) => ({ label: x.label, sub: x.sub, units: x.units, net: x.net, cost: x.cost, margin: x.margin, marginPct: x.marginPct })),
      totals: { label: 'Total', units: r.totals.units, net: r.totals.net, cost: r.totals.cost, margin: r.totals.margin, marginPct: r.totals.marginPct },
      notes: [
        'Margen bruto estimado: vendido neto menos el costo de salida de los remitos. No descuenta gastos, comisiones ni impuestos; no es el resultado contable.',
        ...(D(r.totals.uncostedUnits).gt(0) ? [`${r.totals.uncostedUnits} unidades vendidas no tienen costo cargado: el margen está sobreestimado.`] : []),
      ],
    };
  }

  // ─── Inventario ───

  private async valuedStock(tx: Tx, warehouseId?: string): Promise<Table> {
    const rows = await tx.$queryRaw<{ sku: string; name: string; kind: string; warehouse: string; qty: string; value: string }[]>`
      SELECT i.sku, i.name, i.kind::text AS kind, w.name AS warehouse, SUM(b.on_hand)::text AS qty, ROUND(SUM(b.on_hand * b.avg_cost), 2)::text AS value
      FROM stock_balances b
      JOIN items i ON i.id = b.item_id
      JOIN warehouses w ON w.id = b.warehouse_id
      WHERE ${warehouseId ? Prisma.sql`b.warehouse_id = ${warehouseId}::uuid` : Prisma.sql`TRUE`}
      GROUP BY i.id, i.sku, i.name, i.kind, w.id, w.name
      HAVING SUM(b.on_hand) <> 0
      ORDER BY w.name, i.kind, i.sku`;
    const out = rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      kind: r.kind === 'VARIANT' ? 'Prenda' : 'Material',
      warehouse: r.warehouse,
      qty: qty(r.qty),
      avgCost: D(r.qty).isZero() ? null : D(r.value).div(D(r.qty)).toFixed(2),
      value: money(r.value),
    }));
    return {
      columns: [col('sku', 'SKU'), col('name', 'Artículo'), col('kind', 'Tipo'), col('warehouse', 'Depósito'), col('qty', 'Cantidad', 'qty'), col('avgCost', 'Costo promedio', 'money'), col('value', 'Valor', 'money')],
      rows: out,
      totals: { sku: 'Total', value: sum(out, 'value').toFixed(2) },
      notes: ['Valuación a costo promedio ponderado por depósito (ADR-007). Las cantidades están en la unidad base de cada artículo.'],
    };
  }

  private async criticalStock(tx: Tx): Promise<Table> {
    const rows = await tx.$queryRaw<{ sku: string; name: string; kind: string; on_hand: string; reserved: string; min: string; reorder: string | null }[]>`
      SELECT i.sku, i.name, i.kind::text AS kind, COALESCE(SUM(b.on_hand), 0)::text AS on_hand, COALESCE(SUM(b.reserved), 0)::text AS reserved,
             i.min_stock::text AS min, i.reorder_qty::text AS reorder
      FROM items i
      LEFT JOIN stock_balances b ON b.item_id = i.id AND b.warehouse_id IN (SELECT id FROM warehouses WHERE type = 'OWN')
      WHERE i.is_active AND i.min_stock IS NOT NULL
      GROUP BY i.id, i.sku, i.name, i.kind, i.min_stock, i.reorder_qty
      HAVING COALESCE(SUM(b.on_hand), 0) < i.min_stock
      ORDER BY i.kind, i.sku`;
    const out = rows.map((r) => {
      const shortage = D(r.min).minus(D(r.on_hand));
      return {
        sku: r.sku,
        name: r.name,
        kind: r.kind === 'VARIANT' ? 'Prenda' : 'Material',
        onHand: qty(r.on_hand),
        reserved: qty(r.reserved),
        min: qty(r.min),
        shortage: shortage.toString(),
        suggested: Prisma.Decimal.max(shortage, D(r.reorder ?? 0)).toString(),
      };
    });
    return {
      columns: [col('sku', 'SKU'), col('name', 'Artículo'), col('kind', 'Tipo'), col('onHand', 'Stock', 'qty'), col('reserved', 'Reservado', 'qty'), col('min', 'Mínimo', 'qty'), col('shortage', 'Faltante', 'qty'), col('suggested', 'Reposición sugerida', 'qty')],
      rows: out,
      notes: ['Stock en depósitos propios. Reposición sugerida: el mayor entre el faltante y la cantidad de reposición del artículo.'],
    };
  }

  private async kardex(tx: Tx, p: Params, costs: boolean): Promise<Table> {
    const item = await tx.item.findFirst({ where: { sku: { equals: String(p.sku), mode: 'insensitive' } }, select: { id: true, sku: true, name: true } });
    if (!item) throw new DomainError(ErrorCodes.NO_ENCONTRADO, `No existe un artículo con SKU ${p.sku}.`, 404);
    const wh = p.warehouseId ? Prisma.sql`AND m.warehouse_id = ${String(p.warehouseId)}::uuid` : Prisma.empty;
    const [opening] = await tx.$queryRaw<{ qty: string }[]>`
      SELECT COALESCE(SUM(m.qty), 0)::text AS qty FROM stock_movements m
      WHERE m.item_id = ${item.id}::uuid AND (m.occurred_at AT TIME ZONE ${BUSINESS_TZ})::date < ${p.from}::date ${wh}`;
    const moves = await tx.$queryRaw<{ date: Date; type: string; warehouse: string; doc: string | null; reason: string | null; qty: string; unit_cost: string }[]>`
      SELECT (m.occurred_at AT TIME ZONE ${BUSINESS_TZ})::date AS date, m.type::text AS type, w.name AS warehouse, m.reason, m.qty::text AS qty, m.unit_cost::text AS unit_cost,
             COALESCE(
               (SELECT number FROM delivery_notes WHERE id = m.source_doc_id),
               (SELECT number FROM goods_receipts WHERE id = m.source_doc_id),
               (SELECT number FROM stock_documents WHERE id = m.source_doc_id),
               (SELECT number FROM inventory_counts WHERE id = m.source_doc_id),
               (SELECT number FROM production_orders WHERE id = m.source_doc_id),
               (SELECT number FROM production_outputs WHERE id = m.source_doc_id),
               (SELECT number FROM workshop_dispatches WHERE id = m.source_doc_id)
             ) AS doc
      FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.item_id = ${item.id}::uuid AND (m.occurred_at AT TIME ZONE ${BUSINESS_TZ})::date BETWEEN ${p.from}::date AND ${p.to}::date ${wh}
      ORDER BY m.occurred_at, m.id`;
    let balance = D(opening?.qty);
    const rows: Row[] = [{ date: String(p.from), type: 'Saldo inicial', warehouse: null, doc: null, in: null, out: null, balance: balance.toString(), ...(costs ? { unitCost: null } : {}) }];
    for (const m of moves) {
      const q = D(m.qty);
      balance = balance.plus(q);
      rows.push({
        date: ymd(m.date),
        type: MOVEMENT_LABELS[m.type] ?? m.type,
        warehouse: m.warehouse,
        doc: [m.doc, m.reason].filter(Boolean).join(' · ') || null,
        in: q.gt(0) ? q.toString() : null,
        out: q.lt(0) ? q.abs().toString() : null,
        balance: balance.toString(),
        ...(costs ? { unitCost: money(m.unit_cost) } : {}),
      });
    }
    return {
      columns: [col('date', 'Fecha', 'date'), col('type', 'Movimiento'), col('warehouse', 'Depósito'), col('doc', 'Documento'), col('in', 'Entrada', 'qty'), col('out', 'Salida', 'qty'), col('balance', 'Saldo', 'qty'), ...(costs ? [col('unitCost', 'Costo unit.', 'money')] : [])],
      rows,
      totals: { type: 'Total del período', in: sum(rows, 'in').toString(), out: sum(rows, 'out').toString(), balance: balance.toString() },
      notes: [`${item.sku} · ${item.name}.${p.warehouseId ? '' : ' Saldo de todos los depósitos.'}`],
    };
  }

  // ─── Producción ───

  private async openOrders(tx: Tx, today: string): Promise<Table> {
    const rows = await tx.$queryRaw<{ number: string; product: string; status: string; priority: number; due: Date | null; planned: string; good: string }[]>`
      SELECT o.number, p.name AS product, o.status::text AS status, o.priority, o.due_date AS due,
             COALESCE(SUM(l.planned_qty), 0)::text AS planned, COALESCE(SUM(l.good_qty), 0)::text AS good
      FROM production_orders o
      JOIN products p ON p.id = o.product_id
      LEFT JOIN production_order_lines l ON l.order_id = o.id
      WHERE o.status IN ('RELEASED', 'IN_PROGRESS', 'COMPLETED')
      GROUP BY o.id, o.number, p.name, o.status, o.priority, o.due_date
      ORDER BY o.due_date NULLS LAST, o.priority, o.number`;
    const t = new Date(`${today}T00:00:00.000Z`).getTime();
    const out = rows.map((r) => ({
      number: r.number,
      product: r.product,
      status: ORDER_STATUS[r.status] ?? r.status,
      priority: PRIORITY[r.priority] ?? String(r.priority),
      due: ymd(r.due),
      late: r.due && r.due.getTime() < t && r.status !== 'COMPLETED' ? Math.round((t - r.due.getTime()) / 86_400_000) : null,
      planned: qty(r.planned),
      good: qty(r.good),
      progress: pct(r.good, r.planned),
    }));
    return {
      columns: [col('number', 'OP'), col('product', 'Modelo'), col('status', 'Estado'), col('priority', 'Prioridad'), col('due', 'Entrega', 'date'), col('late', 'Días de atraso', 'int'), col('planned', 'Planificadas', 'qty'), col('good', 'Buenas ingresadas', 'qty'), col('progress', 'Avance', 'pct')],
      rows: out,
      totals: { number: 'Total', planned: sum(out, 'planned').toString(), good: sum(out, 'good').toString(), progress: pct(sum(out, 'good'), sum(out, 'planned')) },
      notes: ['OP liberadas, en proceso o terminadas sin cerrar. Avance = unidades buenas ingresadas sobre planificadas.'],
    };
  }

  private async atWorkshops(tx: Tx, costs: boolean): Promise<Table> {
    const rows = await tx.$queryRaw<{ workshop: string; sku: string; name: string; kind: string; qty: string; value: string }[]>`
      SELECT COALESCE(pa.legal_name, w.name) AS workshop, i.sku, i.name, i.kind::text AS kind, SUM(b.on_hand)::text AS qty, ROUND(SUM(b.on_hand * b.avg_cost), 2)::text AS value
      FROM stock_balances b
      JOIN warehouses w ON w.id = b.warehouse_id AND w.type = 'WORKSHOP'
      LEFT JOIN parties pa ON pa.id = w.party_id
      JOIN items i ON i.id = b.item_id
      GROUP BY 1, i.id, i.sku, i.name, i.kind
      HAVING SUM(b.on_hand) <> 0
      ORDER BY 1, i.kind DESC, i.sku`;
    const out = rows.map((r) => ({ workshop: r.workshop, sku: r.sku, name: r.name, kind: r.kind === 'VARIANT' ? 'Prenda en proceso' : 'Material', qty: qty(r.qty), ...(costs ? { value: money(r.value) } : {}) }));
    return {
      columns: [col('workshop', 'Taller'), col('sku', 'SKU'), col('name', 'Artículo'), col('kind', 'Tipo'), col('qty', 'Cantidad', 'qty'), ...(costs ? [col('value', 'Valor', 'money')] : [])],
      rows: out,
      totals: costs ? { workshop: 'Total', value: sum(out, 'value').toFixed(2) } : null,
      notes: ['Stock en los depósitos de cada taller: lo enviado y todavía no devuelto ni ingresado como producción.'],
    };
  }

  // ─── Cuentas corrientes ───

  private async aging(tx: Tx, type: 'RECEIVABLE' | 'PAYABLE', today: string): Promise<Table> {
    const rows = await tx.$queryRaw<{ party: string; tax_id: string; current: string; d30: string; d60: string; d90: string; d90p: string; credit: string; total: string }[]>`
      WITH e AS (
        SELECT e.party_id, e.open_amount, ${today}::date - COALESCE(e.due_date, e.date) AS days
        FROM account_entries e WHERE e.account_type = ${type}::"AccountType" AND e.open_amount <> 0
      )
      SELECT pa.legal_name AS party, pa.tax_id,
             SUM(CASE WHEN open_amount > 0 AND days <= 0 THEN open_amount ELSE 0 END)::text AS current,
             SUM(CASE WHEN open_amount > 0 AND days BETWEEN 1 AND 30 THEN open_amount ELSE 0 END)::text AS d30,
             SUM(CASE WHEN open_amount > 0 AND days BETWEEN 31 AND 60 THEN open_amount ELSE 0 END)::text AS d60,
             SUM(CASE WHEN open_amount > 0 AND days BETWEEN 61 AND 90 THEN open_amount ELSE 0 END)::text AS d90,
             SUM(CASE WHEN open_amount > 0 AND days > 90 THEN open_amount ELSE 0 END)::text AS d90p,
             SUM(CASE WHEN open_amount < 0 THEN open_amount ELSE 0 END)::text AS credit,
             SUM(open_amount)::text AS total
      FROM e JOIN parties pa ON pa.id = e.party_id
      GROUP BY pa.id, pa.legal_name, pa.tax_id
      ORDER BY SUM(open_amount) DESC`;
    const keys = ['current', 'd30', 'd60', 'd90', 'd90p', 'credit', 'total'] as const;
    const out = rows.map((r) => ({ party: r.party, taxId: r.tax_id, ...Object.fromEntries(keys.map((k) => [k, money(r[k])])) }));
    return {
      columns: [
        col('party', type === 'RECEIVABLE' ? 'Cliente' : 'Proveedor o taller'),
        col('taxId', 'CUIT'),
        col('current', 'A vencer', 'money'),
        col('d30', '1 a 30 días', 'money'),
        col('d60', '31 a 60 días', 'money'),
        col('d90', '61 a 90 días', 'money'),
        col('d90p', 'Más de 90 días', 'money'),
        col('credit', 'A cuenta / a favor', 'money'),
        col('total', 'Saldo', 'money'),
      ],
      rows: out,
      totals: { party: 'Total', ...Object.fromEntries(keys.map((k) => [k, sum(out, k).toFixed(2)])) },
      notes: ['Días de vencido a hoy, por fecha de vencimiento (o de emisión si no tiene). "A cuenta" son pagos o créditos sin imputar.'],
    };
  }

  // ─── Tesorería ───

  private async cheques(tx: Tx, status: string, today: string): Promise<Table> {
    const rows = await tx.$queryRaw<{ payment_date: Date; bank: string; number: string; drawer: string | null; from_party: string | null; to_party: string | null; account: string | null; status: string; amount: string; is_echeq: boolean }[]>`
      SELECT c.payment_date, c.bank, c.number, c.drawer_name AS drawer, rf.legal_name AS from_party, dt.legal_name AS to_party, a.name AS account, c.status::text AS status, c.amount::text AS amount, c.is_echeq
      FROM cheques c
      LEFT JOIN parties rf ON rf.id = c.received_from_id
      LEFT JOIN parties dt ON dt.id = c.delivered_to_id
      LEFT JOIN cash_accounts a ON a.id = c.cash_account_id
      WHERE c.ownership = 'THIRD' AND ${status === 'ALL' ? Prisma.sql`c.status <> 'VOIDED'` : Prisma.sql`c.status = ${status}::"ChequeStatus"`}
      ORDER BY c.payment_date, c.bank, c.number`;
    const t = new Date(`${today}T00:00:00.000Z`).getTime();
    const out = rows.map((r) => ({
      paymentDate: ymd(r.payment_date),
      days: Math.round((r.payment_date.getTime() - t) / 86_400_000),
      bank: r.bank,
      number: `${r.number}${r.is_echeq ? ' (e-cheq)' : ''}`,
      drawer: r.drawer,
      from: r.from_party,
      where: r.status === 'DELIVERED' ? r.to_party : r.account,
      status: CHEQUE_STATUS[r.status] ?? r.status,
      amount: money(r.amount),
    }));
    return {
      columns: [col('paymentDate', 'Fecha de pago', 'date'), col('days', 'Días', 'int'), col('bank', 'Banco'), col('number', 'Número'), col('drawer', 'Librador'), col('from', 'Recibido de'), col('where', 'Dónde está'), col('status', 'Estado'), col('amount', 'Importe', 'money')],
      rows: out,
      totals: { paymentDate: 'Total', amount: sum(out, 'amount').toFixed(2) },
      notes: ['"Días": hasta la fecha de pago (negativo si ya venció).'],
    };
  }

  private async cashAndBanks(tx: Tx, p: Params): Promise<Table> {
    const rows = await tx.$queryRaw<{ name: string; type: string; opening: string; inflow: string; outflow: string }[]>`
      SELECT a.name, a.type::text AS type,
             COALESCE(SUM(CASE WHEN m.operation_date < ${p.from}::date THEN CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END END), 0)::text AS opening,
             COALESCE(SUM(CASE WHEN m.operation_date BETWEEN ${p.from}::date AND ${p.to}::date AND m.direction = 'IN' THEN m.amount END), 0)::text AS inflow,
             COALESCE(SUM(CASE WHEN m.operation_date BETWEEN ${p.from}::date AND ${p.to}::date AND m.direction = 'OUT' THEN m.amount END), 0)::text AS outflow
      FROM cash_accounts a
      LEFT JOIN treasury_movements m ON m.cash_account_id = a.id AND m.operation_date <= ${p.to}::date
      WHERE a.type <> 'CHEQUE_PORTFOLIO'
      GROUP BY a.id, a.name, a.type
      HAVING a.is_active OR COUNT(m.id) > 0
      ORDER BY a.type, a.name`;
    const out = rows.map((r) => ({
      name: r.name,
      type: ACCOUNT_TYPES[r.type] ?? r.type,
      opening: money(r.opening),
      inflow: money(r.inflow),
      outflow: money(r.outflow),
      closing: D(r.opening).plus(D(r.inflow)).minus(D(r.outflow)).toFixed(2),
    }));
    return {
      columns: [col('name', 'Cuenta'), col('type', 'Tipo'), col('opening', 'Saldo inicial', 'money'), col('inflow', 'Ingresos', 'money'), col('outflow', 'Egresos', 'money'), col('closing', 'Saldo final', 'money')],
      rows: out,
      totals: { name: 'Total', ...Object.fromEntries(['opening', 'inflow', 'outflow', 'closing'].map((k) => [k, sum(out, k).toFixed(2)])) },
      notes: ['Por fecha de operación (la del arqueo y el extracto). Los cheques en cartera se informan en "Cartera de cheques".'],
    };
  }

  private async flow(ctx: RequestContext): Promise<Table> {
    const f = await this.cashflow.project(ctx, { weeks: 13, includeOverdue: true });
    const rows = f.weeks.map((w, i) => ({
      week: i + 1,
      from: ymd(w.from),
      to: ymd(w.to),
      inflow: money(w.inflow),
      outflow: money(w.outflow),
      net: D(w.inflow).minus(D(w.outflow)).toFixed(2),
      balance: money(w.balance),
    }));
    return {
      columns: [col('week', 'Semana', 'int'), col('from', 'Desde', 'date'), col('to', 'Hasta', 'date'), col('inflow', 'Ingresos', 'money'), col('outflow', 'Egresos', 'money'), col('net', 'Neto', 'money'), col('balance', 'Saldo al cierre', 'money')],
      rows,
      totals: { week: null, from: 'Total', inflow: sum(rows, 'inflow').toFixed(2), outflow: sum(rows, 'outflow').toFixed(2), net: sum(rows, 'net').toFixed(2), balance: rows.at(-1)?.balance ?? null },
      notes: [
        `Saldo inicial disponible: $ ${money(f.opening)}. Lo vencido sin cobrar ni pagar entra en la primera semana. Definición en Finanzas → Flujo de fondos.`,
        ...(f.firstNegativeWeek ? [`El saldo queda negativo desde la semana del ${dmy(ymd(f.firstNegativeWeek)!)}.`] : []),
      ],
    };
  }

  private async expenses(tx: Tx, p: Params): Promise<Table> {
    const byCenter = p.groupBy === 'costCenter';
    const rows = await tx.$queryRaw<{ label: string; count: bigint; amount: string }[]>`
      SELECT ${byCenter ? Prisma.sql`cc.code || ' · ' || cc.name` : Prisma.sql`c.name`} AS label, COUNT(*) AS count, SUM(e.amount)::text AS amount
      FROM expenses e JOIN categories c ON c.id = e.category_id JOIN cost_centers cc ON cc.id = e.cost_center_id
      WHERE e.status = 'POSTED' AND e.date BETWEEN ${p.from}::date AND ${p.to}::date
      GROUP BY 1 ORDER BY SUM(e.amount) DESC`;
    const total = rows.reduce((a, r) => a.plus(D(r.amount)), D(0));
    const out = rows.map((r) => ({ label: r.label, count: Number(r.count), amount: money(r.amount), share: pct(r.amount, total) }));
    return {
      columns: [col('label', byCenter ? 'Centro de costo' : 'Categoría'), col('count', 'Gastos', 'int'), col('amount', 'Importe', 'money'), col('share', '% del total', 'pct')],
      rows: out,
      totals: { label: 'Total', count: out.reduce((a, r) => a + r.count, 0), amount: total.toFixed(2), share: out.length ? 100 : null },
      notes: ['Gastos pagados registrados en Finanzas → Gastos (sin anulados). Las facturas de proveedores a plazo están en Cuentas a pagar.'],
    };
  }
}
