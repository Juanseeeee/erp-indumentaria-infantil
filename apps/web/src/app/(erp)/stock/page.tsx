'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Boxes, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtMoney, fmtQty, isNegative, isZero } from '@/lib/format';
import { Can, useCan, useMasterData } from '@/lib/session';
import { DataTable, useDebounced } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface Row {
  item_id: string;
  sku: string;
  name: string;
  kind: string;
  uom: string;
  min_stock: string | null;
  on_hand: string;
  reserved: string;
  available: string;
  value: string | null;
  critical: boolean;
}

function StockList() {
  const router = useRouter();
  const params = useSearchParams();
  const can = useCan();
  const { data: md } = useMasterData();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [warehouseId, setWarehouseId] = useState(params.get('deposito') ?? '');
  const [kind, setKind] = useState('');
  const [onlyCritical, setOnlyCritical] = useState(params.get('critico') === '1');
  const q = useDebounced(search);
  const { data, isLoading } = useQuery({
    queryKey: ['stock', q, page, warehouseId, kind, onlyCritical],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/inventory/stock${qs({ q, page, pageSize: 50, warehouseId, kind, onlyCritical })}`),
  });

  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'sku', header: 'SKU', cell: ({ row }) => <span className="font-medium">{row.original.sku}</span> },
    { accessorKey: 'name', header: 'Artículo' },
    { accessorKey: 'kind', header: 'Tipo', cell: ({ row }) => (row.original.kind === 'MATERIAL' ? 'Material' : 'Prenda') },
    { accessorKey: 'on_hand', header: 'Físico', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.on_hand) },
    { accessorKey: 'reserved', header: 'Reservado', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.reserved) },
    {
      accessorKey: 'available',
      header: 'Disponible',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={isNegative(row.original.available) ? 'text-danger' : row.original.critical ? 'font-medium text-warning' : isZero(row.original.available) ? 'text-muted' : ''}>
          {fmtQty(row.original.available)}
        </span>
      ),
    },
    { accessorKey: 'uom', header: 'Unidad' },
    { accessorKey: 'min_stock', header: 'Mínimo', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.min_stock) },
    ...(can('costs.view')
      ? [{ accessorKey: 'value', header: 'Valorizado', meta: { align: 'right' }, cell: ({ row }: { row: { original: Row } }) => fmtMoney(row.original.value) } as ColumnDef<Row, unknown>]
      : []),
    { id: 'estado', header: 'Estado', cell: ({ row }) => (row.original.critical ? <Badge tone="warning">Crítico</Badge> : null) },
  ];

  return (
    <div>
      <PageHeader
        title="Stock"
        description="Físico, reservado y disponible por artículo. Cada cambio queda registrado como un movimiento."
        actions={
          <>
            <Can perm="inventory.transfer">
              <LinkButton variant="secondary" href="/stock/documentos/nuevo?tipo=TRANSFER">Transferir</LinkButton>
            </Can>
            <Can perm="inventory.adjust">
              <LinkButton href="/stock/documentos/nuevo?tipo=ADJUSTMENT">
                <Plus className="size-4" /> Ajuste
              </LinkButton>
            </Can>
          </>
        }
      />
      <DataTable
        id="stock"
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
        searchPlaceholder="SKU, nombre o código de barras…"
        loading={isLoading}
        onRowClick={(r) => router.push(`/stock/${r.item_id}`)}
        toolbar={
          <>
            <Select aria-label="Depósito" className="w-52" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}>
              <option value="">Todos los depósitos</option>
              {md?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select aria-label="Tipo" className="w-36" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
              <option value="">Todo</option>
              <option value="VARIANT">Prendas</option>
              <option value="MATERIAL">Materiales</option>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyCritical} onChange={(e) => { setOnlyCritical(e.target.checked); setPage(1); }} />
              Solo crítico
            </label>
          </>
        }
        empty={<EmptyState icon={<Boxes className="size-8" />} title="Sin resultados" description="Probá con otro filtro o buscá por código de barras." />}
      />
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense>
      <StockList />
    </Suspense>
  );
}
