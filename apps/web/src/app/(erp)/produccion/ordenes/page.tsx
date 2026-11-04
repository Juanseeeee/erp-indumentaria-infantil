'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Hammer, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtQty, PRIORITY, PROD_STATUS } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable, useDebounced } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface Row {
  id: string;
  number: string;
  status: string;
  priority: number;
  dueDate: string | null;
  product?: { code: string; name: string };
  planned: string;
  done: string;
  overdue: boolean;
}

export default function ProductionOrdersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, isLoading } = useQuery({
    queryKey: ['production-orders', q, status, page],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/production/orders${qs({ q, status, page, pageSize: 50 })}`),
  });

  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'number', header: 'Orden', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { id: 'product', header: 'Modelo', cell: ({ row }) => row.original.product?.name },
    {
      id: 'progress',
      header: 'Avance',
      cell: ({ row }) => {
        const pct = Number(row.original.planned) ? Math.min(100, Math.round((Number(row.original.done) / Number(row.original.planned)) * 100)) : 0;
        return (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
            <span className="num text-xs text-muted">
              {fmtQty(row.original.done)} / {fmtQty(row.original.planned)}
            </span>
          </span>
        );
      },
    },
    { accessorKey: 'priority', header: 'Prioridad', cell: ({ row }) => (row.original.priority === 1 ? <Badge tone="danger">Alta</Badge> : PRIORITY[row.original.priority]) },
    {
      accessorKey: 'dueDate',
      header: 'Entrega',
      cell: ({ row }) => <span className={row.original.overdue ? 'font-medium text-danger' : ''}>{fmtDate(row.original.dueDate)}{row.original.overdue && ' · atrasada'}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const [label, tone] = PROD_STATUS[row.original.status] ?? [row.original.status, 'neutral'];
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Órdenes de producción"
        description="Cada orden congela su ficha técnica al liberarse: reserva materiales, sigue sus etapas y termina con el costo real."
        actions={
          <Can perm="production.plan">
            <LinkButton href="/produccion/ordenes/nueva">
              <Plus className="size-4" /> Nueva orden
            </LinkButton>
          </Can>
        }
      />
      <DataTable
        id="production-orders"
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
        searchPlaceholder="Número de orden…"
        loading={isLoading}
        onRowClick={(r) => router.push(`/produccion/ordenes/${r.id}`)}
        toolbar={
          <Select aria-label="Estado" className="w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="ACTIVE">Activas</option>
            <option value="DRAFT">Borradores</option>
            <option value="CLOSED">Cerradas</option>
            <option value="CANCELLED">Canceladas</option>
            <option value="">Todas</option>
          </Select>
        }
        empty={<EmptyState icon={<Hammer className="size-8" />} title="Sin órdenes" description="Creá una orden eligiendo el modelo y las cantidades por talle y color." />}
      />
    </div>
  );
}
