'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardList, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, isZero, SO_STATUS } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface Row {
  id: string;
  number: string;
  customer?: string;
  seller: string | null;
  status: string;
  orderDate: string;
  promisedAt: string | null;
  total: string;
  units: string;
  pendingUnits: string;
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders', status, page],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/sales/orders${qs({ status, page, pageSize: 50 })}`),
  });
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'number', header: 'Pedido', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'customer', header: 'Cliente' },
    { accessorKey: 'seller', header: 'Vendedor', cell: ({ row }) => row.original.seller ?? '—' },
    { accessorKey: 'orderDate', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.orderDate) },
    { accessorKey: 'promisedAt', header: 'Entrega', cell: ({ row }) => fmtDate(row.original.promisedAt) },
    { accessorKey: 'units', header: 'Prendas', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.units) },
    {
      accessorKey: 'pendingUnits',
      header: 'Pendientes',
      meta: { align: 'right' },
      cell: ({ row }) => <span className={isZero(row.original.pendingUnits) ? 'text-muted' : 'font-medium'}>{fmtQty(row.original.pendingUnits)}</span>,
    },
    { accessorKey: 'total', header: 'Total', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.total) },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const [l, t] = SO_STATUS[row.original.status] ?? [row.original.status, 'neutral'];
        return <Badge tone={t}>{l}</Badge>;
      },
    },
  ];
  return (
    <div>
      <PageHeader
        title="Pedidos de venta"
        description="Al confirmar un pedido se reserva el stock disponible; lo que falta queda pendiente."
        actions={<Can perm="sales.order"><LinkButton href="/ventas/pedidos/nuevo"><Plus className="size-4" /> Nuevo pedido</LinkButton></Can>}
      />
      <DataTable
        id="sales-orders"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        onRowClick={(r) => router.push(`/ventas/pedidos/${r.id}`)}
        toolbar={
          <Select aria-label="Estado" className="w-56" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="OPEN">Con entregas pendientes</option>
            <option value="DRAFT">Borradores</option>
            <option value="DELIVERED">Entregados</option>
            <option value="CANCELLED">Cancelados</option>
            <option value="">Todos</option>
          </Select>
        }
        empty={<EmptyState icon={<ClipboardList className="size-8" />} title="Sin pedidos" description="Cargá un pedido eligiendo el cliente y las cantidades por talle y color." />}
      />
    </div>
  );
}
