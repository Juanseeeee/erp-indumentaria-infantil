'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Scissors } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtMoney, fmtQty } from '@/lib/format';
import { Can, useCan, useMasterData } from '@/lib/session';
import { DataTable, useDebounced } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface MaterialRow {
  itemId: string;
  categoryId: string | null;
  composition: string | null;
  fabricWidthCm: string | null;
  lastCost: string | null;
  item: { sku: string; name: string; baseUomId: string; minStock: string | null; trackLots: boolean; isActive: boolean };
}

export default function MaterialsPage() {
  const router = useRouter();
  const can = useCan();
  const { data: md } = useMasterData();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState('');
  const q = useDebounced(search);
  const { data, isLoading } = useQuery({
    queryKey: ['materials', q, page, categoryId],
    queryFn: () => api.get<{ total: number; rows: MaterialRow[] }>(`/materials${qs({ q, page, pageSize: 50, categoryId })}`),
  });
  const uom = (id: string) => md?.uoms.find((u) => u.id === id)?.code ?? '';

  const columns: ColumnDef<MaterialRow, unknown>[] = [
    { id: 'sku', header: 'Código', cell: ({ row }) => <span className="font-medium">{row.original.item.sku}</span> },
    { id: 'name', header: 'Descripción', cell: ({ row }) => row.original.item.name },
    { id: 'cat', header: 'Categoría', cell: ({ row }) => md?.categories.find((c) => c.id === row.original.categoryId)?.name ?? '—' },
    { id: 'uom', header: 'Unidad', cell: ({ row }) => uom(row.original.item.baseUomId) },
    { id: 'min', header: 'Mínimo', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.item.minStock) },
    { id: 'lots', header: 'Lotes', cell: ({ row }) => (row.original.item.trackLots ? <Badge tone="accent">Por partida</Badge> : null) },
    ...(can('costs.view')
      ? [{ id: 'cost', header: 'Último costo', meta: { align: 'right' }, cell: ({ row }: { row: { original: MaterialRow } }) => fmtMoney(row.original.lastCost) } as ColumnDef<MaterialRow, unknown>]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Materias primas e insumos"
        description="Telas, hilos, avíos y packaging. El stock y el kardex se consultan desde Stock."
        actions={
          <Can perm="materials.create">
            <LinkButton href="/materiales/nuevo" tour="materiales-nuevo">
              <Plus className="size-4" /> Nuevo material
            </LinkButton>
          </Can>
        }
      />
      <DataTable
        id="materials"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        loading={isLoading}
        onRowClick={(r) => router.push(`/materiales/${r.itemId}`)}
        toolbar={
          <Select data-tour="materiales-filtro-categoria" aria-label="Categoría" className="w-44" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas las categorías</option>
            {md?.categories.filter((c) => c.kind === 'MATERIAL').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        }
        empty={<EmptyState icon={<Scissors className="size-8" />} title="Sin materiales" description="Cargá telas, avíos e insumos para controlar su stock y usarlos en fichas técnicas." />}
      />
    </div>
  );
}
