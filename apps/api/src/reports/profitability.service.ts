import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProfitabilityDimension, ProfitabilityQuery } from '@erp/contracts';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';

const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
/** Porcentaje con un decimal; null si la base es cero. */
const pct = (part: Prisma.Decimal, base: Prisma.Decimal) => (base.isZero() ? null : part.div(base.abs()).times(100).toDecimalPlaces(1).toNumber());

/** Clave, rótulo y subtítulo de cada dimensión (columnas fijas: nunca entra texto del usuario). */
const DIMENSIONS: Record<ProfitabilityDimension, { key: string; label: string; sub: string; empty: string; href: ((id: string) => string) | null }> = {
  product: { key: 'p.id::text', label: 'p.name', sub: 'p.code', empty: 'Otros conceptos (fletes, bonificaciones)', href: (id) => `/catalogo/${id}` },
  category: {
    key: "CASE WHEN p.id IS NULL THEN NULL ELSE COALESCE(cat.id::text, '-') END",
    label: "CASE WHEN p.id IS NULL THEN NULL ELSE COALESCE(cat.name, 'Sin categoría') END",
    sub: 'NULL::text',
    empty: 'Otros conceptos (fletes, bonificaciones)',
    href: null,
  },
  customer: { key: 'pa.id::text', label: 'pa.legal_name', sub: 'pa.tax_id', empty: 'Sin cliente', href: (id) => `/cuentas-a-cobrar/${id}` },
  order: { key: 'so.id::text', label: 'so.number', sub: 'pa.legal_name', empty: 'Sin pedido (conceptos sueltos o remitos sin pedido)', href: (id) => `/ventas/pedidos/${id}` },
  seller: { key: 'u.id::text', label: 'u.name', sub: 'NULL::text', empty: 'Sin vendedor asignado', href: null },
};

interface Row {
  key: string | null;
  label: string | null;
  sub: string | null;
  units: string;
  net: string;
  cost: string;
  uncosted: string;
}

/**
 * Rentabilidad por modelo, categoría, cliente, pedido o vendedor: siempre "margen bruto estimado" (RF-COS-03).
 * Ventas netas de IVA de comprobantes vigentes; costo = costo de salida del remito facturado. Las notas de crédito
 * con devolución restan unidades y costo al mismo costo de salida; las de bonificación solo restan venta.
 * Definiciones en PROFITABILITY_METRICS (contracts) y docs/METRICS.md.
 */
@Injectable()
export class ProfitabilityService {
  constructor(private readonly uow: UnitOfWork) {}

  async report(ctx: RequestContext, q: ProfitabilityQuery) {
    const dim = DIMENSIONS[q.groupBy];
    const rows = await this.uow.run(ctx, (tx) =>
      tx.$queryRaw<Row[]>`
        WITH base AS (
          SELECT d.party_id, d.seller_user_id, l.item_id, l.qty,
                 d.doc_type LIKE 'NC%' AS is_credit, d.return_warehouse_id IS NOT NULL AS is_return,
                 CASE WHEN d.doc_type LIKE 'NC%' THEN -l.net ELSE l.net END AS net,
                 src.unit_cost, src.delivery_id
          FROM fiscal_document_lines l
          JOIN fiscal_documents d ON d.id = l.document_id
          LEFT JOIN fiscal_document_lines il ON il.id = l.related_line_id
          LEFT JOIN delivery_note_lines src ON src.id = COALESCE(l.delivery_line_id, il.delivery_line_id)
          WHERE d.direction = 'SALE' AND d.status = 'POSTED' AND d.issue_date BETWEEN ${q.from}::date AND ${q.to}::date
        ), calc AS (
          SELECT b.*,
                 CASE WHEN b.item_id IS NULL THEN 0 WHEN b.is_credit THEN CASE WHEN b.is_return THEN -b.qty ELSE 0 END ELSE b.qty END AS units
          FROM base b
        )
        SELECT ${Prisma.raw(dim.key)} AS key, ${Prisma.raw(dim.label)} AS label, ${Prisma.raw(dim.sub)} AS sub,
               SUM(c.units)::text AS units,
               ROUND(SUM(c.net), 2)::text AS net,
               ROUND(SUM(c.units * COALESCE(c.unit_cost, 0)), 2)::text AS cost,
               SUM(CASE WHEN c.units <> 0 AND COALESCE(c.unit_cost, 0) = 0 THEN ABS(c.units) ELSE 0 END)::text AS uncosted
        FROM calc c
        LEFT JOIN product_variants v ON v.item_id = c.item_id
        LEFT JOIN products p ON p.id = v.product_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN parties pa ON pa.id = c.party_id
        LEFT JOIN delivery_notes dn ON dn.id = c.delivery_id
        LEFT JOIN sales_orders so ON so.id = dn.order_id
        LEFT JOIN users u ON u.id = c.seller_user_id
        GROUP BY 1, 2, 3`,
    );

    const totals = { units: D(0), net: D(0), cost: D(0), uncosted: D(0) };
    for (const r of rows) {
      totals.units = totals.units.plus(D(r.units));
      totals.net = totals.net.plus(D(r.net));
      totals.cost = totals.cost.plus(D(r.cost));
      totals.uncosted = totals.uncosted.plus(D(r.uncosted));
    }
    const totalMargin = totals.net.minus(totals.cost);
    const out = rows
      .map((r) => {
        const net = D(r.net);
        const cost = D(r.cost);
        const margin = net.minus(cost);
        return {
          key: r.key,
          label: r.key == null ? dim.empty : (r.label ?? '—'),
          sub: r.key == null ? null : r.sub,
          href: r.key != null && r.key !== '-' && dim.href ? dim.href(r.key) : null,
          units: D(r.units).toString(),
          net: net.toFixed(2),
          cost: cost.toFixed(2),
          margin: margin.toFixed(2),
          marginPct: pct(margin, net),
          /** Participación en el margen total del período. */
          share: pct(margin, totalMargin),
          uncostedUnits: D(r.uncosted).toString(),
        };
      })
      .sort((a, b) => D(b.margin).comparedTo(D(a.margin)) || a.label.localeCompare(b.label));

    return {
      from: q.from,
      to: q.to,
      groupBy: q.groupBy,
      totals: {
        units: totals.units.toString(),
        net: totals.net.toFixed(2),
        cost: totals.cost.toFixed(2),
        margin: totalMargin.toFixed(2),
        marginPct: pct(totalMargin, totals.net),
        uncostedUnits: totals.uncosted.toString(),
      },
      rows: out,
    };
  }
}
