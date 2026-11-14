'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtQty } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Card, ErrorBox, LinkButton, PageHeader, Spinner } from '@/components/ui';

interface Receipt {
  id: string;
  number: string;
  supplierId: string;
  warehouseId: string;
  supplierDeliveryNote: string | null;
  receivedAt: string;
  purchaseOrder: { id: string; number: string } | null;
  lines: { id: string; itemId: string; qty: string; unitCost: string; invoicedQty: string; lotId: string | null }[];
  items: { id: string; sku: string; name: string }[];
  parties: { id: string; legalName: string }[];
  lots: { id: string; code: string }[];
}

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data: md } = useMasterData();
  const { data: r, isLoading, error } = useQuery({ queryKey: ['receipt', id], queryFn: () => api.get<Receipt>(`/purchasing/receipts/${id}`) });
  if (isLoading) return <Spinner />;
  if (error || !r) return <ErrorBox error={error} />;
  const pendingInvoice = r.lines.some((l) => Number(l.invoicedQty) < Number(l.qty));
  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`Recepción ${r.number}`}
        description={`${r.parties.find((p) => p.id === r.supplierId)?.legalName} · ${fmtDateTime(r.receivedAt)} · ${md?.warehouses.find((w) => w.id === r.warehouseId)?.name ?? ''}${r.supplierDeliveryNote ? ` · remito ${r.supplierDeliveryNote}` : ''}`}
        actions={pendingInvoice && can('purchasing.invoice') && <LinkButton href={`/compras/comprobantes/nuevo?proveedor=${r.supplierId}`} tour="re-detalle-cargar-factura">Cargar factura</LinkButton>}
      />
      {r.purchaseOrder && <p className="mb-3 text-sm">Orden de compra: <Link className="text-accent hover:underline" href={`/compras/ordenes/${r.purchaseOrder.id}`}>{r.purchaseOrder.number}</Link></p>}
      <Card className="overflow-x-auto" tour="re-detalle-lineas">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Material</th>
              <th className="px-3 py-2 text-left">Partida</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2 text-right">Facturado</th>
              {can('costs.view') && <th className="px-3 py-2 text-right">Costo unit.</th>}
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2"><Link className="hover:underline" href={`/stock/${l.itemId}`}>{r.items.find((i) => i.id === l.itemId)?.name}</Link></td>
                <td className="px-3 py-2">{r.lots.find((x) => x.id === l.lotId)?.code ?? '—'}</td>
                <td className="num px-3 py-2 text-right">{fmtQty(l.qty)}</td>
                <td className="num px-3 py-2 text-right">{fmtQty(l.invoicedQty)}</td>
                {can('costs.view') && <td className="num px-3 py-2 text-right">{fmtMoney(l.unitCost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
