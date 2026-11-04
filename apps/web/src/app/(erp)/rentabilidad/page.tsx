'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, ChartColumn } from 'lucide-react';
import { PROFITABILITY_DIMENSIONS, PROFITABILITY_DIMENSION_LABELS, PROFITABILITY_METRICS, type ProfitabilityDimension } from '@erp/contracts';
import { api, qs } from '@/lib/api';
import { cn, fmtMoney, fmtQty, isNegative, todayISO } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Card, EmptyState, ErrorBox, Field, Input, PageHeader, Spinner, Tabs } from '@/components/ui';
import { MetricInfo } from '@/components/metric-info';

interface Row {
  key: string | null;
  label: string;
  sub: string | null;
  href: string | null;
  units: string;
  net: string;
  cost: string;
  margin: string;
  marginPct: number | null;
  share: number | null;
  uncostedUnits: string;
}

interface Report {
  from: string;
  to: string;
  totals: { units: string; net: string; cost: string; margin: string; marginPct: number | null; uncostedUnits: string };
  rows: Row[];
}

type SortKey = 'label' | 'units' | 'net' | 'cost' | 'margin' | 'marginPct';
const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'units', label: 'Unidades', numeric: true },
  { key: 'net', label: 'Vendido neto', numeric: true },
  { key: 'cost', label: 'Costo', numeric: true },
  { key: 'margin', label: 'Margen bruto est.', numeric: true },
  { key: 'marginPct', label: 'Margen %', numeric: true },
];

const pct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`);
const monthStart = () => `${todayISO().slice(0, 8)}01`;

export default function ProfitabilityPage() {
  const can = useCan();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [groupBy, setGroupBy] = useState<ProfitabilityDimension>('product');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'margin', desc: true });
  const allowed = can(['sales.view', 'costs.view']);
  const validRange = !!from && !!to && from <= to;
  const { data, isLoading, error } = useQuery({
    queryKey: ['profitability', from, to, groupBy],
    queryFn: () => api.get<Report>(`/reports/profitability${qs({ from, to, groupBy })}`),
    enabled: allowed && validRange,
  });

  if (!allowed) return <ErrorBox error={new Error('No tenés permiso para ver la rentabilidad (requiere ver ventas y costos).')} />;

  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    const dir = sort.desc ? -1 : 1;
    if (sort.key === 'label') return a.label.localeCompare(b.label, 'es') * dir;
    const va = sort.key === 'marginPct' ? (a.marginPct ?? -Infinity) : Number(a[sort.key]);
    const vb = sort.key === 'marginPct' ? (b.marginPct ?? -Infinity) : Number(b[sort.key]);
    return (va - vb) * dir;
  });
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'label' }));
  const t = data?.totals;
  const dimLabel = PROFITABILITY_DIMENSION_LABELS[groupBy];

  return (
    <div>
      <PageHeader
        title="Rentabilidad"
        description="Margen bruto estimado: lo vendido neto de IVA menos el costo de salida de la mercadería. No descuenta gastos, comisiones ni impuestos: no es el resultado contable."
      />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Desde" htmlFor="pr-from"><Input id="pr-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta" htmlFor="pr-to"><Input id="pr-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {!validRange && <p className="mt-2 text-sm text-danger" role="alert">La fecha desde no puede ser posterior a la fecha hasta.</p>}
      </Card>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : t ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile def={PROFITABILITY_METRICS.net} value={fmtMoney(t.net)} hint={`${fmtQty(t.units)} unidades`} />
            <Tile def={PROFITABILITY_METRICS.cost} value={fmtMoney(t.cost)} />
            <Tile def={PROFITABILITY_METRICS.margin} value={fmtMoney(t.margin)} hint={`${pct(t.marginPct)} sobre lo vendido`} negative={isNegative(t.margin)} />
          </div>
          {Number(t.uncostedUnits) > 0 && (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {fmtQty(t.uncostedUnits)} unidades vendidas no tienen costo cargado: su margen figura al 100 % y el total está <strong>sobreestimado</strong>. Revisá el costo de esos modelos en su stock inicial o su ficha técnica.
              </span>
            </div>
          )}
        </>
      ) : null}

      <Card>
        <div className="px-4 pt-3">
          <Tabs tabs={PROFITABILITY_DIMENSIONS.map((d) => ({ id: d, label: `Por ${PROFITABILITY_DIMENSION_LABELS[d].toLowerCase()}` }))} value={groupBy} onChange={(id) => setGroupBy(id as ProfitabilityDimension)} />
        </div>
        {data && !rows.length ? (
          <EmptyState icon={<ChartColumn className="size-8" aria-hidden />} title="Sin ventas en el período" description="No hay comprobantes de venta vigentes entre esas fechas." />
        ) : data ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Margen bruto estimado por {dimLabel.toLowerCase()}</caption>
              <thead className="border-b border-border text-xs text-muted">
                <tr>
                  <SortHeader label={dimLabel} active={sort.key === 'label'} desc={sort.desc} onClick={() => toggle('label')} />
                  {COLUMNS.map((c) => <SortHeader key={c.key} label={c.label} numeric active={sort.key === c.key} desc={sort.desc} onClick={() => toggle(c.key)} />)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key ?? 'none'} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      {r.href ? <Link href={r.href} className="font-medium hover:underline">{r.label}</Link> : <span className={r.key ? 'font-medium' : 'text-muted'}>{r.label}</span>}
                      {r.sub && <span className="block text-xs text-muted">{r.sub}</span>}
                      {Number(r.uncostedUnits) > 0 && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3" aria-hidden /> {fmtQty(r.uncostedUnits)} u. sin costo</span>
                      )}
                    </td>
                    <td className="num px-4 py-2 text-right">{fmtQty(r.units)}</td>
                    <td className="num px-4 py-2 text-right">{fmtMoney(r.net)}</td>
                    <td className="num px-4 py-2 text-right">{fmtMoney(r.cost)}</td>
                    <td className={cn('num px-4 py-2 text-right font-medium', isNegative(r.margin) && 'text-danger')}>{fmtMoney(r.margin)}</td>
                    <td className={cn('num px-4 py-2 text-right', r.marginPct != null && r.marginPct < 0 && 'text-danger')}>{pct(r.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot className="border-t border-border font-medium">
                  <tr>
                    <td className="px-4 py-2">Total</td>
                    <td className="num px-4 py-2 text-right">{fmtQty(t.units)}</td>
                    <td className="num px-4 py-2 text-right">{fmtMoney(t.net)}</td>
                    <td className="num px-4 py-2 text-right">{fmtMoney(t.cost)}</td>
                    <td className={cn('num px-4 py-2 text-right', isNegative(t.margin) && 'text-danger')}>{fmtMoney(t.margin)}</td>
                    <td className="num px-4 py-2 text-right">{pct(t.marginPct)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Tile({ def, value, hint, negative }: { def: (typeof PROFITABILITY_METRICS)[keyof typeof PROFITABILITY_METRICS]; value: string; hint?: string; negative?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{def.label}</p>
        <MetricInfo def={def} />
      </div>
      <p className={cn('num mt-1 text-2xl font-semibold', negative && 'text-danger')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function SortHeader({ label, numeric, active, desc, onClick }: { label: string; numeric?: boolean; active: boolean; desc: boolean; onClick: () => void }) {
  return (
    <th scope="col" className={cn('px-4 py-2 font-medium', numeric ? 'text-right' : 'text-left')} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 hover:text-text', active && 'text-text')}>
        {label}
        {active && (desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
      </button>
    </th>
  );
}
