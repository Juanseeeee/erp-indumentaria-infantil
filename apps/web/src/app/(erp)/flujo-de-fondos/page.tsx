'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { CASHFLOW_KIND_LABELS, type CashflowKind } from '@erp/contracts';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, isNegative } from '@/lib/format';
import { Card, ErrorBox, Field, PageHeader, Select, Spinner, Stat } from '@/components/ui';
import { BalanceChart, FlowChart, Legend, short } from '@/components/cashflow-charts';

interface Week {
  from: string;
  to: string;
  inflow: string;
  outflow: string;
  balance: string;
  byKind: Partial<Record<CashflowKind, string>>;
}

interface Item {
  date: string;
  weekIndex: number;
  amount: string;
  kind: CashflowKind;
  description: string;
  party: string | null;
  overdue: boolean;
}

interface Cashflow {
  opening: string;
  weeks: Week[];
  overdue: { receivable: string; payable: string };
  firstNegativeWeek: string | null;
  items: Item[];
  truncated: boolean;
}

export default function CashflowPage() {
  const [weeks, setWeeks] = useState(13);
  const [includeOverdue, setIncludeOverdue] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['cashflow', weeks, includeOverdue],
    queryFn: () => api.get<Cashflow>(`/treasury/cashflow${qs({ weeks, includeOverdue: String(includeOverdue) })}`),
  });

  const lowest = data?.weeks.reduce((a, w) => (Number(w.balance) < Number(a.balance) ? w : a), data.weeks[0]!);
  const weekItems = selected == null ? [] : (data?.items ?? []).filter((i) => i.weekIndex === selected);

  return (
    <div>
      <PageHeader title="Flujo de fondos" description="Proyección semanal: disponible de hoy en cajas, bancos y billeteras, más cheques, tarjetas a acreditar y facturas a cobrar y a pagar por vencimiento." />
      <Card className="mb-4 p-4" tour="ff-opciones">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Horizonte" htmlFor="cf-weeks" tour="ff-horizonte">
            <Select id="cf-weeks" value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setSelected(null); }}>
              <option value={4}>4 semanas</option>
              <option value={8}>8 semanas</option>
              <option value={13}>13 semanas (90 días)</option>
              <option value={26}>26 semanas</option>
            </Select>
          </Field>
          <label data-tour="ff-incluir-vencido" className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={includeOverdue} onChange={(e) => setIncludeOverdue(e.target.checked)} />
            Incluir lo vencido en la primera semana
          </label>
        </div>
      </Card>

      {error && <ErrorBox error={error} />}
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <>
          {data.firstNegativeWeek && (
            <div data-tour="ff-alerta-negativo" role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-text">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span><strong>Saldo negativo</strong> desde la semana del {fmtDate(data.firstNegativeWeek)}. Revisá pagos a reprogramar o cobranzas a adelantar.</span>
            </div>
          )}
          <div data-tour="ff-indicadores" className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Disponible hoy" value={fmtMoney(data.opening)} hint="Cajas, bancos y billeteras a fecha de valor" />
            <Stat label="Saldo al final" value={fmtMoney(data.weeks.at(-1)!.balance)} tone={isNegative(data.weeks.at(-1)!.balance) ? 'danger' : undefined} hint={`Semana del ${fmtDate(data.weeks.at(-1)!.from)}`} />
            <Stat label="Saldo más bajo" value={fmtMoney(lowest!.balance)} tone={isNegative(lowest!.balance) ? 'danger' : undefined} hint={`Semana del ${fmtDate(lowest!.from)}`} />
            <Stat label="Vencido sin cobrar" value={fmtMoney(data.overdue.receivable)} hint={`Vencido sin pagar ${fmtMoney(data.overdue.payable.replace('-', ''))}`} />
          </div>

          <div className="mb-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="min-w-0 p-4" tour="ff-grafico-flujo">
              <h2 className="font-medium">Ingresos y egresos esperados por semana</h2>
              <Legend />
              <FlowChart weeks={data.weeks} selected={selected} onSelect={setSelected} />
            </Card>
            <Card className="min-w-0 p-4" tour="ff-grafico-saldo">
              <h2 className="font-medium">Saldo proyectado al cierre de cada semana</h2>
              <p className="mb-2 text-xs text-muted">La línea punteada marca el cero.</p>
              <BalanceChart weeks={data.weeks} selected={selected} onSelect={setSelected} />
            </Card>
          </div>

          <Card className="mb-4 overflow-hidden" tour="ff-tabla">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Flujo de fondos por semana</caption>
                <thead className="border-b border-border bg-surface-2 text-left text-muted">
                  <tr>
                    <th className="px-3 py-2">Semana</th>
                    <th className="px-3 py-2 text-right">Ingresos</th>
                    <th className="px-3 py-2 text-right">Egresos</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w, i) => (
                    <tr key={w.from} className={`border-b border-border last:border-0 ${selected === i ? 'bg-accent-soft' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-2">{short(w.from)} al {short(w.to)}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right">{fmtMoney(w.inflow)}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right">{fmtMoney(w.outflow.replace('-', ''))}</td>
                      <td className={`num whitespace-nowrap px-3 py-2 text-right font-medium ${isNegative(w.balance) ? 'text-danger' : ''}`}>{fmtMoney(w.balance)}</td>
                      <td className="px-3 py-2 text-right">
                        <button data-tour="ff-ver-detalle" type="button" className="text-accent underline" onClick={() => setSelected(selected === i ? null : i)} aria-expanded={selected === i}>
                          {selected === i ? 'Ocultar' : 'Ver detalle'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {selected != null && (
            <Card className="p-4" tour="ff-detalle">
              <h2 className="mb-3 font-medium">Detalle de la semana del {fmtDate(data.weeks[selected]!.from)}</h2>
              {weekItems.length ? (
                <ul className="divide-y divide-border text-sm">
                  {weekItems.map((it, k) => (
                    <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="text-muted">{fmtDate(it.date)} · {CASHFLOW_KIND_LABELS[it.kind]}</span>
                        <span className="block">{it.description}{it.party ? ` · ${it.party}` : ''}{it.overdue && <span className="ml-2 text-xs font-medium text-warning">Vencido</span>}</span>
                      </span>
                      <span className={`num font-medium ${isNegative(it.amount) ? 'text-danger' : 'text-success'}`}>{isNegative(it.amount) ? '−' : '+'}{fmtMoney(it.amount.replace('-', ''))}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Sin movimientos esperados esa semana.</p>
              )}
              {data.truncated && <p className="mt-2 text-xs text-muted">El detalle muestra los primeros 1.000 movimientos del horizonte.</p>}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
