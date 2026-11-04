'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PartyForm, type PartyFormValues } from '@/components/party-form';
import { PageHeader } from '@/components/ui';

function NewParty() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const role = params.get('rol') as 'CUSTOMER' | 'SUPPLIER' | 'WORKSHOP' | null;
  const create = useMutation({
    mutationFn: (v: PartyFormValues) => api.post<{ id: string }>('/parties', clean(v)),
    onSuccess: (p) => {
      toast.success('Guardado.');
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['master-data'] });
      router.push(`/terceros/${p.id}`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Nuevo cliente, proveedor o taller" description="El CUIT se valida con su dígito verificador y no puede repetirse." />
      <PartyForm defaultValues={role ? { roles: [role] } : undefined} onSubmit={(v) => create.mutate(v)} submitting={create.isPending} submitLabel="Guardar" />
    </div>
  );
}

/** El domicilio es opcional: si no se completó la calle, no se envía. */
function clean(v: PartyFormValues): PartyFormValues {
  return { ...v, address: v.address?.street ? v.address : null };
}

export default function NewPartyPage() {
  return (
    <Suspense>
      <NewParty />
    </Suspense>
  );
}
