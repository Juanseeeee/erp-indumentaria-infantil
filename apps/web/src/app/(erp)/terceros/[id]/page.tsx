'use client';

import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { PARTY_ROLE_LABELS } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { PartyForm, type PartyFormValues } from '@/components/party-form';
import { Badge, Button, ErrorBox, PageHeader, Spinner } from '@/components/ui';

interface Party {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  taxIdType: 'CUIT' | 'CUIL' | 'DNI' | 'OTHER';
  taxId: string;
  taxCondition: 'RI' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL' | 'NO_ALCANZADO';
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  version: number;
  roles: ('CUSTOMER' | 'SUPPLIER' | 'WORKSHOP')[];
  addresses: { type: string; street: string; city: string | null; province: string | null; zip: string | null }[];
  customerProfile: { paymentTermId: string | null; zoneId: string | null; priceListId: string | null; sellerUserId: string | null; creditLimit?: string | null; discountPct?: string } | null;
}

export default function PartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const { data, isLoading, error } = useQuery({ queryKey: ['party', id], queryFn: () => api.get<Party>(`/parties/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['party', id] });
    qc.invalidateQueries({ queryKey: ['parties'] });
  };
  const update = useMutation({
    mutationFn: (v: PartyFormValues) => api.put(`/parties/${id}`, { ...v, address: v.address?.street ? v.address : null, version: data?.version }),
    onSuccess: () => {
      toast.success('Cambios guardados.');
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.code === 'CONFLICTO_VERSION' ? `${e.message}` : e.message),
  });
  const toggle = useMutation({
    mutationFn: () => api.post(`/parties/${id}/${data?.isActive ? 'deactivate' : 'activate'}`),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const fiscal = data.addresses.find((a) => a.type === 'FISCAL');
  const workshopWh = md?.warehouses.find((w) => w.partyId === id);

  return (
    <div className="max-w-3xl">
      <PageHeader
        tour="tercero-encabezado"
        title={data.legalName}
        description={`${data.code} · ${data.roles.map((r) => PARTY_ROLE_LABELS[r]).join(', ')}`}
        actions={
          <>
            {!data.isActive && <Badge>Inactivo</Badge>}
            {can('parties.edit') && (
              <Button data-tour="tercero-activar" variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate()}>
                {data.isActive ? 'Desactivar' : 'Reactivar'}
              </Button>
            )}
          </>
        }
      />
      {workshopWh && (
        <p data-tour="tercero-deposito-taller" className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm">
          Depósito del taller: <strong>{workshopWh.name}</strong>.{' '}
          <Link className="text-accent underline" href={`/stock?deposito=${workshopWh.id}`}>Ver lo que tiene en su poder</Link>
        </p>
      )}
      {can('parties.edit') ? (
        <PartyForm
          key={data.version}
          defaultValues={{
            legalName: data.legalName,
            tradeName: data.tradeName,
            taxIdType: data.taxIdType,
            taxId: data.taxId,
            taxCondition: data.taxCondition,
            email: data.email,
            phone: data.phone,
            notes: data.notes,
            roles: data.roles,
            address: fiscal ? { street: fiscal.street, city: fiscal.city, province: fiscal.province, zip: fiscal.zip } : undefined,
            customer: data.customerProfile
              ? {
                  paymentTermId: data.customerProfile.paymentTermId,
                  zoneId: data.customerProfile.zoneId,
                  priceListId: data.customerProfile.priceListId,
                  sellerUserId: data.customerProfile.sellerUserId,
                  creditLimit: data.customerProfile.creditLimit ?? null,
                  discountPct: data.customerProfile.discountPct ?? '0',
                }
              : undefined,
          }}
          onSubmit={(v) => update.mutate(v)}
          submitting={update.isPending}
          submitLabel="Guardar cambios"
        />
      ) : (
        <p className="text-sm text-muted">Solo lectura.</p>
      )}
    </div>
  );
}
