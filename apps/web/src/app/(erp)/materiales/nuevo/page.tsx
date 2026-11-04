'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { MaterialForm, type MaterialFormValues } from '@/components/material-form';
import { PageHeader } from '@/components/ui';

export default function NewMaterialPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (v: MaterialFormValues) => api.post<{ itemId: string }>('/materials', v),
    onSuccess: (m) => {
      toast.success('Material creado.');
      qc.invalidateQueries({ queryKey: ['materials'] });
      router.push(`/materiales/${m.itemId}`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Nuevo material" />
      <MaterialForm
        onSubmit={(v) => create.mutate(v)}
        submitting={create.isPending}
        submitLabel="Crear material"
        serverErrors={create.error instanceof ApiError ? create.error.details?.fields : undefined}
      />
    </div>
  );
}
