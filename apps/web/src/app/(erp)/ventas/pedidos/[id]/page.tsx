'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, isZero, SO_STATUS } from '@/lib/format';
import { Can, useCan } from '@/lib/session';
import { Badge, Button, Card, ConfirmPanel, ErrorBox, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface OrderLine {
  id: string;
  itemId: string;
  sku: string;
  name: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  promotionName: string | null;
  net: string;
  deliveredQty: string;
  cancelledQty: string;
  pendingQty: string;
  reservedQty: string;
  availableQty: string;
}
interface Order {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  promisedAt: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  netTotal: string;
  vatTotal: string;
  total: string;
  customer: { id: string; legalName: string; creditLimit: string | null } | null;
  warehouse: { name: string } | null;
  priceList: { name: string; includesVat: boolean } | null;
  seller: { name: string } | null;
  creditApprover: string | null;
  creditNote: string | null;
  credit: { exceeded: boolean; excess: string; exposure: string; limit: string | null; balance: string } | null;
  deliveries: { id: string; number: string; issueDate: string; status: string; invoiceId: string | null }[];
  lines: OrderLine[];
  shortages?: { itemId: string; missing: string }[];
}

export default function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: o, isLoading, error } = useQuery({ queryKey: ['sales-order', id], queryFn: () => api.get<Order>(`/sales/orders/${id}`) });
  const [creditNeeded, setCreditNeeded] = useState<string | null>(null);
  const [creditNote, setCreditNote] = useState('');
  const [deliver, setDeliver] = useState<Record<string, string> | null>(null);
  const [extra, setExtra] = useState({ packages: '', carrier: '' });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const refresh = (r?: Order) => {
    if (r) qc.setQueryData(['sales-order', id], r);
    qc.invalidateQueries({ queryKey: ['sales-order', id] });
    qc.invalidateQueries({ queryKey: ['sales-orders'] });
  };
  const shortageMsg = (r: Order) =>
    r.shortages?.length ? toast.warning(`Quedaron ${r.shortages.length} artículo(s) sin stock suficiente: siguen pendientes.`) : toast.success('Todo lo pedido quedó reservado.');

  const confirm = useMutation({
    mutationFn: () => api.post<Order>(`/sales/orders/${id}/confirm`, { creditOverrideNote: creditNote || null }),
    onSuccess: (r) => {
      setCreditNeeded(null);
      shortageMsg(r);
      refresh(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REQUIERE_APROBACION') setCreditNeeded(e.message);
      else toast.error(e.message);
    },
  });
  const reserve = useMutation({
    mutationFn: () => api.post<Order>(`/sales/orders/${id}/reserve`),
    onSuccess: (r) => { shortageMsg(r); refresh(r); },
    onError: (e) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.post<Order>(`/sales/orders/${id}/cancel`, { reason }),
    onSuccess: (r) => { toast.success(r.status === 'CANCELLED' ? 'Pedido cancelado y reservas liberadas.' : 'Pendientes cancelados: el pedido queda entregado.'); setCancelling(false); refresh(r); },
    onError: (e) => toast.error(e.message),
  });
  const createDelivery = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string }>('/sales/deliveries', {
        orderId: id,
        packages: extra.packages ? Number(extra.packages) : null,
        carrier: extra.carrier || null,
        lines: Object.entries(deliver ?? {}).filter(([, q]) => Number(q) > 0).map(([orderLineId, qty]) => ({ orderLineId, qty })),
      }),
    onSuccess: (d) => {
      toast.success(`Remito ${d.number} emitido.`);
      setDeliver(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !o) return <ErrorBox error={error} />;
  const [label, tone] = SO_STATUS[o.status] ?? [o.status, 'neutral'];
  const open = o.status === 'CONFIRMED' || o.status === 'PARTIALLY_DELIVERED';
  const hasPending = o.lines.some((l) => !isZero(l.pendingQty));
  const hasDeliveries = o.lines.some((l) => !isZero(l.deliveredQty));
  const startDelivery = () =>
    setDeliver(Object.fromEntries(o.lines.filter((l) => !isZero(l.pendingQty)).map((l) => [l.id, String(Math.min(Number(l.pendingQty), Number(l.reservedQty) + Math.max(0, Number(l.availableQty))))])));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`Pedido ${o.number}`}
        description={`${o.customer?.legalName} · ${fmtDate(o.orderDate)}${o.promisedAt ? ` · entrega ${fmtDate(o.promisedAt)}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={tone}>{label}</Badge>
            {o.status === 'DRAFT' && <Can perm="sales.order"><Button loading={confirm.isPending} onClick={() => confirm.mutate()}>Confirmar y reservar</Button></Can>}
            {open && hasPending && <Can perm="sales.order"><Button variant="secondary" loading={reserve.isPending} onClick={() => reserve.mutate()}>Reservar pendientes</Button></Can>}
            {open && hasPending && <Can perm="sales.deliver"><Button onClick={startDelivery}>Preparar remito</Button></Can>}
            {(o.status === 'DRAFT' || (open && hasPending)) && (
              <Can perm="sales.order">
                <Button variant="secondary" onClick={() => setCancelling(true)}>{hasDeliveries ? 'Cancelar pendientes' : 'Cancelar pedido'}</Button>
              </Can>
            )}
          </div>
        }
      />

      {creditNeeded && (
        <Card className="mb-4 border-warning/50 p-4">
          <p className="font-medium">Límite de crédito excedido</p>
          <p className="mt-1 text-sm text-muted">{creditNeeded}</p>
          {can('sales.credit.override') ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Motivo de la autorización" htmlFor="cnote" className="min-w-72 flex-1">
                <Input id="cnote" value={creditNote} onChange={(e) => setCreditNote(e.target.value)} />
              </Field>
              <Button loading={confirm.isPending} disabled={creditNote.trim().length < 3} onClick={() => confirm.mutate()}>Autorizar y confirmar</Button>
            </div>
          ) : (
            <p className="mt-2 text-sm">El pedido queda en borrador hasta que Administración lo autorice.</p>
          )}
        </Card>
      )}
      {cancelling && (
        <div className="mb-4">
          <ConfirmPanel
            title={hasDeliveries ? 'Cancelar lo pendiente de entregar' : 'Cancelar el pedido'}
            impact="Se liberan las reservas de stock. Lo ya entregado no cambia."
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Cancelar"
            loading={cancel.isPending}
            onConfirm={() => cancel.mutate()}
            onCancel={() => setCancelling(false)}
          />
        </div>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-4">
        <Card className="p-4 text-sm md:col-span-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
            <dt className="text-muted">Depósito</dt><dd>{o.warehouse?.name}</dd>
            <dt className="text-muted">Lista</dt><dd>{o.priceList?.name ?? '—'}</dd>
            <dt className="text-muted">Vendedor</dt><dd>{o.seller?.name ?? '—'}</dd>
            <dt className="text-muted">Entrega en</dt><dd>{o.deliveryAddress ?? '—'}</dd>
          </dl>
          {o.creditApprover && <p className="mt-2 text-xs text-muted">Crédito excedido autorizado por {o.creditApprover}: {o.creditNote}</p>}
          {o.notes && <p className="mt-2 text-sm">{o.notes}</p>}
        </Card>
        <Card className="p-4 text-sm">
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted">Neto</dt><dd className="num text-right">{fmtMoney(o.netTotal)}</dd>
            <dt className="text-muted">IVA</dt><dd className="num text-right">{fmtMoney(o.vatTotal)}</dd>
            <dt className="font-medium">Total</dt><dd className="num text-right font-semibold">{fmtMoney(o.total)}</dd>
          </dl>
        </Card>
      </div>

      <Card className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Artículo</th>
              <th className="px-3 py-2 text-right">Pedido</th>
              <th className="px-3 py-2 text-right">Precio neto</th>
              <th className="px-3 py-2 text-right">Desc.</th>
              <th className="px-3 py-2 text-right">Importe</th>
              <th className="px-3 py-2 text-right">Entregado</th>
              <th className="px-3 py-2 text-right">Pendiente</th>
              <th className="px-3 py-2 text-right">Reservado</th>
              <th className="px-3 py-2 text-right">Disponible</th>
              {deliver && <th className="px-3 py-2 text-right">A entregar</th>}
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => {
              const short = open && Number(l.pendingQty) > Number(l.reservedQty);
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2"><span className="font-medium">{l.sku}</span> <span className="text-muted">{l.name}</span></td>
                  <td className="num px-3 py-2 text-right whitespace-nowrap">{fmtQty(l.qty)}</td>
                  <td className="num px-3 py-2 text-right whitespace-nowrap">{fmtMoney(l.unitPrice)}</td>
                  <td className="num px-3 py-2 text-right whitespace-nowrap">
                    {isZero(l.discountPct) ? '—' : `${fmtQty(l.discountPct)} %`}
                    {l.promotionName && <span className="block text-xs font-normal text-success">{l.promotionName}</span>}
                  </td>
                  <td className="num px-3 py-2 text-right whitespace-nowrap">{fmtMoney(l.net)}</td>
                  <td className="num px-3 py-2 text-right whitespace-nowrap">{fmtQty(l.deliveredQty)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{fmtQty(l.pendingQty)}{!isZero(l.cancelledQty) && <span className="ml-1 text-xs text-muted">({fmtQty(l.cancelledQty)} canc.)</span>}</td>
                  <td className={`num px-3 py-2 text-right ${short ? 'text-warning' : ''}`}>{fmtQty(l.reservedQty)}</td>
                  <td className="num px-3 py-2 text-right text-muted">{fmtQty(l.availableQty)}</td>
                  {deliver && (
                    <td className="px-3 py-1 text-right">
                      {l.id in deliver ? (
                        <Input
                          aria-label={`Entregar ${l.sku}`}
                          className="num ml-auto h-8 w-20 text-right"
                          inputMode="decimal"
                          value={deliver[l.id]}
                          onChange={(e) => setDeliver({ ...deliver, [l.id]: e.target.value.replace(',', '.') })}
                        />
                      ) : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {deliver && (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
          <Field label="Bultos" htmlFor="pk"><Input id="pk" className="w-24" inputMode="numeric" value={extra.packages} onChange={(e) => setExtra({ ...extra, packages: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Transporte" htmlFor="carrier" className="min-w-60 flex-1"><Input id="carrier" value={extra.carrier} onChange={(e) => setExtra({ ...extra, carrier: e.target.value })} /></Field>
          <Button loading={createDelivery.isPending} onClick={() => createDelivery.mutate()}>Emitir remito</Button>
          <Button variant="secondary" onClick={() => setDeliver(null)}>Cancelar</Button>
          <p className="w-full text-xs text-muted">Precargado con lo reservado y lo disponible. El remito descuenta el stock; la factura se emite después desde Comprobantes.</p>
        </Card>
      )}

      {o.deliveries.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 font-medium">Remitos</p>
          <ul className="text-sm">
            {o.deliveries.map((d) => (
              <li key={d.id} className="flex gap-3 py-1">
                <Link className="font-medium hover:underline" href={`/ventas/remitos/${d.id}`}>{d.number}</Link>
                <span className="text-muted">{fmtDate(d.issueDate)}</span>
                {d.status === 'VOIDED' ? <Badge tone="danger">Anulado</Badge> : d.invoiceId ? <Badge tone="success">Facturado</Badge> : <Badge tone="warning">Sin facturar</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
