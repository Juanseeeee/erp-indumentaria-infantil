'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useMasterData } from '@/lib/session';
import { VariantGrid, type GridCell } from '@/components/variant-grid';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface Matrix {
  product: { name: string };
  sizes: { id: string; code: string }[];
  colors: { id: string; name: string; hex: string | null }[];
  cells: (GridCell & { sku: string; available: string })[];
}

export default function NewProductionOrderPage() {
  const router = useRouter();
  const { data: md } = useMasterData();
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ materialsWarehouseId: '', outputWarehouseId: '', secondsWarehouseId: '', dueDate: '', plannedStart: '', priority: '2', notes: '' });
  const key = useRef(crypto.randomUUID());
  const products = useQuery({
    queryKey: ['products', 'active-all'],
    queryFn: () => api.get<{ rows: { id: string; code: string; name: string }[] }>('/catalog/products?pageSize=200&status=ACTIVE'),
  });
  const matrix = useQuery({ queryKey: ['matrix', productId], queryFn: () => api.get<Matrix>(`/catalog/products/${productId}/matrix`), enabled: !!productId });
  const total = useMemo(() => Object.values(qty).reduce((a, v) => a + (Number(v) || 0), 0), [qty]);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(
        '/production/orders',
        {
          productId,
          ...form,
          secondsWarehouseId: form.secondsWarehouseId || null,
          dueDate: form.dueDate || null,
          plannedStart: form.plannedStart || null,
          priority: Number(form.priority),
          lines: Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([variantItemId, v]) => ({ variantItemId, qty: v })),
        },
        { idempotencyKey: key.current },
      ),
    onSuccess: (o) => {
      toast.success('Orden creada en borrador. Revisala y liberala para reservar materiales.');
      router.push(`/produccion/ordenes/${o.id}`);
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => f.message).join(' · ') : e.message);
    },
  });

  if (!md) return <Spinner />;
  const own = md.warehouses.filter((w) => w.isActive && w.type !== 'WORKSHOP');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="max-w-5xl">
      <PageHeader title="Nueva orden de producción" description="Elegí el modelo y cargá las cantidades por talle y color. Podés pegar desde Excel." />
      <Card className="mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        <Field label="Modelo" htmlFor="product" className="sm:col-span-3">
          <Select id="product" value={productId} onChange={(e) => { setProductId(e.target.value); setQty({}); }}>
            <option value="">Elegí un modelo…</option>
            {products.data?.rows.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </Field>
        <Field label="Materiales desde" htmlFor="mwh">
          <Select id="mwh" value={form.materialsWarehouseId} onChange={set('materialsWarehouseId')}>
            <option value="">Elegí…</option>
            {own.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Ingresa producto terminado a" htmlFor="owh">
          <Select id="owh" value={form.outputWarehouseId} onChange={set('outputWarehouseId')}>
            <option value="">Elegí…</option>
            {own.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Segunda selección a" htmlFor="swh" hint="Opcional">
          <Select id="swh" value={form.secondsWarehouseId} onChange={set('secondsWarehouseId')}>
            <option value="">Sin segunda selección</option>
            {own.filter((w) => w.id !== form.outputWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Inicio previsto" htmlFor="start"><Input id="start" type="date" value={form.plannedStart} onChange={set('plannedStart')} /></Field>
        <Field label="Entrega comprometida" htmlFor="due"><Input id="due" type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Prioridad" htmlFor="prio">
          <Select id="prio" value={form.priority} onChange={set('priority')}>
            <option value="1">Alta</option>
            <option value="2">Normal</option>
            <option value="3">Baja</option>
          </Select>
        </Field>
        <Field label="Observaciones" htmlFor="notes" className="sm:col-span-3"><Textarea id="notes" value={form.notes} onChange={set('notes')} /></Field>
      </Card>
      {productId && (
        <Card className="mb-4 p-4">
          {matrix.data ? (
            <>
              <p className="mb-2 text-sm text-muted">Cantidades a fabricar (en gris, el stock disponible de cada variante).</p>
              <VariantGrid
                sizes={matrix.data.sizes}
                colors={matrix.data.colors}
                cells={matrix.data.cells}
                values={qty}
                hint={(c) => (c as Matrix['cells'][number]).available}
                onChange={(id, v) => setQty((q) => ({ ...q, [id]: v }))}
              />
            </>
          ) : (
            <Spinner />
          )}
        </Card>
      )}
      <div className="flex items-center gap-2">
        <Button
          loading={create.isPending}
          disabled={!productId || !total || !form.materialsWarehouseId || !form.outputWarehouseId}
          onClick={() => create.mutate()}
        >
          Crear orden ({total.toLocaleString('es-AR')} prendas)
        </Button>
        <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
      </div>
    </div>
  );
}
