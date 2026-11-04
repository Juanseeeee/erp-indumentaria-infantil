'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDate, fmtFiscal, fmtMoney, fmtQty, isNegative, todayISO } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Stat } from '@/components/ui';

interface Commission {
  id: string;
  seller?: string;
  sellerUserId: string;
  collectedAt: string;
  baseAmount: string;
  pct: string;
  amount: string;
  settlement: string | null;
  document: { id: string; docType: string; pointOfSale: number; number: number | null; party?: string } | null;
}
interface Data {
  summary: { sellerUserId: string; name: string; pending: string }[];
  rows: Commission[];
}
interface Rep {
  userId: string;
  name: string;
  email: string;
  isRep: boolean;
  commissionPct: string | null;
  isActive: boolean;
}

function CommissionRows({ rows }: { rows: Commission[] }) {
  if (!rows.length) return <EmptyState title="Sin comisiones devengadas" description="La comisión se devenga cuando un cobro se imputa a una factura del vendedor." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
          <th className="px-3 py-2 text-left">Cobro</th>
          <th className="px-3 py-2 text-left">Vendedor</th>
          <th className="px-3 py-2 text-left">Factura</th>
          <th className="px-3 py-2 text-right">Base cobrada</th>
          <th className="px-3 py-2 text-right">%</th>
          <th className="px-3 py-2 text-right">Comisión</th>
          <th className="px-3 py-2 text-left">Liquidación</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border last:border-0">
            <td className="px-3 py-2">{fmtDate(r.collectedAt)}</td>
            <td className="px-3 py-2">{r.seller}</td>
            <td className="px-3 py-2">
              {r.document && <Link className="hover:underline" href={`/ventas/comprobantes/${r.document.id}`}>{fmtFiscal(r.document)}</Link>}
              <span className="text-xs text-muted"> {r.document?.party}</span>
            </td>
            <td className="num px-3 py-2 text-right">{fmtMoney(r.baseAmount)}</td>
            <td className="num px-3 py-2 text-right">{fmtQty(r.pct)}</td>
            <td className={`num px-3 py-2 text-right font-medium ${isNegative(r.amount) ? 'text-danger' : ''}`}>{fmtMoney(r.amount)}</td>
            <td className="px-3 py-2">{r.settlement ?? <Badge tone="warning">Pendiente</Badge>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CommissionsPage() {
  const can = useCan();
  const manage = can('sales.commissions.manage');
  const qc = useQueryClient();
  const [pending, setPending] = useState(true);
  const [periodTo, setPeriodTo] = useState(todayISO());
  const [pct, setPct] = useState<Record<string, string>>({});
  const all = useQuery({ queryKey: ['commissions', pending], queryFn: () => api.get<Data>(`/sales/commissions?pending=${pending}`), enabled: manage });
  const mine = useQuery({ queryKey: ['commissions', 'mine'], queryFn: () => api.get<Data>('/sales/commissions/mine'), enabled: !manage });
  const reps = useQuery({ queryKey: ['sales-reps'], queryFn: () => api.get<Rep[]>('/sales/reps'), enabled: manage });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['commissions'] }); qc.invalidateQueries({ queryKey: ['sales-reps'] }); };
  const saveRep = useMutation({
    mutationFn: (r: Rep & { pct: string; active: boolean }) => api.put('/sales/reps', { userId: r.userId, commissionPct: r.pct, isActive: r.active }),
    onSuccess: () => { toast.success('Vendedor actualizado. El nuevo % rige para las facturas que se emitan desde ahora.'); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const settle = useMutation({
    mutationFn: (sellerUserId: string) => api.post<{ number: string; total: string }>('/sales/commissions/settle', { sellerUserId, periodTo }),
    onSuccess: (s) => { toast.success(`Liquidación ${s.number} por ${fmtMoney(s.total)}.`); refresh(); },
    onError: (e) => toast.error(e.message),
  });

  if (!manage) {
    if (mine.isLoading) return <Spinner />;
    const total = mine.data?.summary[0]?.pending ?? '0';
    return (
      <div className="max-w-5xl">
        <PageHeader title="Mis comisiones" description="Se calculan sobre lo cobrado: cada cobro imputado a una factura tuya suma; si se revierte, resta." />
        <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Pendiente de liquidar" value={fmtMoney(total)} /></div>
        <Card className="overflow-x-auto"><CommissionRows rows={mine.data?.rows ?? []} /></Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <PageHeader title="Comisiones" description="Regla confirmada: la comisión se calcula sobre lo cobrado (base sin IVA, configurable). Se devenga al imputar cada cobro a la factura." />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-2 font-medium">Pendiente de liquidar</p>
          {!all.data?.summary.length ? <p className="text-sm text-muted">No hay comisiones pendientes.</p> : (
            <>
              <div className="mb-3 flex items-center gap-2 text-sm">
                <span className="text-muted">Cobros hasta</span>
                <Input type="date" aria-label="Liquidar hasta" className="w-44" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
              </div>
              <ul className="text-sm">
                {all.data.summary.map((s) => (
                  <li key={s.sellerUserId} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                    <span className="flex-1">{s.name}</span>
                    <span className="num font-medium">{fmtMoney(s.pending)}</span>
                    <Button variant="secondary" loading={settle.isPending && settle.variables === s.sellerUserId} onClick={() => settle.mutate(s.sellerUserId)}>Liquidar</Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">La liquidación cierra lo devengado hasta esa fecha. El pago se registra con los sueldos.</p>
            </>
          )}
        </Card>
        <Card className="p-4">
          <p className="mb-2 font-medium">Vendedores</p>
          {reps.isLoading ? <Spinner /> : (
            <table className="w-full text-sm">
              <tbody>
                {reps.data?.map((r) => (
                  <tr key={r.userId} className="border-b border-border last:border-0">
                    <td className="py-1.5">{r.name}{r.isRep && r.isActive && <Badge tone="accent">Vendedor</Badge>}</td>
                    <td className="w-24 py-1">
                      <Input aria-label={`% de ${r.name}`} className="num h-8 text-right" inputMode="decimal" placeholder="%" value={pct[r.userId] ?? r.commissionPct ?? ''} onChange={(e) => setPct({ ...pct, [r.userId]: e.target.value.replace(',', '.') })} />
                    </td>
                    <td className="py-1 pl-2 text-right">
                      <Button variant="ghost" disabled={!(pct[r.userId] ?? r.commissionPct)} onClick={() => saveRep.mutate({ ...r, pct: pct[r.userId] ?? r.commissionPct ?? '0', active: true })}>Guardar</Button>
                      {r.isRep && r.isActive && <Button variant="ghost" onClick={() => saveRep.mutate({ ...r, pct: r.commissionPct ?? '0', active: false })}>Quitar</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <Card className="overflow-x-auto">
        <div className="flex items-center gap-3 p-3">
          <p className="font-medium">Detalle</p>
          <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} /> Solo pendientes</label>
        </div>
        {all.isLoading ? <Spinner /> : <CommissionRows rows={all.data?.rows ?? []} />}
      </Card>
    </div>
  );
}
