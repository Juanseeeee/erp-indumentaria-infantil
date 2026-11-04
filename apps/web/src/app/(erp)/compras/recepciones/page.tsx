'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty } from '@/lib/format';
import { Can } from '@/lib/session';
import { Card, LinkButton, PageHeader } from '@/components/ui';

interface Receipt {
  id: string;
  number: string;
  supplierId: string;
  supplierDeliveryNote: string | null;
  purchaseOrderId: string | null;
  receivedAt: string;
  lines: { id: string; itemId: string; qty: string; invoicedQty: string }[];
  parties: { id: string; legalName: string }[];
}

export default function ReceiptsPage() {
  const { data } = useQuery({ queryKey: ['receipts'], queryFn: () => api.get<Receipt[]>('/purchasing/receipts') });
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Recepciones"
        description="Lo único que hace entrar stock de compras. Para recibir contra una orden de compra, entrá a la orden."
        actions={<Can perm="purchasing.receive"><LinkButton href="/compras/recepciones/nueva" variant="secondary"><Plus className="size-4" /> Compra directa (sin OC)</LinkButton></Can>}
      />
      <Card>
        <ul>
          {data?.map((r) => {
            const invoiced = r.lines.every((l) => Number(l.invoicedQty) >= Number(l.qty));
            return (
              <li key={r.id} className="border-b border-border last:border-0">
                <Link href={`/compras/recepciones/${r.id}`} className="flex justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2">
                  <span>
                    <strong>{r.number}</strong> · {r.parties.find((p) => p.id === r.supplierId)?.legalName}
                    <span className="block text-xs text-muted">{fmtDateTime(r.receivedAt)}{r.supplierDeliveryNote && ` · remito ${r.supplierDeliveryNote}`}{!r.purchaseOrderId && ' · sin OC'}</span>
                  </span>
                  <span className={`text-xs ${invoiced ? 'text-success' : 'text-warning'}`}>{invoiced ? 'Facturada' : 'Pendiente de factura'} · {fmtQty(String(r.lines.length))} líneas</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {!data?.length && <p className="p-6 text-center text-sm text-muted">Todavía no hay recepciones.</p>}
      </Card>
    </div>
  );
}
