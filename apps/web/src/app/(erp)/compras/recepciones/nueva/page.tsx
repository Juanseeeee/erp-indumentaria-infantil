'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMasterData } from '@/lib/session';
import { PurchaseLines, type PLine } from '@/components/purchase-lines';
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';

/** Compra directa (circuito simplificado): recepción sin orden de compra, con costo por línea. */
export default function DirectReceiptPage() {
  const router = useRouter();
  const { data: md } = useMasterData();
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [remito, setRemito] = useState('');
  const [lines, setLines] = useState<PLine[]>([]);
  const [lots, setLots] = useState<Record<string, string>>({});
  const key = useRef(crypto.randomUUID());
  const suppliers = useQuery({ queryKey: ['parties', 'suppliers-select'], queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=SUPPLIER&pageSize=200') });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string }>(
        '/purchasing/receipts',
        {
          supplierId,
          warehouseId,
          supplierDeliveryNote: remito || null,
          lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitPrice, lotCode: lots[l.itemId] || null })),
        },
        { idempotencyKey: key.current },
      ),
    onSuccess: (r) => {
      toast.success(`Recepción ${r.number} registrada. Ahora podés cargar la factura.`);
      router.push(`/compras/recepciones/${r.id}`);
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e.message);
    },
  });
  if (!md) return <Spinner />;
  return (
    <div className="max-w-5xl">
      <PageHeader title="Compra directa" description="Para compras chicas sin orden de compra. El precio neto de cada línea es el costo con el que entra al stock." />
      <Card className="mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        <Field label="Proveedor" htmlFor="sup" tour="re-directa-proveedor">
          <Select id="sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Elegí…</option>
            {suppliers.data?.rows.map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
          </Select>
        </Field>
        <Field label="Depósito" htmlFor="wh" tour="re-directa-deposito">
          <Select id="wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Elegí…</option>
            {md.warehouses.filter((w) => w.isActive && w.type === 'OWN').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Remito del proveedor" htmlFor="rem" tour="re-directa-remito"><Input id="rem" value={remito} onChange={(e) => setRemito(e.target.value)} /></Field>
      </Card>
      <Card className="mb-4" tour="re-directa-lineas">
        <PurchaseLines lines={lines} setLines={setLines} />
        {lines.length > 0 && (
          <div data-tour="re-directa-partidas" className="flex flex-wrap gap-3 border-t border-border p-3">
            {lines.map((l) => (
              <label key={l.itemId} className="flex items-center gap-2 text-xs">
                Partida {l.sku}
                <Input className="h-8 w-28" value={lots[l.itemId] ?? ''} onChange={(e) => setLots((x) => ({ ...x, [l.itemId]: e.target.value }))} placeholder="si controla lote" />
              </label>
            ))}
          </div>
        )}
      </Card>
      <Button data-tour="re-directa-registrar" disabled={!supplierId || !warehouseId || !lines.length || lines.some((l) => !(Number(l.qty) > 0) || l.unitPrice === '')} loading={create.isPending} onClick={() => create.mutate()}>
        Registrar recepción
      </Button>
    </div>
  );
}
