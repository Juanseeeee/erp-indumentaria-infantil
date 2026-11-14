'use client';

import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, PO_STATUS } from '@/lib/format';
import { useCan, useMasterData, useMe } from '@/lib/session';
import { Badge, Button, Card, ConfirmPanel, ErrorBox, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface PO {
  id: string;
  number: string;
  status: string;
  supplierId: string;
  warehouseId: string;
  date: string;
  expectedAt: string | null;
  netTotal: string;
  notes: string | null;
  createdBy: string;
  supplier: { legalName: string };
  lines: { id: string; itemId: string; qty: string; unitPrice: string; vatRate: string; receivedQty: string; invoicedQty: string }[];
  items: { id: string; sku: string; name: string; trackLots: boolean }[];
  receipts: { id: string; number: string; receivedAt: string }[];
}

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: me } = useMe();
  const { data: md } = useMasterData();
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [rec, setRec] = useState<Record<string, { qty: string; lot: string }>>({});
  const [remito, setRemito] = useState('');
  const [closePending, setClosePending] = useState(false);
  const key = useRef(crypto.randomUUID());
  const { data: po, isLoading, error } = useQuery({ queryKey: ['purchase-order', id], queryFn: () => api.get<PO>(`/purchasing/orders/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['purchase-order', id] });
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
  };
  const approve = useMutation({ mutationFn: () => api.post(`/purchasing/orders/${id}/approve`), onSuccess: () => { toast.success('Orden aprobada.'); refresh(); }, onError: (e) => toast.error(e.message) });
  const cancel = useMutation({ mutationFn: () => api.post(`/purchasing/orders/${id}/cancel`, { reason }), onSuccess: () => { toast.success('Orden cancelada / cerrada.'); setCancelling(false); refresh(); }, onError: (e) => toast.error(e.message) });
  const receive = useMutation({
    mutationFn: () =>
      api.post<{ number: string }>(
        '/purchasing/receipts',
        {
          supplierId: po!.supplierId,
          warehouseId: po!.warehouseId,
          purchaseOrderId: id,
          supplierDeliveryNote: remito || null,
          closePending,
          lines: Object.entries(rec)
            .filter(([, v]) => Number(v.qty) > 0)
            .map(([poLineId, v]) => ({ poLineId, itemId: po!.lines.find((l) => l.id === poLineId)!.itemId, qty: v.qty, lotCode: v.lot || null })),
        },
        { idempotencyKey: key.current },
      ),
    onSuccess: (r) => {
      key.current = crypto.randomUUID();
      toast.success(`Recepción ${r.number} registrada. El stock ya está disponible.`);
      setReceiving(false);
      setClosePending(false);
      refresh();
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e.message);
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !po) return <ErrorBox error={error} />;
  const [label, tone] = PO_STATUS[po.status] ?? [po.status, 'neutral'];
  const item = (iid: string) => po.items.find((i) => i.id === iid);
  const pending = (l: PO['lines'][number]) => Math.max(0, Number(l.qty) - Number(l.receivedQty));
  const canReceive = ['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && can('purchasing.receive');
  const shortNow = receiving
    ? po.lines
        .map((l) => ({ sku: item(l.itemId)?.sku ?? '', qty: Math.round((pending(l) - Number(rec[l.id]?.qty || 0)) * 10000) / 10000 }))
        .filter((s) => s.qty > 0)
    : [];

  return (
    <div className="max-w-5xl">
      <PageHeader
        tour="oc-detalle-encabezado"
        title={`${po.number} · ${po.supplier.legalName}`}
        description={`Emitida ${fmtDate(po.date)} · entrega esperada ${fmtDate(po.expectedAt)} · recibe en ${md?.warehouses.find((w) => w.id === po.warehouseId)?.name ?? ''}`}
        actions={
          <>
            <Badge tone={tone}>{label}</Badge>
            {po.status === 'DRAFT' && can('purchasing.approve') && po.createdBy !== me?.user.id && <Button data-tour="oc-detalle-aprobar" loading={approve.isPending} onClick={() => approve.mutate()}>Aprobar</Button>}
            {canReceive && !receiving && (
              <Button data-tour="oc-detalle-recibir" onClick={() => { setReceiving(true); setRec(Object.fromEntries(po.lines.map((l) => [l.id, { qty: String(pending(l)), lot: '' }]))); }}>Registrar recepción</Button>
            )}
            {['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && can('purchasing.order') && !cancelling && (
              <Button data-tour="oc-detalle-cancelar" variant="ghost" onClick={() => setCancelling(true)}>{po.status === 'PARTIALLY_RECEIVED' ? 'Cerrar pendiente' : 'Cancelar'}</Button>
            )}
          </>
        }
      />
      {po.status === 'DRAFT' && po.createdBy === me?.user.id && (
        <p data-tour="oc-detalle-aviso-aprobacion" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Supera el monto de aprobación: la tiene que aprobar otra persona con permiso.</p>
      )}
      {cancelling && (
        <div className="mb-4" data-tour="oc-detalle-motivo">
          <ConfirmPanel
            title={po.status === 'PARTIALLY_RECEIVED' ? 'Cerrar lo pendiente' : `Cancelar ${po.number}`}
            impact={po.status === 'PARTIALLY_RECEIVED' ? 'Lo ya recibido se mantiene; lo pendiente deja de esperarse.' : 'La orden no tiene recepciones; queda cancelada.'}
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Confirmar"
            loading={cancel.isPending}
            onConfirm={() => cancel.mutate()}
            onCancel={() => setCancelling(false)}
          />
        </div>
      )}
      <Card className="mb-4 overflow-x-auto" tour="oc-detalle-lineas">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Material</th>
              <th className="px-3 py-2 text-right">Pedido</th>
              <th className="px-3 py-2 text-right">Recibido</th>
              <th className="px-3 py-2 text-right">{po.status === 'CLOSED' ? 'No entregado' : 'Pendiente'}</th>
              <th className="px-3 py-2 text-right">Facturado</th>
              <th className="px-3 py-2 text-right">Precio neto</th>
              {receiving && <th className="px-3 py-2 text-right">Recibir ahora</th>}
              {receiving && <th className="px-3 py-2 text-left">Partida</th>}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{item(l.itemId)?.name}<span className="block text-xs text-muted">{item(l.itemId)?.sku}</span></td>
                <td className="num px-3 py-2 text-right">{fmtQty(l.qty)}</td>
                <td className="num px-3 py-2 text-right">{fmtQty(l.receivedQty)}</td>
                <td className={`num px-3 py-2 text-right ${pending(l) > 0 && po.status === 'CLOSED' ? 'text-warning' : pending(l) > 0 ? '' : 'text-muted'}`}>{fmtQty(String(pending(l)))}</td>
                <td className="num px-3 py-2 text-right">{fmtQty(l.invoicedQty)}</td>
                <td className="num px-3 py-2 text-right">{fmtMoney(l.unitPrice)} <span className="text-xs text-muted">+{l.vatRate}%</span></td>
                {receiving && (
                  <td className="px-3 py-2 text-right">
                    <Input data-tour="oc-detalle-recibir-ahora" className="num ml-auto w-24 text-right" inputMode="decimal" aria-label={`Recibir ${item(l.itemId)?.sku}`} value={rec[l.id]?.qty ?? ''} onChange={(e) => setRec((r) => ({ ...r, [l.id]: { ...r[l.id]!, qty: e.target.value.replace(',', '.') } }))} />
                  </td>
                )}
                {receiving && (
                  <td className="px-3 py-2">
                    {item(l.itemId)?.trackLots ? (
                      <Input data-tour="oc-detalle-partida" className="w-28" placeholder="Obligatoria" aria-label={`Partida ${item(l.itemId)?.sku}`} value={rec[l.id]?.lot ?? ''} onChange={(e) => setRec((r) => ({ ...r, [l.id]: { ...r[l.id]!, lot: e.target.value } }))} />
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="num border-t border-border px-3 py-2 text-right text-sm">Neto total {fmtMoney(po.netTotal)}</p>
      </Card>
      {receiving && (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-4" tour="oc-detalle-recepcion">
          <Field label="Remito del proveedor" htmlFor="rem" tour="oc-detalle-remito"><Input id="rem" value={remito} onChange={(e) => setRemito(e.target.value)} placeholder="0001-00001234" /></Field>
          {shortNow.length > 0 && (
            <label data-tour="oc-detalle-cerrar-faltante" className="flex max-w-md items-start gap-2 self-center text-sm">
              <input type="checkbox" className="mt-1" checked={closePending} onChange={(e) => setClosePending(e.target.checked)} />
              <span>
                El proveedor no va a entregar lo que falta: cerrar la orden.
                <span className="block text-xs text-muted">No entregado: {shortNow.map((s) => `${s.sku} ${fmtQty(String(s.qty))}`).join(' · ')}</span>
              </span>
            </label>
          )}
          <Button data-tour="oc-detalle-confirmar-recepcion" loading={receive.isPending} onClick={() => receive.mutate()}>Confirmar recepción</Button>
          <Button variant="secondary" onClick={() => setReceiving(false)}>Cancelar</Button>
          <span className="w-full text-xs text-muted">Cargá en «Recibir ahora» lo que llegó realmente (por ejemplo 2.500 de 3.000). Si el resto va a llegar más adelante, dejá la orden abierta; si no, marcá la casilla. Se tolera hasta un 5 % más de lo pedido.</span>
        </Card>
      )}
      {po.receipts.length > 0 && (
        <Card className="p-4 text-sm" tour="oc-detalle-recepciones">
          <p className="mb-2 font-medium">Recepciones</p>
          {po.receipts.map((r) => <p key={r.id}><Link className="text-accent hover:underline" href={`/compras/recepciones/${r.id}`}>{r.number}</Link> · {fmtDateTime(r.receivedAt)}</p>)}
        </Card>
      )}
    </div>
  );
}
