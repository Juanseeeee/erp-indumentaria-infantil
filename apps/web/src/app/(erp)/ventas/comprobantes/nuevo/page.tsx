'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { dec, roundMoney } from '@erp/domain-core';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { Button, Card, EmptyState, Field, PageHeader, Select, Spinner } from '@/components/ui';

interface DeliveryRow {
  id: string;
  number: string;
  order: string | null;
  issueDate: string;
  units: string;
  netTotal: string;
  total: string;
}

function NewInvoice() {
  const router = useRouter();
  const sp = useSearchParams();
  const [customerId, setCustomerId] = useState(sp.get('cliente') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(sp.get('remito') ? [sp.get('remito')!] : []));
  const key = useRef(crypto.randomUUID());
  const customers = useQuery({ queryKey: ['parties', 'customers-select'], queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=CUSTOMER&pageSize=200') });
  const pending = useQuery({
    queryKey: ['deliveries', 'pending', customerId],
    queryFn: () => api.get<{ rows: DeliveryRow[] }>(`/sales/deliveries${qs({ customerId, pendingInvoice: true, pageSize: 200 })}`),
    enabled: !!customerId,
  });
  const chosen = pending.data?.rows.filter((r) => selected.has(r.id)) ?? [];
  // Suma de lo que se factura, solo para mostrar: el servidor recalcula con redondeo por línea.
  const preview = useMemo(
    () => ({
      net: roundMoney(chosen.reduce((a, r) => a.plus(r.netTotal), dec(0))).toFixed(2),
      total: roundMoney(chosen.reduce((a, r) => a.plus(r.total), dec(0))).toFixed(2),
    }),
    [chosen],
  );
  const emit = useMutation({
    mutationFn: () => api.post<{ id: string; status: string }>('/sales/invoices', { customerId, deliveryIds: [...selected] }, { idempotencyKey: key.current }),
    onSuccess: (d) => {
      if (d.status === 'POSTED') toast.success('Factura autorizada.');
      else if (d.status === 'REJECTED') toast.error('ARCA rechazó la factura: los remitos quedaron libres para volver a facturar.');
      else toast.warning('La factura quedó esperando el CAE: reintentá desde el comprobante.');
      router.push(`/ventas/comprobantes/${d.id}`);
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e instanceof ApiError ? e.message : 'No se pudo emitir.');
    },
  });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Facturar remitos" description="Elegí uno o varios remitos del cliente: se emite una factura con todos (A o B según su condición frente al IVA)." />
      <Card className="mb-4 p-4">
        <Field label="Cliente" htmlFor="customer">
          <Select id="customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setSelected(new Set()); }}>
            <option value="">Elegí un cliente…</option>
            {customers.data?.rows.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
          </Select>
        </Field>
      </Card>
      {customerId && (pending.isLoading ? <Spinner /> : !pending.data?.rows.length ? (
        <Card><EmptyState title="No hay remitos pendientes de facturar" description="Los remitos se emiten desde los pedidos confirmados." /></Card>
      ) : (
        <Card className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Elegir todos"
                    checked={selected.size === pending.data.rows.length}
                    onChange={(e) => setSelected(new Set(e.target.checked ? pending.data!.rows.map((r) => r.id) : []))}
                  />
                </th>
                <th className="px-3 py-2 text-left">Remito</th>
                <th className="px-3 py-2 text-left">Pedido</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-right">Prendas</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {pending.data.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/50" onClick={() => toggle(r.id)}>
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Elegir ${r.number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="px-3 py-2 font-medium">{r.number}</td>
                  <td className="px-3 py-2">{r.order ?? '—'}</td>
                  <td className="px-3 py-2">{fmtDate(r.issueDate)}</td>
                  <td className="num px-3 py-2 text-right">{fmtQty(r.units)}</td>
                  <td className="num px-3 py-2 text-right">{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-6 p-4">
          <div className="text-sm">
            <p>{selected.size} remito(s) · Neto <span className="num">{fmtMoney(preview.net)}</span></p>
            <p className="text-base font-semibold">Total <span className="num">{fmtMoney(preview.total)}</span></p>
          </div>
          <Button className="ml-auto" loading={emit.isPending} onClick={() => emit.mutate()}>Emitir factura</Button>
        </Card>
      )}
    </div>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewInvoice />
    </Suspense>
  );
}
