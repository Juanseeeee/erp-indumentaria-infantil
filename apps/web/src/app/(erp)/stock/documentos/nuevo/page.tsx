'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Grid3x3, Trash2 } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { DOC_TYPE_LABELS, fmtQty } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { ItemPicker, type PickedItem } from '@/components/item-picker';
import { VariantGrid, type GridCell } from '@/components/variant-grid';
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';

type DocType = 'OPENING' | 'ADJUSTMENT' | 'TRANSFER';
interface Line {
  itemId: string;
  sku: string;
  name: string;
  uom: string;
  available: string;
  trackLots?: boolean;
  qty: string;
  unitCost: string;
  lotCode: string;
}

const REASONS = ['Rotura / daño', 'Diferencia de inventario', 'Muestra / regalo', 'Vencimiento / obsolescencia', 'Error de carga', 'Otro'];

const DESCRIPTIONS: Record<DocType, string> = {
  OPENING: 'Carga del stock existente al empezar a usar el sistema. Indicá el costo unitario de cada artículo.',
  ADJUSTMENT: 'Corrige diferencias de stock. Cantidad positiva suma, negativa resta. Los ajustes grandes requieren aprobación.',
  TRANSFER: 'Mueve mercadería entre depósitos (incluidos los talleres) manteniendo su costo.',
};

function NewStockDoc() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const type = (params.get('tipo') as DocType) || 'ADJUSTMENT';
  const [warehouseId, setWarehouseId] = useState('');
  const [targetWarehouseId, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [gridProduct, setGridProduct] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());

  const addLine = (it: PickedItem, qty = '') =>
    setLines((ls) => {
      const existing = ls.find((l) => l.itemId === it.item_id && !l.lotCode);
      if (existing && qty === '') return ls; // ya está: el usuario ajusta la cantidad
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty } : l));
      return [...ls, { itemId: it.item_id, sku: it.sku, name: it.name, uom: it.uom, available: it.available, qty, unitCost: '', lotCode: '' }];
    });

  const products = useQuery({
    queryKey: ['products', 'all-for-grid'],
    queryFn: () => api.get<{ rows: { id: string; code: string; name: string }[] }>('/catalog/products?pageSize=200'),
  });
  const matrix = useQuery({
    queryKey: ['matrix', gridProduct, warehouseId],
    queryFn: () =>
      api.get<{
        sizes: { id: string; code: string }[];
        colors: { id: string; name: string; hex: string | null }[];
        cells: (GridCell & { sku: string; available: string })[];
        product: { name: string };
      }>(`/catalog/products/${gridProduct}/matrix${qs({ warehouseId })}`),
    enabled: !!gridProduct,
  });
  const gridValues = useMemo(() => Object.fromEntries(lines.map((l) => [l.itemId, l.qty])), [lines]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ id: string; status: string; number: string }>(
        '/inventory/documents',
        {
          type,
          warehouseId,
          targetWarehouseId: type === 'TRANSFER' ? targetWarehouseId : null,
          reason: reason || null,
          notes: notes || null,
          post: true,
          lines: lines
            .filter((l) => l.qty && l.qty !== '0')
            .map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: type === 'OPENING' ? l.unitCost : null, lotCode: l.lotCode || null })),
        },
        { idempotencyKey: idempotencyKey.current },
      ),
    onSuccess: (doc) => {
      toast.success(doc.status === 'PENDING_APPROVAL' ? `${doc.number} quedó pendiente de aprobación.` : `${doc.number} confirmado.`);
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['stock-docs'] });
      qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      router.push(`/stock/documentos/${doc.id}`);
    },
    onError: (e) => {
      // Error de negocio: se puede corregir y reintentar como operación nueva.
      idempotencyKey.current = crypto.randomUUID();
      const fields = e instanceof ApiError ? e.details?.fields?.map((f) => f.message).join(' · ') : '';
      toast.error(fields ? `${e.message} ${fields}` : e.message);
    },
  });

  const perm = type === 'OPENING' ? 'inventory.opening' : type === 'TRANSFER' ? 'inventory.transfer' : 'inventory.adjust';
  if (!md) return <Spinner />;
  if (!can(perm)) return <p className="text-sm text-muted">No tenés permiso para registrar este tipo de movimiento.</p>;
  const warehouses = md.warehouses.filter((w) => w.isActive);
  const validLines = lines.filter((l) => l.qty && l.qty !== '0');

  return (
    <div className="max-w-5xl">
      <PageHeader title={`Nuevo: ${DOC_TYPE_LABELS[type]}`} description={DESCRIPTIONS[type]} />
      <Card className="mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        <Field label={type === 'TRANSFER' ? 'Depósito origen' : 'Depósito'} htmlFor="wh">
          <Select id="wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Elegí un depósito…</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        {type === 'TRANSFER' && (
          <Field label="Depósito destino" htmlFor="target">
            <Select id="target" value={targetWarehouseId} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Elegí el destino…</option>
              {warehouses.filter((w) => w.id !== warehouseId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        )}
        {type === 'ADJUSTMENT' && (
          <Field label="Motivo" htmlFor="reason">
            <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Elegí un motivo…</option>
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Observaciones" htmlFor="notes" className={type === 'OPENING' ? 'sm:col-span-2' : ''}>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Card>

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ItemPicker warehouseId={type === 'OPENING' ? undefined : warehouseId || undefined} onPick={(it) => addLine(it)} />
          <div className="flex items-center gap-2">
            <Grid3x3 className="size-4 text-muted" aria-hidden />
            <Select aria-label="Cargar por grilla" value={gridProduct} onChange={(e) => setGridProduct(e.target.value)}>
              <option value="">Cargar prendas por grilla talle × color…</option>
              {products.data?.rows.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </Select>
          </div>
        </div>
        {gridProduct && matrix.data && (
          <div className="mt-4 rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-medium">{matrix.data.product.name}: cantidades por talle y color (el número gris es el disponible)</p>
            <VariantGrid
              sizes={matrix.data.sizes}
              colors={matrix.data.colors}
              cells={matrix.data.cells}
              values={gridValues}
              hint={(c) => (type === 'OPENING' ? undefined : fmtQty(c.available))}
              onChange={(itemId, v) => {
                const cell = matrix.data!.cells.find((c) => c.itemId === itemId)!;
                if (lines.some((l) => l.itemId === itemId)) setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, qty: v } : l)));
                else addLine({ item_id: itemId, sku: cell.sku, name: `${matrix.data!.product.name} ${cell.sku}`, uom: 'un', available: cell.available, kind: 'VARIANT', on_hand: cell.available }, v);
              }}
            />
          </div>
        )}
      </Card>

      <Card className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Artículo</th>
              {type !== 'OPENING' && <th className="px-3 py-2 text-right">Disponible</th>}
              <th className="px-3 py-2 text-right">Cantidad</th>
              {type === 'OPENING' && <th className="px-3 py-2 text-right">Costo unitario</th>}
              <th className="px-3 py-2 text-left">Lote / partida</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.itemId + i} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  {l.name} <span className="text-muted">· {l.sku}</span>
                </td>
                {type !== 'OPENING' && <td className="num px-3 py-2 text-right text-muted">{fmtQty(l.available)} {l.uom}</td>}
                <td className="px-3 py-2 text-right">
                  <Input
                    className="num ml-auto w-28 text-right"
                    inputMode="decimal"
                    aria-label={`Cantidad ${l.sku}`}
                    value={l.qty}
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.');
                      if (/^-?\d*\.?\d{0,4}$/.test(v)) setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: v } : x)));
                    }}
                  />
                </td>
                {type === 'OPENING' && (
                  <td className="px-3 py-2 text-right">
                    <Input
                      className="num ml-auto w-32 text-right"
                      inputMode="decimal"
                      placeholder="$"
                      aria-label={`Costo ${l.sku}`}
                      value={l.unitCost}
                      onChange={(e) => {
                        const v = e.target.value.replace(',', '.');
                        if (/^\d*\.?\d{0,6}$/.test(v)) setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: v } : x)));
                      }}
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <Input
                    className="w-32"
                    placeholder="Opcional"
                    aria-label={`Lote ${l.sku}`}
                    value={l.lotCode}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, lotCode: e.target.value } : x)))}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar ${l.sku}`} className="text-muted hover:text-danger">
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lines.length && <p className="p-6 text-center text-sm text-muted">Buscá o escaneá artículos, o cargalos por grilla.</p>}
      </Card>

      <div className="flex items-center gap-2">
        <Button
          loading={submit.isPending}
          disabled={!warehouseId || !validLines.length || (type === 'TRANSFER' && !targetWarehouseId) || (type === 'ADJUSTMENT' && !reason)}
          onClick={() => submit.mutate()}
        >
          Confirmar {validLines.length ? `(${validLines.length} líneas)` : ''}
        </Button>
        <Button variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export default function NewStockDocPage() {
  return (
    <Suspense>
      <NewStockDoc />
    </Suspense>
  );
}
