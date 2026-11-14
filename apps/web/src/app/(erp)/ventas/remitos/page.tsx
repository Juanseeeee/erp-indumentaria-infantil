'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Truck } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtFiscal, fmtMoney, fmtQty } from '@/lib/format';
import { DataTable } from '@/components/data-table';
import { Badge, EmptyState, PageHeader, Select } from '@/components/ui';

interface Row {
  id: string;
  number: string;
  customer?: string;
  order: string | null;
  issueDate: string;
  status: string;
  units: string;
  total: string;
  invoice: { docType: string; pointOfSale: number; number: number | null } | null;
}

export default function DeliveriesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', filter, page],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/sales/deliveries${qs({ pendingInvoice: filter === 'pending' || undefined, page, pageSize: 50 })}`),
  });
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'number', header: 'Remito', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'customer', header: 'Cliente' },
    { accessorKey: 'order', header: 'Pedido', cell: ({ row }) => row.original.order ?? '—' },
    { accessorKey: 'issueDate', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.issueDate) },
    { accessorKey: 'units', header: 'Prendas', meta: { align: 'right' }, cell: ({ row }) => fmtQty(row.original.units) },
    { accessorKey: 'total', header: 'A facturar', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.total) },
    {
      id: 'state',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.status === 'VOIDED' ? (
          <Badge tone="danger">Anulado</Badge>
        ) : row.original.invoice ? (
          <Badge tone="success">{fmtFiscal(row.original.invoice)}</Badge>
        ) : (
          <Badge tone="warning">Sin facturar</Badge>
        ),
    },
  ];
  return (
    <div>
      <PageHeader title="Remitos" description="Cada remito descuenta el stock. Se facturan uno por uno o agrupados desde Comprobantes." />
      <DataTable
        id="deliveries"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        onRowClick={(r) => router.push(`/ventas/remitos/${r.id}`)}
        toolbar={
          <Select aria-label="Filtro" data-tour="remitos-filtro" className="w-56" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="pending">Pendientes de facturar</option>
            <option value="all">Todos</option>
          </Select>
        }
        empty={<EmptyState icon={<Truck className="size-8" />} title="Sin remitos" description="Los remitos se emiten desde el pedido, con lo que se entrega." />}
      />
    </div>
  );
}
