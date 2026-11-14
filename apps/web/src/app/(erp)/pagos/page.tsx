'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Banknote, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, isZero } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { PaymentStatus } from './status';

interface Row {
  id: string;
  number: string;
  supplier?: string;
  date: string;
  total: string;
  methods: string;
  unapplied: string;
  status: string;
}

export default function PaymentsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [onlyPending, setOnlyPending] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['supplier-payments', page, onlyPending],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/treasury/payments${qs({ page, pageSize: 50, status: onlyPending ? 'PENDING_APPROVAL' : undefined })}`),
  });
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'number', header: 'Orden de pago', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'supplier', header: 'Proveedor' },
    { accessorKey: 'date', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.date) },
    { accessorKey: 'methods', header: 'Medios' },
    { accessorKey: 'total', header: 'Importe', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.total) },
    {
      accessorKey: 'unapplied',
      header: 'Sin imputar',
      meta: { align: 'right' },
      cell: ({ row }) => <span className={isZero(row.original.unapplied) ? 'text-muted' : 'text-warning'}>{fmtMoney(row.original.unapplied)}</span>,
    },
    { accessorKey: 'status', header: 'Estado', cell: ({ row }) => <PaymentStatus status={row.original.status} /> },
  ];
  return (
    <div>
      <PageHeader
        title="Pagos"
        description="Órdenes de pago a proveedores y talleres. Lo no imputado queda como anticipo."
        actions={<Can perm="payables.pay"><LinkButton href="/pagos/nuevo" tour="op-nueva"><Plus className="size-4" /> Nueva orden de pago</LinkButton></Can>}
      />
      <label data-tour="op-solo-pendientes" className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyPending} onChange={(e) => { setOnlyPending(e.target.checked); setPage(1); }} />
        Solo pendientes de aprobación
      </label>
      <DataTable
        id="supplier-payments"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        onRowClick={(r) => router.push(`/pagos/${r.id}`)}
        empty={<EmptyState icon={<Banknote className="size-8" />} title="Sin pagos" description="Registrá una orden de pago e imputala a las facturas del proveedor." />}
      />
    </div>
  );
}
