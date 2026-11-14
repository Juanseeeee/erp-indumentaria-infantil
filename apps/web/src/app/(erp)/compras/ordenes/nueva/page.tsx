'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMasterData } from '@/lib/session';
import { PurchaseLines, type PLine } from '@/components/purchase-lines';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface RequestRow {
  id: string;
  number: string;
  lines: { id: string; itemId: string; qty: string; supplierId: string | null; poLineId: string | null }[];
  items: { id: string; sku: string; name: string }[];
}

function NewPurchaseOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: md } = useMasterData();
  const [supplierId, setSupplierId] = useState(params.get('proveedor') ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PLine[]>([]);
  const [requestLineIds, setRequestLineIds] = useState<string[]>([]);
  const key = useRef(crypto.randomUUID());
  const suppliers = useQuery({ queryKey: ['parties', 'suppliers-select'], queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=SUPPLIER&pageSize=200') });
  const requests = useQuery({ queryKey: ['purchase-requests', 'OPEN'], queryFn: () => api.get<RequestRow[]>('/purchasing/requests?status=OPEN') });

  // Desde Solicitudes: ?lineas=id1,id2 precarga las líneas.
  useEffect(() => {
    const ids = params.get('lineas')?.split(',') ?? [];
    if (!ids.length || !requests.data) return;
    const found = requests.data.flatMap((r) => r.lines.map((l) => ({ l, items: r.items }))).filter(({ l }) => ids.includes(l.id));
    setRequestLineIds(found.map(({ l }) => l.id));
    setLines(
      found.map(({ l, items }) => {
        const it = items.find((i) => i.id === l.itemId);
        return { itemId: l.itemId, sku: it?.sku ?? '', name: it?.name ?? '', uom: '', qty: l.qty, unitPrice: '', vatRate: '21' };
      }),
    );
    if (!supplierId && found[0]?.l.supplierId) setSupplierId(found[0].l.supplierId);
  }, [params, requests.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; status: string; number: string }>(
        '/purchasing/orders',
        { supplierId, warehouseId, expectedAt: expectedAt || null, notes: notes || null, requestLineIds, lines: lines.map(({ itemId, qty, unitPrice, vatRate }) => ({ itemId, qty, unitPrice, vatRate })) },
        { idempotencyKey: key.current },
      ),
    onSuccess: (po) => {
      toast.success(po.status === 'DRAFT' ? `${po.number} creada: supera el monto de aprobación y quedó pendiente.` : `${po.number} creada y aprobada.`);
      router.push(`/compras/ordenes/${po.id}`);
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e.message);
    },
  });

  if (!md) return <Spinner />;
  const valid = supplierId && warehouseId && lines.length && lines.every((l) => Number(l.qty) > 0 && l.unitPrice !== '');
  return (
    <div className="max-w-5xl">
      <PageHeader title="Nueva orden de compra" description={requestLineIds.length ? `Generada desde ${requestLineIds.length} líneas de solicitudes de compra.` : undefined} />
      <Card className="mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        <Field label="Proveedor" htmlFor="sup" tour="oc-nueva-proveedor">
          <Select id="sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Elegí…</option>
            {suppliers.data?.rows.map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
          </Select>
        </Field>
        <Field label="Recibir en" htmlFor="wh" tour="oc-nueva-deposito">
          <Select id="wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Elegí…</option>
            {md.warehouses.filter((w) => w.isActive && w.type === 'OWN').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Entrega esperada" htmlFor="exp" tour="oc-nueva-entrega"><Input id="exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
        <Field label="Observaciones" htmlFor="notes" className="sm:col-span-3" tour="oc-nueva-observaciones"><Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </Card>
      <Card className="mb-4" tour="oc-nueva-lineas"><PurchaseLines lines={lines} setLines={setLines} /></Card>
      <div className="flex gap-2">
        <Button data-tour="oc-nueva-crear" disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>Crear orden de compra</Button>
        <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
      </div>
    </div>
  );
}

export default function NewPurchaseOrderPage() {
  return (
    <Suspense>
      <NewPurchaseOrder />
    </Suspense>
  );
}
