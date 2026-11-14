'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Barcode, Pencil, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { cn, fmtQty } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { VariantGrid, type GridCell } from '@/components/variant-grid';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui';

interface Matrix {
  product: { id: string; code: string; name: string; status: string; categoryId: string | null; collectionId: string | null; description: string | null; materialText: string | null; version: number };
  sizes: { id: string; code: string }[];
  availableSizes: { id: string; code: string }[];
  colors: { id: string; code: string; name: string; hex: string | null }[];
  cells: (GridCell & { sku: string; barcode: string | null; minStock: string | null; onHand: string; reserved: string; available: string })[];
}

type View = 'available' | 'onHand' | 'reserved' | 'sku' | 'barcode';

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const [warehouseId, setWarehouseId] = useState('');
  const [view, setView] = useState<View>('available');
  const [editMin, setEditMin] = useState(false);
  const [mins, setMins] = useState<Record<string, string>>({});
  const [editHeader, setEditHeader] = useState(false);
  const [addColors, setAddColors] = useState<string[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['matrix', id, warehouseId],
    queryFn: () => api.get<Matrix>(`/catalog/products/${id}/matrix${qs({ warehouseId })}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['matrix', id] });

  const patch = useMutation({
    mutationFn: (updates: { itemId: string; isActive?: boolean; minStock?: string | null }[]) => api.patch(`/catalog/products/${id}/variants`, { updates }),
    onSuccess: () => {
      toast.success('Variantes actualizadas.');
      setEditMin(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: () => api.post<{ variantsCreated: number }>(`/catalog/products/${id}/variants`, { colorIds: addColors, sizeIds: [] }),
    onSuccess: (r) => {
      toast.success(`Se crearon ${r.variantsCreated} variantes.`);
      setAddColors([]);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: (body: object) => api.put(`/catalog/products/${id}`, body),
    onSuccess: () => {
      toast.success('Modelo actualizado.');
      setEditHeader(false);
      refresh();
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const p = data.product;
  const missingColors = md?.colors.filter((c) => c.isActive && !data.colors.some((x) => x.id === c.id)) ?? [];

  const renderCell = (cell: GridCell) => {
    const c = cell as Matrix['cells'][number];
    if (view === 'sku') return <span className="text-xs">{c.sku}</span>;
    if (view === 'barcode') return <span className="text-xs">{c.barcode ?? '—'}</span>;
    const v = c[view];
    const low = view === 'available' && c.minStock && Number(c.available) < Number(c.minStock);
    return (
      <Link href={`/stock/${c.itemId}`} className={cn('hover:underline', v === '0' && 'text-muted', low && 'font-medium text-warning')}>
        {fmtQty(v)}
      </Link>
    );
  };

  return (
    <div>
      <PageHeader
        title={`${p.name}`}
        description={`Modelo ${p.code} · ${data.cells.length} variantes`}
        actions={
          can('catalog.edit') && (
            <Button data-tour="modelo-editar" variant="secondary" onClick={() => setEditHeader((v) => !v)}>
              <Pencil className="size-4" /> Editar datos
            </Button>
          )
        }
      />

      {editHeader && md && (
        <Card className="mb-4 p-4" tour="modelo-editar-form">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              update.mutate({
                name: f.get('name'),
                status: f.get('status'),
                categoryId: f.get('categoryId') || null,
                collectionId: f.get('collectionId') || null,
                description: p.description,
                materialText: f.get('materialText') || null,
                version: p.version,
              });
            }}
          >
            <Field label="Nombre" htmlFor="pname">
              <Input id="pname" name="name" defaultValue={p.name} />
            </Field>
            <Field tour="modelo-editar-estado" label="Estado" htmlFor="pstatus">
              <Select id="pstatus" name="status" defaultValue={p.status}>
                <option value="ACTIVE">Activo</option>
                <option value="DRAFT">Borrador</option>
                <option value="DISCONTINUED">Discontinuado</option>
              </Select>
            </Field>
            <Field label="Categoría" htmlFor="pcat">
              <Select id="pcat" name="categoryId" defaultValue={p.categoryId ?? ''}>
                <option value="">Sin categoría</option>
                {md.categories.filter((c) => c.kind === 'PRODUCT').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Colección" htmlFor="pcol">
              <Select id="pcol" name="collectionId" defaultValue={p.collectionId ?? ''}>
                <option value="">Sin colección</option>
                {md.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Material principal" htmlFor="pmat" className="sm:col-span-2">
              <Input id="pmat" name="materialText" defaultValue={p.materialText ?? ''} />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button data-tour="modelo-guardar" type="submit" loading={update.isPending}>Guardar</Button>
              <Button type="button" variant="secondary" onClick={() => setEditHeader(false)}>Cancelar</Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-muted">Cambiar el nombre actualiza el nombre de las variantes; los SKU y códigos de barras no cambian.</p>
        </Card>
      )}

      <Card className="p-4" tour="modelo-grilla">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tabs
            value={view}
            onChange={(v) => setView(v as View)}
            tabs={[
              { id: 'available', label: 'Disponible' },
              { id: 'onHand', label: 'Físico' },
              { id: 'reserved', label: 'Reservado' },
              { id: 'sku', label: 'SKU', tour: 'modelo-vista-sku' },
              { id: 'barcode', label: 'Código de barras', tour: 'modelo-vista-barras' },
            ]}
          />
          <Select data-tour="modelo-deposito" aria-label="Depósito" className="ml-auto w-56" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Todos los depósitos</option>
            {md?.warehouses.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </div>
        {data.cells.length ? (
          editMin ? (
            <>
              <p className="mb-2 text-sm text-muted">Stock mínimo por variante (dispara la alerta de stock crítico). Podés pegar desde Excel.</p>
              <VariantGrid
                sizes={data.sizes}
                colors={data.colors}
                cells={data.cells}
                values={mins}
                onChange={(itemId, v) => setMins((m) => ({ ...m, [itemId]: v }))}
              />
              <div className="mt-3 flex gap-2">
                <Button
                  data-tour="modelo-guardar-minimos"
                  loading={patch.isPending}
                  onClick={() =>
                    patch.mutate(
                      data.cells
                        .filter((c) => (mins[c.itemId] ?? '') !== (c.minStock ?? ''))
                        .map((c) => ({ itemId: c.itemId, minStock: mins[c.itemId] ? mins[c.itemId] : null })),
                    )
                  }
                >
                  Guardar mínimos
                </Button>
                <Button variant="secondary" onClick={() => setEditMin(false)}>Cancelar</Button>
              </div>
            </>
          ) : (
            <VariantGrid sizes={data.sizes} colors={data.colors} cells={data.cells} renderCell={renderCell} />
          )
        ) : (
          <p className="text-sm text-muted">El modelo no tiene variantes.</p>
        )}
        {!editMin && can('catalog.edit') && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              data-tour="modelo-editar-minimos"
              variant="secondary"
              size="sm"
              onClick={() => {
                setMins(Object.fromEntries(data.cells.map((c) => [c.itemId, c.minStock ?? ''])));
                setEditMin(true);
              }}
            >
              Editar stock mínimo
            </Button>
          </div>
        )}
      </Card>

      {can('catalog.edit') && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4" tour="modelo-variantes-activas">
            <h2 className="mb-2 font-medium">Activar o desactivar variantes</h2>
            <p className="mb-3 text-sm text-muted">Una variante inactiva no se ofrece en pedidos ni producción, pero conserva su historial.</p>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {data.cells.map((c) => (
                <label key={c.itemId} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                  <span className="flex items-center gap-2">
                    <Barcode className="size-3.5 text-muted" aria-hidden />
                    {c.sku}
                  </span>
                  <span className="flex items-center gap-2">
                    {!c.isActive && <Badge>Inactiva</Badge>}
                    <input
                      type="checkbox"
                      checked={c.isActive}
                      disabled={patch.isPending}
                      onChange={(e) => patch.mutate([{ itemId: c.itemId, isActive: e.target.checked }])}
                      aria-label={`Activa ${c.sku}`}
                    />
                  </span>
                </label>
              ))}
            </div>
          </Card>
          <Card className="p-4" tour="modelo-agregar-colores">
            <h2 className="mb-2 font-medium">Agregar colores</h2>
            {missingColors.length ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {missingColors.map((c) => {
                    const sel = addColors.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={sel}
                        onClick={() => setAddColors((a) => (sel ? a.filter((x) => x !== c.id) : [...a, c.id]))}
                        className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm', sel ? 'border-accent bg-accent-soft' : 'border-border')}
                      >
                        <span className="size-3 rounded-full border border-border" style={{ background: c.hex ?? undefined }} aria-hidden />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
                <Button data-tour="modelo-generar-variantes" className="mt-3" size="sm" disabled={!addColors.length} loading={add.isPending} onClick={() => add.mutate()}>
                  <Plus className="size-4" /> Generar {addColors.length * data.sizes.length} variantes
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted">El modelo ya tiene todos los colores configurados.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
