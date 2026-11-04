'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileDown, FileSpreadsheet } from 'lucide-react';
import { findReport, type ReportColumn, type ReportDefinition, type ReportFormat, type ReportResult } from '@erp/contracts';
import { api, download, qs } from '@/lib/api';
import { cn, fmtMoney, fmtQty, todayISO } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';

type Values = Record<string, string>;
const NUMERIC: ReportColumn['type'][] = ['money', 'qty', 'int', 'pct'];

function defaults(def: ReportDefinition): Values {
  const today = todayISO();
  const v: Values = {};
  for (const p of def.params) {
    if (p.type === 'date') v[p.key] = p.default === 'today' ? today : p.default === 'monthStart' ? `${today.slice(0, 8)}01` : `${today.slice(0, 5)}01-01`;
    else if (p.type === 'select') v[p.key] = p.default;
    else if (p.type === 'int') v[p.key] = String(p.default);
    else v[p.key] = '';
  }
  return v;
}

/** Celda con el formato de pantalla; vacío si no aplica. */
function cell(type: ReportColumn['type'], v: string | number | null | undefined) {
  if (v == null || v === '') return '';
  if (type === 'money') return fmtMoney(String(v));
  if (type === 'qty') return fmtQty(String(v));
  if (type === 'int') return Number(v).toLocaleString('es-AR');
  if (type === 'pct') return `${Number(v).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;
  if (type === 'date') return `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)}`;
  return String(v);
}

export default function ReportPage() {
  const { code } = useParams<{ code: string }>();
  const def = findReport(code);
  const can = useCan();
  const { data: md } = useMasterData();
  const [values, setValues] = useState<Values>(() => (def ? defaults(def) : {}));
  // Lo que se consulta: los valores al tocar "Ver reporte" (el SKU no dispara una consulta por tecla).
  const [applied, setApplied] = useState<Values | null>(() => (def && !def.params.some((p) => p.type === 'text' && p.required) ? defaults(def) : null));
  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const allowed = !!def && can(def.permissions);
  const { data, isFetching, error } = useQuery({
    queryKey: ['report', code, applied],
    queryFn: () => api.get<ReportResult>(`/reports/run/${code}${qs(applied ?? {})}`),
    enabled: allowed && !!applied,
  });

  if (!def) return <ErrorBox error={new Error('El reporte no existe.')} />;
  if (!allowed) return <ErrorBox error={new Error('No tenés permiso para ver este reporte.')} />;

  const set = (key: string) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const invalidRange = !!values.from && !!values.to && values.from > values.to;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!invalidRange) setApplied({ ...values });
  }
  async function exportAs(format: ReportFormat) {
    if (!applied) return;
    setExporting(format);
    try {
      const name = await download(`/reports/run/${code}/export${qs({ ...applied, format })}`);
      toast.success(`Descargado: ${name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  }
  const warehouses = (md?.warehouses ?? []).filter((w) => w.isActive);

  return (
    <div>
      <Link href="/reportes" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" aria-hidden /> Reportes
      </Link>
      <PageHeader
        title={def.title}
        description={def.description}
        actions={
          can('data.export') && data ? (
            <>
              <Button variant="secondary" onClick={() => exportAs('xlsx')} loading={exporting === 'xlsx'} disabled={!!exporting || isFetching}>
                <FileSpreadsheet className="size-4" aria-hidden /> Excel
              </Button>
              <Button variant="secondary" onClick={() => exportAs('pdf')} loading={exporting === 'pdf'} disabled={!!exporting || isFetching}>
                <FileDown className="size-4" aria-hidden /> PDF
              </Button>
            </>
          ) : undefined
        }
      />

      {def.params.length > 0 && (
        <Card className="mb-4 p-4">
          <form className="flex flex-wrap items-end gap-4" onSubmit={submit}>
            {def.params.map((p) => {
              const id = `rp-${p.key}`;
              return (
                <Field key={p.key} label={p.label} htmlFor={id}>
                  {p.type === 'date' ? (
                    <Input id={id} type="date" required value={values[p.key] ?? ''} onChange={set(p.key)} />
                  ) : p.type === 'select' ? (
                    <Select id={id} value={values[p.key] ?? ''} onChange={set(p.key)}>
                      {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  ) : p.type === 'warehouse' ? (
                    <Select id={id} value={values[p.key] ?? ''} onChange={set(p.key)}>
                      <option value="">Todos</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  ) : p.type === 'int' ? (
                    <Input id={id} type="number" min={p.min} max={p.max} required value={values[p.key] ?? ''} onChange={set(p.key)} className="w-28" />
                  ) : (
                    <Input id={id} required={p.required} placeholder={p.placeholder} value={values[p.key] ?? ''} onChange={set(p.key)} />
                  )}
                </Field>
              );
            })}
            <Button type="submit" disabled={invalidRange} loading={isFetching}>Ver reporte</Button>
          </form>
          {invalidRange && <p className="mt-2 text-sm text-danger" role="alert">La fecha desde no puede ser posterior a la fecha hasta.</p>}
        </Card>
      )}

      {!applied ? (
        <Card><EmptyState title="Completá los datos" description="Indicá los parámetros y tocá “Ver reporte”." /></Card>
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Spinner />
      ) : (
        <Card className={cn(isFetching && 'opacity-60')}>
          <p className="border-b border-border px-4 py-3 text-sm text-muted">{data.subtitle} · {data.rows.length} {data.rows.length === 1 ? 'fila' : 'filas'}</p>
          {data.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{data.title}</caption>
                <thead className="border-b border-border text-xs text-muted">
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.key} scope="col" className={cn('px-3 py-2 font-medium whitespace-nowrap', NUMERIC.includes(c.type) ? 'text-right' : 'text-left')}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {data.columns.map((c) => {
                        const v = row[c.key];
                        const negative = NUMERIC.includes(c.type) && Number(v) < 0;
                        return (
                          <td key={c.key} className={cn('px-3 py-1.5', NUMERIC.includes(c.type) && 'num text-right whitespace-nowrap', c.type === 'date' && 'num whitespace-nowrap', negative && 'text-danger')}>
                            {cell(c.type, v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {data.totals && (
                  <tfoot className="border-t border-border font-medium">
                    <tr>
                      {data.columns.map((c) => (
                        <td key={c.key} className={cn('px-3 py-2', NUMERIC.includes(c.type) && 'num text-right whitespace-nowrap')}>{cell(c.type, data.totals![c.key])}</td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <EmptyState title="Sin datos" description="No hay información para los parámetros elegidos." />
          )}
          {data.notes.length > 0 && (
            <ul className="border-t border-border px-4 py-3 text-xs text-muted">
              {data.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
