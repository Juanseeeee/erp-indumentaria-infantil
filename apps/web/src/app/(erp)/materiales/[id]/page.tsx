'use client';

import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { MaterialForm, type MaterialFormValues } from '@/components/material-form';
import { ErrorBox, LinkButton, PageHeader, Spinner } from '@/components/ui';

interface Material {
  itemId: string;
  categoryId: string | null;
  defaultSupplierId: string | null;
  purchaseUomId: string | null;
  fabricWidthCm: string | null;
  composition: string | null;
  weightGsm: string | null;
  colorId: string | null;
  item: { sku: string; name: string; barcode: string | null; baseUomId: string; trackLots: boolean; minStock: string | null; reorderQty: string | null };
}

export default function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data, isLoading, error } = useQuery({ queryKey: ['material', id], queryFn: () => api.get<Material>(`/materials/${id}`) });
  const update = useMutation({
    mutationFn: (v: MaterialFormValues) => api.put(`/materials/${id}`, v),
    onSuccess: () => {
      toast.success('Material actualizado.');
      qc.invalidateQueries({ queryKey: ['material', id] });
      qc.invalidateQueries({ queryKey: ['materials'] });
    },
    onError: (e) => toast.error(e.message),
  });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={data.item.name}
        description={data.item.sku}
        actions={<LinkButton variant="secondary" href={`/stock/${id}`}>Ver stock y kardex</LinkButton>}
      />
      {can('materials.edit') ? (
        <MaterialForm
          defaultValues={{
            sku: data.item.sku,
            name: data.item.name,
            barcode: data.item.barcode,
            baseUomId: data.item.baseUomId,
            trackLots: data.item.trackLots,
            minStock: s(data.item.minStock),
            reorderQty: s(data.item.reorderQty),
            categoryId: data.categoryId,
            defaultSupplierId: data.defaultSupplierId,
            purchaseUomId: data.purchaseUomId,
            fabricWidthCm: s(data.fabricWidthCm),
            composition: data.composition,
            weightGsm: s(data.weightGsm),
            colorId: data.colorId,
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
