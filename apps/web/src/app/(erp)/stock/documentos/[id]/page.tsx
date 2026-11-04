'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DOC_STATUS_LABELS, DOC_TYPE_LABELS, fmtDateTime, fmtMoney, fmtQty, MOVEMENT_LABELS, statusTone } from '@/lib/format';
import { useCan, useMasterData, useMe } from '@/lib/session';
import { Badge, Button, Card, ConfirmPanel, ErrorBox, PageHeader, Spinner } from '@/components/ui';

interface DocDetail {
  id: string;
  number: string;
  type: 'OPENING' | 'ADJUSTMENT' | 'TRANSFER';
  status: string;
  warehouseId: string;
  targetWarehouseId: string | null;
  reason: string | null;
  notes: string | null;
  totalValue: string;
  createdAt: string;
  createdBy: string;
  postedAt: string | null;
  lines: { id: string; itemId: string; qty: string; unitCost: string | null; lotId: string | null }[];
  items: { id: string; sku: string; name: string }[];
  movements: { id: string; itemId: string; warehouseId: string; type: string; qty: string; unitCost: string; occurredAt: string; sourceDocType: string }[];
}

export default function StockDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: me } = useMe();
  const { data: md } = useMasterData();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const { data: doc, isLoading, error } = useQuery({ queryKey: ['stock-doc', id], queryFn: () => api.get<DocDetail>(`/inventory/documents/${id}`) });
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['stock-doc', id] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['stock-docs'] });
    qc.invalidateQueries({ queryKey: ['inventory-summary'] });
  };
  const approve = useMutation({ mutationFn: () => api.post(`/inventory/documents/${id}/approve`), onSuccess: () => done('Ajuste aprobado y aplicado.'), onError: (e) => toast.error(e.message) });
  const voidDoc = useMutation({
    mutationFn: () => api.post(`/inventory/documents/${id}/void`, { reason }),
    onSuccess: () => {
      setVoiding(false);
      done('Documento anulado. Se generaron los movimientos de reversa.');
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !doc) return <ErrorBox error={error} />;
  const wh = (wid: string | null) => md?.warehouses.find((w) => w.id === wid)?.name ?? '—';
  const item = (iid: string) => doc.items.find((i) => i.id === iid);
  const showCost = can('costs.view');
  const permByType = { OPENING: 'inventory.opening', ADJUSTMENT: 'inventory.adjust', TRANSFER: 'inventory.transfer' } as const;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`${DOC_TYPE_LABELS[doc.type]} ${doc.number}`}
        description={doc.targetWarehouseId ? `${wh(doc.warehouseId)} → ${wh(doc.targetWarehouseId)}` : wh(doc.warehouseId)}
        actions={
          <>
            <Badge tone={statusTone(doc.status)}>{DOC_STATUS_LABELS[doc.status]}</Badge>
            {doc.status === 'PENDING_APPROVAL' && can('inventory.adjust.approve') && doc.createdBy !== me?.user.id && (
              <Button loading={approve.isPending} onClick={() => approve.mutate()}>Aprobar</Button>
            )}
            {doc.status !== 'VOIDED' && can(permByType[doc.type]) && !voiding && (
              <Button variant="secondary" onClick={() => setVoiding(true)}>Anular</Button>
            )}
          </>
        }
      />
      {doc.status === 'PENDING_APPROVAL' && doc.createdBy === me?.user.id && (
        <p className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          Este ajuste supera el umbral configurado y tiene que aprobarlo otra persona con permiso de aprobación.
        </p>
      )}
      {voiding && (
        <div className="mb-4">
          <ConfirmPanel
            title={`Anular ${doc.number}`}
            impact={
              doc.status === 'POSTED'
                ? `Se generarán ${doc.movements.filter((m) => m.sourceDocType === 'STOCK_DOCUMENT').length} movimientos de reversa que devuelven el stock a su estado anterior. El documento original se conserva.`
                : 'El documento no movió stock todavía; solo cambiará su estado.'
            }
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Anular documento"
            loading={voidDoc.isPending}
            onConfirm={() => voidDoc.mutate()}
            onCancel={() => setVoiding(false)}
          />
        </div>
      )}
      <Card className="mb-4 grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-muted">Creado</p>
          <p>{fmtDateTime(doc.createdAt)}</p>
        </div>
        <div>
          <p className="text-muted">Confirmado</p>
          <p>{fmtDateTime(doc.postedAt)}</p>
        </div>
        <div>
          <p className="text-muted">Motivo</p>
          <p>{doc.reason ?? '—'}</p>
        </div>
        {showCost && (
          <div>
            <p className="text-muted">Valor</p>
            <p className="num">{fmtMoney(doc.totalValue)}</p>
          </div>
        )}
        {doc.notes && (
          <div className="col-span-full">
            <p className="text-muted">Observaciones</p>
            <p>{doc.notes}</p>
          </div>
        )}
      </Card>
      <h2 className="mb-2 font-medium">Líneas</h2>
      <Card className="mb-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Artículo</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              {showCost && doc.type === 'OPENING' && <th className="px-3 py-2 text-right">Costo unitario</th>}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/stock/${l.itemId}`} className="hover:underline">
                    {item(l.itemId)?.name} <span className="text-muted">· {item(l.itemId)?.sku}</span>
                  </Link>
                </td>
                <td className="num px-3 py-2 text-right">{fmtQty(l.qty)}</td>
                {showCost && doc.type === 'OPENING' && <td className="num px-3 py-2 text-right">{fmtMoney(l.unitCost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <h2 className="mb-2 font-medium">Movimientos generados</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Artículo</th>
              <th className="px-3 py-2 text-left">Depósito</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {doc.movements.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{fmtDateTime(m.occurredAt)}</td>
                <td className="px-3 py-2">
                  {MOVEMENT_LABELS[m.type]}
                  {m.sourceDocType === 'STOCK_DOCUMENT_VOID' && <Badge tone="danger">reversa</Badge>}
                </td>
                <td className="px-3 py-2">{item(m.itemId)?.sku}</td>
                <td className="px-3 py-2">{wh(m.warehouseId)}</td>
                <td className="num px-3 py-2 text-right">{fmtQty(m.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!doc.movements.length && <p className="p-4 text-sm text-muted">Este documento todavía no movió stock.</p>}
      </Card>
    </div>
  );
}
