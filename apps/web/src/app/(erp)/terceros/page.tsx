'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Users } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { PARTY_ROLE_LABELS, TAX_CONDITION_LABELS } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable, useDebounced } from '@/components/data-table';
import { Badge, EmptyState, LinkButton, PageHeader } from '@/components/ui';

interface PartyRow {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  taxIdType: string;
  taxId: string;
  taxCondition: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  roles: string[];
}

const TITLES: Record<string, [string, string]> = {
  CUSTOMER: ['Clientes', 'Clientes mayoristas y minoristas.'],
  SUPPLIER: ['Proveedores', 'Proveedores de telas, avíos, insumos y servicios.'],
  WORKSHOP: ['Talleres', 'Talleres externos de confección. Cada uno tiene un depósito virtual con lo que está en su poder.'],
};

const formatCuit = (t: string, id: string) => (t === 'CUIT' || t === 'CUIL') && id.length === 11 ? `${id.slice(0, 2)}-${id.slice(2, 10)}-${id.slice(10)}` : id;

function PartiesList() {
  const router = useRouter();
  const params = useSearchParams();
  const role = params.get('rol') ?? '';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);
  const q = useDebounced(search);
  useEffect(() => setPage(1), [role]);
  const { data, isLoading } = useQuery({
    queryKey: ['parties', role, q, page, includeInactive],
    queryFn: () => api.get<{ total: number; rows: PartyRow[] }>(`/parties${qs({ role, q, page, pageSize: 50, includeInactive })}`),
  });
  const [title, desc] = TITLES[role] ?? ['Terceros', 'Clientes, proveedores y talleres.'];

  const columns: ColumnDef<PartyRow, unknown>[] = [
    { accessorKey: 'code', header: 'Código' },
    {
      accessorKey: 'legalName',
      header: 'Razón social',
      cell: ({ row }) => (
        <span>
          <span className="font-medium">{row.original.legalName}</span>
          {row.original.tradeName && <span className="text-muted"> · {row.original.tradeName}</span>}
        </span>
      ),
    },
    { id: 'taxId', header: 'CUIT / DNI', cell: ({ row }) => <span className="num">{formatCuit(row.original.taxIdType, row.original.taxId)}</span> },
    { accessorKey: 'taxCondition', header: 'Condición', cell: ({ row }) => TAX_CONDITION_LABELS[row.original.taxCondition] },
    { accessorKey: 'phone', header: 'Teléfono', cell: ({ row }) => row.original.phone ?? '—' },
    { accessorKey: 'email', header: 'Email', cell: ({ row }) => row.original.email ?? '—' },
    {
      id: 'roles',
      header: 'Rol',
      cell: ({ row }) => (
        <span className="flex gap-1">
          {row.original.roles.map((r) => <Badge key={r} tone="accent">{PARTY_ROLE_LABELS[r]}</Badge>)}
          {!row.original.isActive && <Badge>Inactivo</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        description={desc}
        actions={
          <Can perm="parties.create">
            <LinkButton href={`/terceros/nuevo${role ? `?rol=${role}` : ''}`} tour="terceros-nuevo">
              <Plus className="size-4" /> Nuevo
            </LinkButton>
          </Can>
        }
      />
      <DataTable
        id={`parties-${role || 'all'}`}
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
        searchPlaceholder="Razón social, CUIT o código…"
        loading={isLoading}
        onRowClick={(r) => router.push(`/terceros/${r.id}`)}
        toolbar={
          <label data-tour="terceros-inactivos" className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Incluir inactivos
          </label>
        }
        empty={<EmptyState icon={<Users className="size-8" />} title="Sin resultados" description="Probá con otra búsqueda o cargá uno nuevo." />}
      />
    </div>
  );
}

export default function PartiesPage() {
  return (
    <Suspense>
      <PartiesList />
    </Suspense>
  );
}
