'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, ScrollText } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { FD_STATUS, fmtDate, fmtFiscal, fmtMoney, isZero } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader, Select } from '@/components/ui';

interface Row {
  id: string;
  docType: string;
  pointOfSale: number;
  number: number | null;
  label: string;
  party?: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  openAmount: string | null;
  status: string;
  arcaMode: string | null;
}

export default function SalesDocumentsPage() {
  const router = useRouter();
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['sales-documents', kind, page],
    queryFn: () => api.get<{ total: number; rows: Row[] }>(`/sales/documents${qs({ kind, page, pageSize: 50 })}`),
  });
  const simulated = data?.rows.some((r) => r.arcaMode === 'SIMULATED');
  const columns: ColumnDef<Row, unknown>[] = [
    { id: 'number', header: 'Comprobante', cell: ({ row }) => <span className="num font-medium">{fmtFiscal(row.original)}</span> },
    { accessorKey: 'party', header: 'Cliente' },
    { accessorKey: 'issueDate', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.issueDate) },
    { accessorKey: 'dueDate', header: 'Vence', cell: ({ row }) => fmtDate(row.original.dueDate) },
    { accessorKey: 'total', header: 'Total', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.total) },
    {
      accessorKey: 'openAmount',
      header: 'Pendiente',
      meta: { align: 'right' },
      cell: ({ row }) => (row.original.openAmount === null ? '—' : <span className={isZero(row.original.openAmount) ? 'text-muted' : 'font-medium'}>{fmtMoney(row.original.openAmount.replace('-', ''))}</span>),
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const [l, t] = FD_STATUS[row.original.status] ?? [row.original.status, 'neutral'];
        return <Badge tone={t}>{l}</Badge>;
      },
    },
  ];
  return (
    <div>
      <PageHeader
        title="Comprobantes de venta"
        description="Facturas, notas de crédito y notas de débito con su autorización de ARCA."
        actions={<Can perm="sales.invoice"><LinkButton href="/ventas/comprobantes/nuevo" tour="comprobantes-facturar-remitos"><Plus className="size-4" /> Facturar remitos</LinkButton></Can>}
      />
      {simulated && (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
          La conexión con ARCA está en modo <strong>simulado</strong>: los CAE son de prueba y los comprobantes no tienen validez fiscal.
        </p>
      )}
      <DataTable
        id="sales-documents"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        onRowClick={(r) => router.push(`/ventas/comprobantes/${r.id}`)}
        toolbar={
          <Select aria-label="Tipo" data-tour="comprobantes-filtro-tipo" className="w-56" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
            <option value="">Todos los tipos</option>
            <option value="F">Facturas</option>
            <option value="NC">Notas de crédito</option>
            <option value="ND">Notas de débito</option>
          </Select>
        }
        empty={<EmptyState icon={<ScrollText className="size-8" />} title="Sin comprobantes" description="Las facturas se emiten a partir de los remitos entregados." />}
      />
    </div>
  );
}
