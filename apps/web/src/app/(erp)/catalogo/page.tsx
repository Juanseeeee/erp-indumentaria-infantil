'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Package, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtQty } from '@/lib/format';
import { Can, useMasterData } from '@/lib/session';
import { DataTable, useDebounced } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface ProductRow {
  id: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';
  categoryId: string | null;
  collectionId: string | null;
  variantCount: number;
  onHand: string;
  available: string;
}

const STATUS = { DRAFT: ['Borrador', 'neutral'], ACTIVE: ['Activo', 'success'], DISCONTINUED: ['Discontinuado', 'warning'] } as const;

export default function CatalogPage() {
  const router = useRouter();
  const { data: md } = useMasterData();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const { data, isLoading } = useQuery({
    queryKey: ['products', q, page, categoryId, status],
    queryFn: () =>
      api.get<{ total: number; rows: ProductRow[] }>(`/catalog/products${qs({ q, page, pageSize: 50, categoryId, status, includeInactive: !!status })}`),
  });
  const catName = (id: string | null) => md?.categories.find((c) => c.id === id)?.name ?? '—';
  const colName = (id: string | null) => md?.collections.find((c) => c.id === id)?.name ?? '—';

  const columns: ColumnDef<ProductRow, unknown>[] = [
    { accessorKey: 'code', header: 'Código', cell: ({ row }) => <span className="font-medium">{row.original.code}</span> },
    { accessorKey: 'name', header: 'Modelo' },
    { id: 'category', header: 'Categoría', cell: ({ row }) => catName(row.original.categoryId) },
    { id: 'collection', header: 'Colección', cell: ({ row }) => colName(row.original.collectionId) },
    { accessorKey: 'variantCount', header: 'Variantes', meta: { align: 'right' } },
    { accessorKey: 'onHand', header: 'Físico', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.onHand) },
    { accessorKey: 'available', header: 'Disponible', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.available) },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const [label, tone] = STATUS[row.original.status];
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Modelos"
        description="Cada modelo genera sus variantes de talle y color, con SKU, código de barras y stock propios."
        actions={
          <Can perm="catalog.create">
            <LinkButton href="/catalogo/nuevo">
              <Plus className="size-4" /> Nuevo modelo
            </LinkButton>
          </Can>
        }
      />
      <DataTable
        id="products"
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
        searchPlaceholder="Buscar por código o nombre…"
        loading={isLoading}
        onRowClick={(r) => router.push(`/catalogo/${r.id}`)}
        toolbar={
          <>
            <Select aria-label="Categoría" className="w-44" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas las categorías</option>
              {md?.categories.filter((c) => c.kind === 'PRODUCT').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select aria-label="Estado" className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Activos y borradores</option>
              <option value="ACTIVE">Activos</option>
              <option value="DRAFT">Borradores</option>
              <option value="DISCONTINUED">Discontinuados</option>
            </Select>
          </>
        }
        empty={
          <EmptyState
            icon={<Package className="size-8" />}
            title={q ? 'No hay modelos que coincidan' : 'Todavía no hay modelos'}
            description="Un modelo (por ejemplo, Body manga larga) agrupa todas sus combinaciones de talle y color."
            action={!q && <LinkButton href="/catalogo/nuevo">Crear el primer modelo</LinkButton>}
          />
        }
      />
    </div>
  );
}
