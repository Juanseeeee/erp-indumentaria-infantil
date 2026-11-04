'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { MaterialUpsertSchema } from '@erp/contracts';
import { api } from '@/lib/api';
import { useMasterData } from '@/lib/session';
import { Button, Card, Field, Input, Select, Spinner } from './ui';

export type MaterialFormValues = z.input<typeof MaterialUpsertSchema>;

export function MaterialForm({
  defaultValues,
  onSubmit,
  submitting,
  submitLabel,
  serverErrors,
}: {
  defaultValues?: Partial<MaterialFormValues>;
  onSubmit: (v: MaterialFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  serverErrors?: { path: string; message: string }[];
}) {
  const { data: md } = useMasterData();
  const suppliers = useQuery({
    queryKey: ['parties', 'suppliers-select'],
    queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=SUPPLIER&pageSize=200'),
  });
  const form = useForm<MaterialFormValues>({ resolver: zodResolver(MaterialUpsertSchema), defaultValues: { trackLots: false, ...defaultValues } });
  const err = form.formState.errors as Record<string, { message?: string }>;
  const serverErr = (p: string) => serverErrors?.find((e) => e.path === p)?.message;
  const nullable = { setValueAs: (v: string) => (v === '' ? null : v) };

  if (!md) return <Spinner />;
  const baseUomId = form.watch('baseUomId');
  const isFabric = md.uoms.find((u) => u.id === baseUomId)?.dimension === 'LENGTH';

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <Field label="Código" htmlFor="sku" error={err.sku?.message ?? serverErr('sku')} hint="Ej.: TELA-INTERLOCK-BLA">
          <Input id="sku" {...form.register('sku')} />
        </Field>
        <Field label="Descripción" htmlFor="name" error={err.name?.message}>
          <Input id="name" {...form.register('name')} />
        </Field>
        <Field label="Categoría" htmlFor="cat">
          <Select id="cat" {...form.register('categoryId', nullable)}>
            <option value="">Sin categoría</option>
            {md.categories.filter((c) => c.kind === 'MATERIAL').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Proveedor habitual" htmlFor="sup">
          <Select id="sup" {...form.register('defaultSupplierId', nullable)}>
            <option value="">Sin proveedor habitual</option>
            {suppliers.data?.rows.map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
          </Select>
        </Field>
        <Field label="Unidad de stock" htmlFor="uom" error={err.baseUomId?.message} hint="En esta unidad se lleva el stock y el costo.">
          <Select id="uom" {...form.register('baseUomId')}>
            <option value="">Elegí…</option>
            {md.uoms.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
          </Select>
        </Field>
        <Field label="Unidad de compra" htmlFor="puom" hint="Opcional. Ej.: compra por rollo, stock en metros (requiere conversión).">
          <Select id="puom" {...form.register('purchaseUomId', nullable)}>
            <option value="">Igual a la de stock</option>
            {md.uoms.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
          </Select>
        </Field>
        <Field label="Stock mínimo" htmlFor="min" error={err.minStock?.message}>
          <Input id="min" inputMode="decimal" {...form.register('minStock', nullable)} />
        </Field>
        <Field label="Cantidad de reposición sugerida" htmlFor="reorder" error={err.reorderQty?.message}>
          <Input id="reorder" inputMode="decimal" {...form.register('reorderQty', nullable)} />
        </Field>
        <Field label="Código de barras" htmlFor="barcode">
          <Input id="barcode" {...form.register('barcode', nullable)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" {...form.register('trackLots')} /> Controlar por lote / partida (recomendado en telas)
        </label>
      </Card>
      {isFabric && (
        <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-4">
          <p className="text-sm font-medium sm:col-span-4">Datos de tela (opcionales)</p>
          <Field label="Ancho (cm)" htmlFor="width">
            <Input id="width" inputMode="decimal" {...form.register('fabricWidthCm', nullable)} />
          </Field>
          <Field label="Gramaje (g/m²)" htmlFor="gsm">
            <Input id="gsm" inputMode="decimal" {...form.register('weightGsm', nullable)} />
          </Field>
          <Field label="Composición" htmlFor="comp">
            <Input id="comp" {...form.register('composition')} placeholder="100% algodón" />
          </Field>
          <Field label="Color" htmlFor="color">
            <Select id="color" {...form.register('colorId', nullable)}>
              <option value="">—</option>
              {md.colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </Card>
      )}
      <div>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
