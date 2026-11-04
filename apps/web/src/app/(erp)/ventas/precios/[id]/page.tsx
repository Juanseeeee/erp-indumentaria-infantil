'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface Row {
  productId: string;
  code: string;
  name: string;
  status: string;
  price: string | null;
  validFrom: string | null;
  scheduled: { price: string; validFrom: string } | null;
  variants: { itemId: string; sku: string; price: string }[];
}
interface Data {
  list: { id: string; name: string; includesVat: boolean; baseListId: string | null; markupPct: string | null };
  rows: Row[];
}
interface HistoryRow {
  id: string;
  price: string;
  validFrom: string;
  sku: string | null;
  user?: string;
  createdAt: string;
  batchId: string | null;
}

export default function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data, isLoading, error } = useQuery({ queryKey: ['price-list', id], queryFn: () => api.get<Data>(`/sales/price-lists/${id}/prices`) });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [bulk, setBulk] = useState({ pct: '', roundTo: '' });
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['price-history', id, historyOf],
    queryFn: () => api.get<HistoryRow[]>(`/sales/price-lists/${id}/history/${historyOf}`),
    enabled: !!historyOf,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['price-list', id] }); qc.invalidateQueries({ queryKey: ['price-history', id] }); };
  const save = useMutation({
    mutationFn: () =>
      api.post<{ count: number }>(`/sales/price-lists/${id}/prices`, {
        validFrom: validFrom || null,
        prices: Object.entries(edits).filter(([, v]) => v !== '').map(([productId, price]) => ({ productId, price })),
      }),
    onSuccess: (r) => { toast.success(`${r.count} precio(s) guardados${validFrom ? ` con vigencia ${fmtDate(validFrom)}` : ''}.`); setEdits({}); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdate = useMutation({
    mutationFn: () => api.post<{ count: number }>(`/sales/price-lists/${id}/bulk`, { pct: bulk.pct, roundTo: bulk.roundTo || null, validFrom: validFrom || null }),
    onSuccess: (r) => { toast.success(`${r.count} precio(s) actualizados.`); setBulk({ pct: '', roundTo: '' }); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const rows = useMemo(() => data?.rows.filter((r) => !filter || `${r.code} ${r.name}`.toLowerCase().includes(filter.toLowerCase())) ?? [], [data, filter]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const derived = !!data.list.baseListId;
  const editable = !derived && can('sales.prices.manage');
  const changed = Object.values(edits).filter((v) => v !== '').length;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Lista ${data.list.name}`}
        description={`${data.list.includesVat ? 'Precios con IVA incluido' : 'Precios sin IVA'}${derived ? ` · derivada (${Number(data.list.markupPct) >= 0 ? '+' : ''}${fmtQty(data.list.markupPct)} % sobre la base)` : ''}`}
      />
      {editable && (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
          <Field label="Vigencia desde" htmlFor="vf" hint="Vacío = hoy"><Input id="vf" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
          <Field label="Aumento %" htmlFor="pct" hint="Negativo para rebajar"><Input id="pct" className="w-28" inputMode="decimal" value={bulk.pct} onChange={(e) => setBulk({ ...bulk, pct: e.target.value.replace(',', '.') })} /></Field>
          <Field label="Redondear a" htmlFor="rt" hint="Ej.: 10 o 100"><Input id="rt" className="w-28" inputMode="decimal" value={bulk.roundTo} onChange={(e) => setBulk({ ...bulk, roundTo: e.target.value })} /></Field>
          <Button variant="secondary" disabled={!bulk.pct} loading={bulkUpdate.isPending} onClick={() => bulkUpdate.mutate()}>Actualizar toda la lista</Button>
          <Button className="ml-auto" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Guardar {changed || ''} cambio(s)</Button>
        </Card>
      )}
      {derived && <p className="mb-3 text-sm text-muted">Los precios de esta lista se calculan desde la lista base: para cambiarlos, editá la base o el porcentaje.</p>}
      <Input className="mb-3 max-w-sm" placeholder="Filtrar modelos…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar modelos" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                <th className="px-3 py-2 text-left">Modelo</th>
                <th className="px-3 py-2 text-right">Precio vigente</th>
                {editable && <th className="px-3 py-2 text-right">Nuevo precio</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.code}</span> {r.name}
                    {r.variants.length > 0 && <p className="text-xs text-muted">Excepciones: {r.variants.map((v) => `${v.sku} ${fmtMoney(v.price)}`).join(' · ')}</p>}
                    {r.scheduled && <p className="text-xs text-accent">Desde {fmtDate(r.scheduled.validFrom)}: {fmtMoney(r.scheduled.price)}</p>}
                  </td>
                  <td className="num px-3 py-2 text-right">{r.price ? fmtMoney(r.price) : <Badge tone="warning">Sin precio</Badge>}</td>
                  {editable && (
                    <td className="w-36 px-3 py-1">
                      <Input aria-label={`Nuevo precio ${r.code}`} className="num h-8 text-right" inputMode="decimal" value={edits[r.productId] ?? ''} onChange={(e) => setEdits({ ...edits, [r.productId]: e.target.value.replace(',', '.') })} />
                    </td>
                  )}
                  <td className="px-2 py-2">
                    <button aria-label={`Historial de ${r.code}`} title="Historial" className="text-muted hover:text-text" onClick={() => setHistoryOf(r.productId)}><History className="size-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {historyOf && (
          <Card className="p-4 text-sm lg:sticky lg:top-4 lg:self-start">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium">Historial · {data.rows.find((r) => r.productId === historyOf)?.code}</p>
              <button className="text-xs text-muted hover:underline" onClick={() => setHistoryOf(null)}>Cerrar</button>
            </div>
            {history.isLoading ? <Spinner /> : !history.data?.length ? <p className="text-muted">Sin cambios registrados.</p> : (
              <ul className="flex flex-col gap-2">
                {history.data.map((h) => (
                  <li key={h.id} className="border-b border-border pb-2 last:border-0">
                    <p><span className="num font-medium">{fmtMoney(h.price)}</span> {h.sku && <span className="text-muted">({h.sku})</span>} desde {fmtDate(h.validFrom)}</p>
                    <p className="text-xs text-muted">{h.user} · {fmtDateTime(h.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
