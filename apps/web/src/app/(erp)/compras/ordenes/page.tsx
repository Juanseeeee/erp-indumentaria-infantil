'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, ShoppingCart } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, PO_STATUS } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface Row {
  id: string;
  number: string;
  supplier?: string;
  status: string;
  date: string;
  expectedAt: string | null;
  netTotal: string;
  _count: { lines: number };
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', status, page],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/purchasing/orders${qs({ status, page, pageSize: 50 })}`),
  });
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'number', header: 'Número', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'supplier', header: 'Proveedor' },
    { accessorKey: 'date', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.date) },
    { accessorKey: 'expectedAt', header: 'Entrega esperada', cell: ({ row }) => fmtDate(row.original.expectedAt) },
    { accessorKey: 'netTotal', header: 'Neto', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.netTotal) },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const [l, t] = PO_STATUS[row.original.status] ?? [row.original.status, 'neutral'];
        return <Badge tone={t}>{l}</Badge>;
      },
    },
  ];
  return (
    <div>
      <PageHeader
        title="Órdenes de compra"
        description="Una orden de compra no mueve stock: el stock entra con la recepción."
        actions={<Can perm="purchasing.order"><LinkButton href="/compras/ordenes/nueva" tour="oc-nueva"><Plus className="size-4" /> Nueva orden</LinkButton></Can>}
      />
      <DataTable
        id="purchase-orders"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        onRowClick={(r) => router.push(`/compras/ordenes/${r.id}`)}
        toolbar={
          <Select data-tour="oc-filtro-estado" aria-label="Estado" className="w-56" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="PENDING">Pendientes de recibir</option>
            <option value="DRAFT">Pendientes de aprobación</option>
            <option value="RECEIVED">Recibidas</option>
            <option value="">Todas</option>
          </Select>
        }
        empty={<EmptyState icon={<ShoppingCart className="size-8" />} title="Sin órdenes de compra" description="Creá una orden directamente o desde las solicitudes generadas por producción." />}
      />
    </div>
  );
}
