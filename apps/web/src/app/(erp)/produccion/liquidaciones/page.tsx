'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, todayISO } from '@/lib/format';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';

interface Pending {
  id: string;
  number: string;
  createdAt: string;
  order?: string;
  product?: string;
  units: string;
  scrap: string;
  rate: string | null;
  amount: string;
}

/** Suma exacta de importes con 2 decimales (centavos enteros). */
const sumMoney = (vals: string[]) => {
  const c = vals.reduce((a, v) => {
    const [i, f = ''] = (v || '0').replace('-', '').split('.');
    const n = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
    return a + (v.startsWith('-') ? -n : n);
  }, 0n);
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};

export default function SettlementsPage() {
  const qc = useQueryClient();
  const [workshopId, setWorkshopId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [deductions, setDeductions] = useState<{ description: string; amount: string }[]>([]);
  const [inv, setInv] = useState({ hasInvoice: true, docType: 'FC', pointOfSale: '', number: '', vatRate: '0', issueDate: todayISO(), dueDate: '' });
  const key = useRef(crypto.randomUUID());
  const config = useQuery({ queryKey: ['production-config'], queryFn: () => api.get<{ workshops: { id: string; legalName: string }[] }>('/production/config') });
  const pending = useQuery({
    queryKey: ['settlement-pending', workshopId],
    queryFn: () => api.get<Pending[]>(`/production/settlements/pending?workshopId=${workshopId}`),
    enabled: !!workshopId,
  });
  const history = useQuery({
    queryKey: ['settlements', workshopId],
    queryFn: () => api.get<{ id: string; number: string; workshop?: string; grossTotal: string; deductions: string; total: string; createdAt: string }[]>(`/production/settlements${workshopId ? `?workshopId=${workshopId}` : ''}`),
  });
  const gross = useMemo(() => sumMoney((pending.data ?? []).filter((p) => selected.includes(p.id)).map((p) => p.amount)), [pending.data, selected]);
  const ded = sumMoney(deductions.map((d) => d.amount.replace(',', '.') || '0'));
  const net = sumMoney([gross, `-${ded}`]);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ number: string; total: string }>(
        '/production/settlements',
        {
          workshopId,
          outputIds: selected,
          deductions: deductions.filter((d) => d.description && d.amount).map((d) => ({ ...d, amount: d.amount.replace(',', '.') })),
          invoice: inv.hasInvoice ? { docType: inv.docType, pointOfSale: Number(inv.pointOfSale), number: Number(inv.number), vatRate: inv.vatRate } : null,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate || null,
        },
        { idempotencyKey: key.current },
      ),
    onSuccess: (r) => {
      key.current = crypto.randomUUID();
      toast.success(`Liquidación ${r.number} registrada por ${fmtMoney(r.total)}. Quedó en la cuenta corriente del taller.`);
      setSelected([]);
      setDeductions([]);
      qc.invalidateQueries({ queryKey: ['settlement-pending'] });
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e.message);
    },
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Liquidación de talleres" description="El taller cobra por prenda terminada según la tarifa de cada modelo. Se liquidan las prendas aprobadas y de segunda; el descarte no se paga." />
      <Field label="Taller" htmlFor="ws" className="mb-4 max-w-sm">
        <Select id="ws" value={workshopId} onChange={(e) => { setWorkshopId(e.target.value); setSelected([]); }}>
          <option value="">Elegí un taller…</option>
          {config.data?.workshops.map((w) => <option key={w.id} value={w.id}>{w.legalName}</option>)}
        </Select>
      </Field>
      {workshopId && (
        <Card className="mb-4 overflow-x-auto">
          <h2 className="border-b border-border px-4 py-3 font-medium">Recepciones sin liquidar</h2>
          <table className="w-full text-sm">
            <tbody>
              {pending.data?.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Liquidar ${p.number}`} checked={selected.includes(p.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} /></td>
                  <td className="px-3 py-2">{p.number} · {p.order} · {p.product}<span className="block text-xs text-muted">{fmtDateTime(p.createdAt)}</span></td>
                  <td className="num px-3 py-2 text-right">{fmtQty(p.units)} prendas × {fmtMoney(p.rate)}{p.scrap !== '0' && <span className="block text-xs text-muted">{fmtQty(p.scrap)} descartadas (no se pagan)</span>}</td>
                  <td className="num px-3 py-2 text-right font-medium">{fmtMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pending.data?.length && <p className="p-4 text-sm text-muted">No hay recepciones pendientes de liquidar para este taller.</p>}
        </Card>
      )}
      {selected.length > 0 && (
        <Card className="mb-6 flex flex-col gap-4 p-4">
          <div>
            <p className="mb-2 text-sm font-medium">Descuentos (faltantes, fallas imputables al taller)</p>
            {deductions.map((d, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <Input placeholder="Concepto" value={d.description} onChange={(e) => setDeductions((ds) => ds.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Input className="num w-36 text-right" placeholder="$" inputMode="decimal" value={d.amount} onChange={(e) => setDeductions((ds) => ds.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <button aria-label="Quitar" onClick={() => setDeductions((ds) => ds.filter((_, j) => j !== i))}><Trash2 className="size-4 text-muted" /></button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setDeductions((d) => [...d, { description: '', amount: '' }])}><Plus className="size-4" /> Agregar descuento</Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={inv.hasInvoice} onChange={(e) => setInv((v) => ({ ...v, hasInvoice: e.target.checked }))} /> El taller emitió factura</label>
            {inv.hasInvoice && (
              <>
                <Field label="Tipo" htmlFor="dt"><Select id="dt" value={inv.docType} onChange={(e) => setInv((v) => ({ ...v, docType: e.target.value }))}><option>FC</option><option>FB</option><option>FA</option></Select></Field>
                <Field label="Punto de venta" htmlFor="pv"><Input id="pv" inputMode="numeric" value={inv.pointOfSale} onChange={(e) => setInv((v) => ({ ...v, pointOfSale: e.target.value.replace(/\D/g, '') }))} /></Field>
                <Field label="Número" htmlFor="nro"><Input id="nro" inputMode="numeric" value={inv.number} onChange={(e) => setInv((v) => ({ ...v, number: e.target.value.replace(/\D/g, '') }))} /></Field>
                <Field label="IVA %" htmlFor="iva"><Select id="iva" value={inv.vatRate} onChange={(e) => setInv((v) => ({ ...v, vatRate: e.target.value }))}><option value="0">0 (monotributo)</option><option value="21">21</option><option value="10.5">10,5</option></Select></Field>
              </>
            )}
            <Field label="Fecha" htmlFor="fd"><Input id="fd" type="date" value={inv.issueDate} onChange={(e) => setInv((v) => ({ ...v, issueDate: e.target.value }))} /></Field>
            <Field label="Vencimiento" htmlFor="vd" hint="Vacío: según condición de pago"><Input id="vd" type="date" value={inv.dueDate} onChange={(e) => setInv((v) => ({ ...v, dueDate: e.target.value }))} /></Field>
          </div>
          <div className="num rounded-md bg-surface-2 p-3 text-sm">
            Bruto {fmtMoney(gross)} − descuentos {fmtMoney(ded)} = <strong>{fmtMoney(net)}</strong>{inv.hasInvoice && inv.vatRate !== '0' ? ' + IVA' : ''}
          </div>
          <div>
            <Button loading={create.isPending} disabled={inv.hasInvoice && (!inv.pointOfSale || !inv.number)} onClick={() => create.mutate()}>Registrar liquidación</Button>
          </div>
        </Card>
      )}
      <h2 className="mb-2 font-medium">Liquidaciones registradas</h2>
      <Card>
        <ul>
          {history.data?.map((s) => (
            <li key={s.id} className="flex justify-between border-b border-border px-4 py-2 text-sm last:border-0">
              <span>{s.number} · {s.workshop} <span className="text-muted">· {fmtDate(s.createdAt)}</span></span>
              <span className="num">{fmtMoney(s.total)}{s.deductions !== '0' && <span className="text-xs text-muted"> (desc. {fmtMoney(s.deductions)})</span>}</span>
            </li>
          ))}
        </ul>
        {!history.data?.length && <p className="p-4 text-sm text-muted">Todavía no hay liquidaciones.</p>}
      </Card>
    </div>
  );
}
