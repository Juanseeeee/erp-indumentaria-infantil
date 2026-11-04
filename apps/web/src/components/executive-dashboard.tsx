'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { EXECUTIVE_METRICS, type ExecutiveMetricKey } from '@erp/contracts';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, isNegative } from '@/lib/format';
import { Card, ErrorBox, Spinner } from '@/components/ui';
import { FlowChart, Legend, type ChartWeek } from '@/components/cashflow-charts';
import { MetricInfo } from '@/components/metric-info';

interface Kpi {
  value: string;
  previous?: string;
  change?: number | null;
  count?: number;
  href: string;
}

interface Executive {
  kpis: Record<ExecutiveMetricKey, Kpi>;
  attention: {
    rejectedCheques: { id: string; bank: string; number: string; amount: string; date: string; customer: string | null }[];
    lateOrders: { id: string; number: string; dueDate: string }[];
    customersOverLimit: { id: string; name: string; limit: string; balance: string }[];
    materialShortages: number;
  };
  topProducts: { id: string; name: string; units: string; net: string }[];
  idleProducts: { id: string; name: string; units: string }[];
  production: { stage: string; orders: number; planned: string; completed: string }[];
  cashflow: { opening: string; weeks: ChartWeek[]; firstNegativeWeek: string | null };
}

const ORDER: ExecutiveMetricKey[] = ['sales', 'collected', 'available', 'chequesDue', 'overdueReceivables', 'payablesDue'];

/** Tablero de Dirección: el negocio en diez segundos. Cada número lleva a su listado y explica su cálculo. */
export function ExecutiveDashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['executive'], queryFn: () => api.get<Executive>('/reports/executive') });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const a = data.attention;
  const attentionCount = a.rejectedCheques.length + a.lateOrders.length + a.customersOverLimit.length + (a.materialShortages ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ORDER.map((key) => <KpiTile key={key} metric={key} kpi={data.kpis[key]} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card className="min-w-0 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-medium">Flujo proyectado a 8 semanas</h2>
            <Link href="/flujo-de-fondos" className="text-sm text-accent underline">Ver detalle</Link>
          </div>
          <Legend />
          <FlowChart weeks={data.cashflow.weeks} />
          <p className="mt-2 text-sm text-muted">
            Saldo al cierre de la semana 8: <span className={`num font-medium ${isNegative(data.cashflow.weeks.at(-1)!.balance) ? 'text-danger' : 'text-text'}`}>{fmtMoney(data.cashflow.weeks.at(-1)!.balance)}</span>
            {data.cashflow.firstNegativeWeek && <span className="text-danger"> · saldo negativo desde la semana del {fmtDate(data.cashflow.firstNegativeWeek)}</span>}
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-medium">
            <AlertTriangle className={`size-4 ${attentionCount ? 'text-warning' : 'text-muted'}`} aria-hidden /> Atención
          </h2>
          {attentionCount ? (
            <ul className="flex flex-col gap-2 text-sm">
              {a.rejectedCheques.map((c) => (
                <li key={c.id}><Link href="/tesoreria" className="hover:underline"><strong>Cheque rechazado</strong> {c.bank} n.º {c.number} · {fmtMoney(c.amount)}{c.customer ? ` · ${c.customer}` : ''}</Link></li>
              ))}
              {a.lateOrders.map((o) => (
                <li key={o.id}><Link href={`/produccion/ordenes/${o.id}`} className="hover:underline"><strong>OP atrasada</strong> {o.number} · vencía el {fmtDate(o.dueDate)}</Link></li>
              ))}
              {a.materialShortages > 0 && (
                <li><Link href="/produccion" className="hover:underline"><strong>Materiales faltantes</strong> en {a.materialShortages} requerimiento{a.materialShortages > 1 ? 's' : ''} de OP en curso</Link></li>
              )}
              {a.customersOverLimit.map((c) => (
                <li key={c.id}><Link href={`/cuentas-a-cobrar/${c.id}`} className="hover:underline"><strong>Sobre su límite</strong> {c.name} · debe {fmtMoney(c.balance)} con límite {fmtMoney(c.limit)}</Link></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nada urgente: sin cheques rechazados, OP atrasadas, faltantes ni clientes excedidos.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Top 10 modelos <span className="text-sm font-normal text-muted">(facturado, últimos 30 días)</span></h2>
          <RankList rows={data.topProducts.map((p) => ({ key: p.id, label: p.name, value: fmtMoney(p.net), hint: `${fmtQty(p.units)} u.` }))} empty="Sin ventas en los últimos 30 días." />
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Sin ventas en 90 días <span className="text-sm font-normal text-muted">(con stock)</span></h2>
          <RankList rows={data.idleProducts.map((p) => ({ key: p.id, label: p.name, value: `${fmtQty(p.units)} u.` }))} empty="Todos los modelos con stock se vendieron en los últimos 90 días." />
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Producción en curso</h2>
          {data.production.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {data.production.map((s) => {
                const pct = Number(s.planned) > 0 ? Math.min(100, Math.round((Number(s.completed) / Number(s.planned)) * 100)) : 0;
                return (
                  <li key={s.stage}>
                    <div className="flex justify-between gap-2">
                      <span>{s.stage}</span>
                      <span className="num text-muted">{fmtQty(s.completed)} de {fmtQty(s.planned)} u.</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-surface-2" role="progressbar" aria-label={`${s.stage}: ${pct} % terminado`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: 'var(--viz-in)' }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">No hay órdenes de producción en curso.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function KpiTile({ metric, kpi }: { metric: ExecutiveMetricKey; kpi: Kpi }) {
  const def = EXECUTIVE_METRICS[metric];
  const trend = kpi.change == null ? null : kpi.change > 0 ? 'up' : kpi.change < 0 ? 'down' : 'flat';
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{def.label}</p>
        <MetricInfo def={def} />
      </div>
      <Link href={kpi.href} className="group mt-1 flex items-center gap-1">
        <span className="num text-2xl font-semibold">{fmtMoney(kpi.value)}</span>
        <ArrowRight className="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </Link>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted">
        {kpi.count != null ? (
          <>{kpi.count} {metric === 'chequesDue' ? (kpi.count === 1 ? 'cheque' : 'cheques') : kpi.count === 1 ? 'comprobante' : 'comprobantes'}</>
        ) : trend == null ? (
          <>Mes anterior: {fmtMoney(kpi.previous ?? '0')}</>
        ) : (
          <>
            {trend === 'up' ? <ArrowUpRight className="size-3.5" aria-hidden /> : trend === 'down' ? <ArrowDownRight className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
            <span>
              {trend === 'up' ? 'Sube' : trend === 'down' ? 'Baja' : 'Igual'} {Math.abs(kpi.change!).toLocaleString('es-AR')} % contra el mismo tramo del mes anterior ({fmtMoney(kpi.previous ?? '0')})
            </span>
          </>
        )}
      </p>
    </Card>
  );
}

function RankList({ rows, empty }: { rows: { key: string; label: string; value: string; hint?: string }[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ol className="flex flex-col text-sm">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-baseline justify-between gap-2 border-b border-border py-1.5 last:border-0">
          <span><span className="num mr-2 text-muted">{i + 1}.</span>{r.label}</span>
          <span className="num whitespace-nowrap text-right">{r.value}{r.hint && <span className="block text-xs text-muted">{r.hint}</span>}</span>
        </li>
      ))}
    </ol>
  );
}
