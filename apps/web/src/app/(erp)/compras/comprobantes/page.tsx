'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Receipt } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDocNumber, fmtMoney } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader } from '@/components/ui';

interface Doc {
  id: string;
  docType: string;
  pointOfSale: number;
  number: number;
  party?: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  sourceType: string;
  warnings: string[];
}

export default function SupplierDocsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['supplier-docs', page], queryFn: () => api.get<{ total: number; rows: Doc[] }>(`/purchasing/invoices${qs({ page, pageSize: 50 })}`) });
  const columns: ColumnDef<Doc, unknown>[] = [
    { id: 'n', header: 'Comprobante', cell: ({ row }) => <span className="font-medium">{row.original.docType === 'LIQ' ? `Liquidación interna #${row.original.number}` : fmtDocNumber(row.original.docType, row.original.pointOfSale, row.original.number)}</span> },
    { accessorKey: 'party', header: 'Proveedor / taller' },
    { accessorKey: 'issueDate', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.issueDate) },
    { accessorKey: 'dueDate', header: 'Vence', cell: ({ row }) => fmtDate(row.original.dueDate) },
    { accessorKey: 'total', header: 'Total', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.total) },
    {
      id: 'tags',
      header: '',
      cell: ({ row }) => (
        <span className="flex gap-1">
          {row.original.sourceType === 'WORKSHOP_SETTLEMENT' && <Badge tone="accent">Taller</Badge>}
          {row.original.warnings.length > 0 && <Badge tone="warning">{row.original.warnings.length} diferencias</Badge>}
        </span>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Comprobantes de proveedores"
        description="Cada comprobante genera su movimiento en la cuenta corriente del proveedor. Las diferencias de precio o cantidad contra lo recibido quedan marcadas."
        actions={<Can perm="purchasing.invoice"><LinkButton href="/compras/comprobantes/nuevo" tour="cp-cargar"><Plus className="size-4" /> Cargar comprobante</LinkButton></Can>}
      />
      <DataTable
        id="supplier-docs"
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={isLoading}
        empty={<EmptyState icon={<Receipt className="size-8" />} title="Sin comprobantes" description="Cargá la factura del proveedor a partir de lo que ya recibiste." />}
      />
    </div>
  );
}
