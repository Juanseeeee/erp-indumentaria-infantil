'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { HandCoins, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, isZero } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader } from '@/components/ui';

interface Row {
  id: string;
  number: string;
  customer?: string;
  date: string;
  total: string;
  methods: string;
  unapplied: string;
  status: string;
}

export default function ReceiptsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['receipts', page],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/sales/receipts${qs({ page, pageSize: 50 })}`),
  });
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'number', header: 'Recibo', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'customer', header: 'Cliente' },
    { accessorKey: 'date', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.date) },
    { accessorKey: 'methods', header: 'Medios' },
    { accessorKey: 'total', header: 'Importe', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.total) },
    {
      accessorKey: 'unapplied',
      header: 'Sin imputar',
      meta: { align: 'right' },
      cell: ({ row }) => <span className={isZero(row.original.unapplied) ? 'text-muted' : 'text-warning'}>{fmtMoney(row.original.unapplied)}</span>,
    },
    { accessorKey: 'status', header: 'Estado', cell: ({ row }) => (row.original.status === 'VOIDED' ? <Badge tone="danger">Anulado</Badge> : <Badge tone="success">Registrado</Badge>) },
  ];
  return (
    <div>
      <PageHeader
        title="Cobros"
        description="Recibos de clientes. Cada cobro imputado a una factura devenga la comisión del vendedor."
        actions={<Can perm="receivables.collect"><LinkButton href="/cobros/nuevo" tour="cobros-nuevo"><Plus className="size-4" /> Nuevo cobro</LinkButton></Can>}
      />
      <DataTable
        id="receipts"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        onRowClick={(r) => router.push(`/cobros/${r.id}`)}
        empty={<EmptyState icon={<HandCoins className="size-8" />} title="Sin cobros" description="Registrá un cobro e imputalo a las facturas del cliente." />}
      />
    </div>
  );
}
