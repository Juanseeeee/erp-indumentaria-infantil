'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Inbox } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Badge, Button, Card, EmptyState, PageHeader, Select } from '@/components/ui';

interface Req {
  id: string;
  number: string;
  status: string;
  origin: string;
  productionOrderId: string | null;
  neededBy: string | null;
  notes: string | null;
  createdAt: string;
  lines: { id: string; itemId: string; qty: string; supplierId: string | null; poLineId: string | null }[];
  items: { id: string; sku: string; name: string }[];
  parties: { id: string; legalName: string }[];
}

const ORIGIN: Record<string, string> = { MANUAL: 'Manual', PRODUCTION: 'Faltante de producción', MIN_STOCK: 'Stock mínimo' };

export default function PurchaseRequestsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const [status, setStatus] = useState('OPEN');
  const [selected, setSelected] = useState<string[]>([]);
  const { data } = useQuery({ queryKey: ['purchase-requests', status], queryFn: () => api.get<Req[]>(`/purchasing/requests${status ? `?status=${status}` : ''}`) });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/purchasing/requests/${id}/cancel`),
    onSuccess: () => { toast.success('Solicitud cancelada.'); qc.invalidateQueries({ queryKey: ['purchase-requests'] }); },
    onError: (e) => toast.error(e.message),
  });
  const allLines = (data ?? []).flatMap((r) => r.lines.map((l) => ({ ...l, req: r })));
  const selectedSuppliers = new Set(allLines.filter((l) => selected.includes(l.id)).map((l) => l.supplierId ?? ''));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Solicitudes de compra"
        description="Necesidades de materiales detectadas por producción o cargadas a mano. Elegí líneas del mismo proveedor y generá la orden de compra."
        actions={
          can('purchasing.order') && (
            <Button
              data-tour="sc-generar-oc"
              disabled={!selected.length || selectedSuppliers.size > 1}
              title={selectedSuppliers.size > 1 ? 'Elegí líneas de un solo proveedor' : undefined}
              onClick={() => router.push(`/compras/ordenes/nueva?lineas=${selected.join(',')}${[...selectedSuppliers][0] ? `&proveedor=${[...selectedSuppliers][0]}` : ''}`)}
            >
              Generar orden de compra ({selected.length})
            </Button>
          )
        }
      />
      <Select data-tour="sc-filtro-estado" aria-label="Estado" className="mb-3 w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="OPEN">Abiertas</option>
        <option value="ORDERED">Con orden de compra</option>
        <option value="">Todas</option>
      </Select>
      {!data?.length && <Card><EmptyState icon={<Inbox className="size-8" />} title="Sin solicitudes" description="Al liberar una orden de producción con faltantes, podés pedirlos desde la orden." /></Card>}
      <div className="flex flex-col gap-3">
        {data?.map((r) => (
          <Card key={r.id} tour="sc-solicitud">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm">
              <span>
                <strong>{r.number}</strong> · {ORIGIN[r.origin]}
                {r.productionOrderId && <> · <Link className="text-accent hover:underline" href={`/produccion/ordenes/${r.productionOrderId}`}>ver orden</Link></>}
                <span className="block text-xs text-muted">{r.notes} · necesaria para {fmtDate(r.neededBy)}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={r.status === 'OPEN' ? 'warning' : r.status === 'ORDERED' ? 'success' : 'neutral'}>{r.status === 'OPEN' ? 'Abierta' : r.status === 'ORDERED' ? 'Pedida' : 'Cancelada'}</Badge>
                {r.status === 'OPEN' && can('purchasing.order') && <Button data-tour="sc-cancelar" size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>Cancelar</Button>}
              </span>
            </div>
            <ul>
              {r.lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-0">
                  {r.status === 'OPEN' && !l.poLineId && (
                    <input data-tour="sc-casilla" type="checkbox" aria-label="Seleccionar" checked={selected.includes(l.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} />
                  )}
                  <span className="flex-1">{r.items.find((i) => i.id === l.itemId)?.name}</span>
                  <span className="text-muted">{r.parties.find((p) => p.id === l.supplierId)?.legalName ?? 'Sin proveedor habitual'}</span>
                  <span className="num w-24 text-right">{fmtQty(l.qty)}</span>
                  {l.poLineId && <Badge tone="success">En OC</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
