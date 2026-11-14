'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDate, fmtFiscal, fmtQty, TAX_CONDITION_LABELS } from '@/lib/format';
import { Can } from '@/lib/session';
import { DocHeader, PrintButton } from '@/components/doc-print';
import { Badge, Card, ConfirmPanel, ErrorBox, LinkButton, Button, Spinner } from '@/components/ui';

interface Delivery {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  carrier: string | null;
  packages: number | null;
  notes: string | null;
  voidReason: string | null;
  customer: { id: string; legalName: string; taxId: string; taxCondition: string; addresses: { street: string; city: string | null; province: string | null }[] } | null;
  company: { legalName: string; cuit: string; address: string | null } | null;
  warehouse: { name: string } | null;
  order: { id: string; number: string; deliveryAddress: string | null } | null;
  invoice: { id: string; docType: string; pointOfSale: number; number: number | null; status: string } | null;
  lines: { id: string; sku: string; name: string; qty: string; barcode: string | null }[];
}

export default function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { data: d, isLoading, error } = useQuery({ queryKey: ['delivery', id], queryFn: () => api.get<Delivery>(`/sales/deliveries/${id}`) });
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const voidIt = useMutation({
    mutationFn: () => api.post<Delivery>(`/sales/deliveries/${id}/void`, { reason }),
    onSuccess: (r) => {
      toast.success('Remito anulado: la mercadería volvió al depósito y el pedido quedó pendiente.');
      qc.setQueryData(['delivery', id], r);
      setVoiding(false);
    },
    onError: (e) => toast.error(e.message),
  });
  if (isLoading) return <Spinner />;
  if (error || !d) return <ErrorBox error={error} />;
  const addr = d.order?.deliveryAddress ?? d.customer?.addresses.map((a) => [a.street, a.city, a.province].filter(Boolean).join(', '))[0];
  const total = d.lines.reduce((a, l) => a + Number(l.qty), 0);

  return (
    <div className="max-w-4xl">
      <div className="print-hide mb-4 flex flex-wrap items-center gap-2">
        {d.status === 'VOIDED' ? <Badge tone="danger">Anulado: {d.voidReason}</Badge> : d.invoice ? (
          <Link href={`/ventas/comprobantes/${d.invoice.id}`}><Badge tone="success">Facturado en {fmtFiscal(d.invoice)}</Badge></Link>
        ) : <Badge tone="warning">Sin facturar</Badge>}
        <div className="ml-auto flex gap-2" data-tour="remito-detalle-acciones">
          {d.status === 'ISSUED' && !d.invoice && (
            <>
              <Can perm="sales.invoice"><LinkButton href={`/ventas/comprobantes/nuevo?cliente=${d.customer?.id}&remito=${d.id}`} tour="remito-detalle-facturar">Facturar</LinkButton></Can>
              <Can perm="sales.deliver"><Button data-tour="remito-detalle-anular" variant="secondary" onClick={() => setVoiding(true)}>Anular</Button></Can>
            </>
          )}
          <PrintButton />
        </div>
      </div>
      {voiding && (
        <div className="print-hide mb-4">
          <ConfirmPanel
            title={`Anular el remito ${d.number}`}
            impact="La mercadería vuelve al depósito con su partida y costo, y las cantidades vuelven a quedar pendientes en el pedido."
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Anular remito"
            loading={voidIt.isPending}
            onConfirm={() => voidIt.mutate()}
            onCancel={() => setVoiding(false)}
          />
        </div>
      )}
      <Card className="p-6" tour="remito-detalle-documento">
        <DocHeader company={d.company} title="Remito" number={d.number} meta={<p className="text-muted">Fecha {fmtDate(d.issueDate)}</p>} />
        <p className="mt-1 text-right text-xs text-muted">Documento no válido como factura</p>
        <div className="my-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium">{d.customer?.legalName}</p>
            <p className="text-muted">CUIT {d.customer?.taxId} · {TAX_CONDITION_LABELS[d.customer?.taxCondition ?? ''] ?? ''}</p>
            <p className="text-muted">Entrega: {addr ?? '—'}</p>
          </div>
          <div className="sm:text-right">
            {d.order && <p>Pedido <Link className="print-hide hover:underline" href={`/ventas/pedidos/${d.order.id}`}>{d.order.number}</Link></p>}
            <p className="text-muted">Desde {d.warehouse?.name}</p>
            {d.carrier && <p className="text-muted">Transporte: {d.carrier}</p>}
            {d.packages && <p className="text-muted">Bultos: {d.packages}</p>}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border text-xs text-muted uppercase">
              <th className="px-2 py-2 text-left">Código</th>
              <th className="px-2 py-2 text-left">Descripción</th>
              <th className="px-2 py-2 text-right">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="px-2 py-1.5 font-medium">{l.sku}</td>
                <td className="px-2 py-1.5">{l.name}</td>
                <td className="num px-2 py-1.5 text-right">{fmtQty(l.qty)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="px-2 py-2 text-right font-medium">Total de prendas</td>
              <td className="num px-2 py-2 text-right font-semibold">{total.toLocaleString('es-AR')}</td>
            </tr>
          </tfoot>
        </table>
        {d.notes && <p className="mt-3 text-sm">{d.notes}</p>}
        <div className="mt-12 grid grid-cols-2 gap-8 text-center text-xs text-muted">
          <p className="border-t border-border pt-1">Firma y aclaración de quien recibe</p>
          <p className="border-t border-border pt-1">Fecha de recepción</p>
        </div>
      </Card>
    </div>
  );
}
