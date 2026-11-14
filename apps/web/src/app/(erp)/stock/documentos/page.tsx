'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { DOC_STATUS_LABELS, DOC_TYPE_LABELS, fmtDateTime, fmtMoney, statusTone } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface Doc {
  id: string;
  number: string;
  type: string;
  status: string;
  warehouseId: string;
  targetWarehouseId: string | null;
  reason: string | null;
  totalValue: string;
  createdAt: string;
  _count: { lines: number };
}

export default function StockDocsPage() {
  const router = useRouter();
  const can = useCan();
  const { data: md } = useMasterData();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['stock-docs', page, type],
    queryFn: () => api.get<{ total: number; rows: Doc[] }>(`/inventory/documents${qs({ page, pageSize: 50, type })}`),
  });
  const wh = (id: string | null) => md?.warehouses.find((w) => w.id === id)?.name ?? '';

  const columns: ColumnDef<Doc, unknown>[] = [
    { accessorKey: 'number', header: 'Número', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'type', header: 'Tipo', cell: ({ row }) => DOC_TYPE_LABELS[row.original.type] },
    {
      id: 'wh',
      header: 'Depósito',
      cell: ({ row }) => (row.original.targetWarehouseId ? `${wh(row.original.warehouseId)} → ${wh(row.original.targetWarehouseId)}` : wh(row.original.warehouseId)),
    },
    { accessorKey: 'reason', header: 'Motivo', cell: ({ row }) => row.original.reason ?? '—' },
    { id: 'lines', header: 'Líneas', meta: { align: 'right' }, cell: ({ row }) => row.original._count.lines },
    ...(can('costs.view')
      ? [{ accessorKey: 'totalValue', header: 'Valor', meta: { align: 'right' }, cell: ({ row }: { row: { original: Doc } }) => fmtMoney(row.original.totalValue) } as ColumnDef<Doc, unknown>]
      : []),
    { accessorKey: 'status', header: 'Estado', cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{DOC_STATUS_LABELS[row.original.status]}</Badge> },
    { accessorKey: 'createdAt', header: 'Fecha', cell: ({ row }) => fmtDateTime(row.original.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Movimientos de stock"
        description="Cargas iniciales, ajustes y transferencias. Nada se borra: una anulación genera movimientos de reversa."
        actions={
          <>
            {can('inventory.opening') && <LinkButton variant="secondary" href="/stock/documentos/nuevo?tipo=OPENING" tour="stockdocs-stock-inicial">Stock inicial</LinkButton>}
            {can('inventory.transfer') && <LinkButton variant="secondary" href="/stock/documentos/nuevo?tipo=TRANSFER" tour="stockdocs-transferencia">Transferencia</LinkButton>}
            {can('inventory.adjust') && <LinkButton href="/stock/documentos/nuevo?tipo=ADJUSTMENT" tour="stockdocs-ajuste">Ajuste</LinkButton>}
          </>
        }
      />
      <DataTable
        id="stock-docs"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        onRowClick={(r) => router.push(`/stock/documentos/${r.id}`)}
        toolbar={
          <Select data-tour="stockdocs-tipo" aria-label="Tipo" className="w-44" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">Todos los tipos</option>
            <option value="OPENING">Stock inicial</option>
            <option value="ADJUSTMENT">Ajustes</option>
            <option value="TRANSFER">Transferencias</option>
          </Select>
        }
        empty={<EmptyState icon={<ArrowLeftRight className="size-8" />} title="Todavía no hay movimientos" description="Empezá cargando el stock inicial de cada depósito." />}
      />
    </div>
  );
}
