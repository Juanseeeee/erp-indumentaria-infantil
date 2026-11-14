'use client';

import { useRouter } from 'next/navigation';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { ProductCreateSchema } from '@erp/contracts';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/format';
import { useMasterData } from '@/lib/session';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

type FormValues = z.input<typeof ProductCreateSchema>;

export default function NewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: md } = useMasterData();
  const form = useForm<FormValues>({
    resolver: zodResolver(ProductCreateSchema),
    defaultValues: { colorIds: [], status: 'ACTIVE', code: '', name: '' },
  });
  const scaleId = useWatch({ control: form.control, name: 'sizeScaleId' });
  const colorIds = useWatch({ control: form.control, name: 'colorIds' }) ?? [];
  const sizeIds = useWatch({ control: form.control, name: 'sizeIds' });
  const scale = md?.sizeScales.find((s) => s.id === scaleId);
  const sizesSelected = sizeIds?.length ? sizeIds.length : (scale?.sizes.length ?? 0);

  const create = useMutation({
    mutationFn: (v: FormValues) => api.post<{ id: string; variantsCreated: number }>('/catalog/products', v),
    onSuccess: (r) => {
      toast.success(`Modelo creado con ${r.variantsCreated} variantes.`);
      qc.invalidateQueries({ queryKey: ['products'] });
      router.push(`/catalogo/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError) e.details?.fields?.forEach((f) => form.setError(f.path as keyof FormValues, { message: f.message }));
      toast.error(e.message);
    },
  });

  if (!md) return <Spinner />;
  const err = form.formState.errors;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Nuevo modelo" description="Al guardar se generan automáticamente todas las combinaciones de talle y color." />
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="flex flex-col gap-4" noValidate>
        <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <Field tour="modelo-codigo" label="Código del modelo" htmlFor="code" error={err.code?.message} hint="Se usa como prefijo del SKU. Ej.: BODY-ML">
            <Input id="code" autoFocus {...form.register('code')} onChange={(e) => form.setValue('code', e.target.value.toUpperCase())} />
          </Field>
          <Field tour="modelo-nombre" label="Nombre comercial" htmlFor="name" error={err.name?.message}>
            <Input id="name" {...form.register('name')} placeholder="Body manga larga" />
          </Field>
          <Field tour="modelo-categoria" label="Categoría" htmlFor="cat">
            <Select id="cat" {...form.register('categoryId', { setValueAs: (v) => v || null })}>
              <option value="">Sin categoría</option>
              {md.categories.filter((c) => c.kind === 'PRODUCT').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field tour="modelo-coleccion" label="Colección" htmlFor="col">
            <Select id="col" {...form.register('collectionId', { setValueAs: (v) => v || null })}>
              <option value="">Sin colección</option>
              {md.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {md.seasons.find((s) => s.id === c.seasonId)?.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field tour="modelo-material" label="Material principal" htmlFor="mat" hint="Descriptivo. La ficha técnica se arma en Producción.">
            <Input id="mat" {...form.register('materialText')} placeholder="Interlock 100% algodón" />
          </Field>
          <Field tour="modelo-estado" label="Estado" htmlFor="status">
            <Select id="status" {...form.register('status')}>
              <option value="ACTIVE">Activo</option>
              <option value="DRAFT">Borrador</option>
            </Select>
          </Field>
          <Field label="Descripción" htmlFor="desc" className="sm:col-span-2">
            <Textarea id="desc" {...form.register('description')} />
          </Field>
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <Field tour="modelo-escala" label="Escala de talles" htmlFor="scale" error={err.sizeScaleId?.message}>
            <Select id="scale" {...form.register('sizeScaleId', { onChange: () => form.setValue('sizeIds', undefined) })}>
              <option value="">Elegí una escala…</option>
              {md.sizeScales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.sizes.map((x) => x.code).join(', ')})
                </option>
              ))}
            </Select>
          </Field>
          {scale && (
            <Controller
              control={form.control}
              name="sizeIds"
              render={({ field }) => (
                <fieldset data-tour="modelo-talles">
                  <legend className="mb-2 text-sm font-medium">Talles a generar</legend>
                  <div className="flex flex-wrap gap-2">
                    {scale.sizes.map((s) => {
                      const selected = !field.value?.length || field.value.includes(s.id);
                      return (
                        <button
                          type="button"
                          key={s.id}
                          aria-pressed={selected}
                          onClick={() => {
                            const all = field.value?.length ? field.value : scale.sizes.map((x) => x.id);
                            const next = selected ? all.filter((x) => x !== s.id) : [...all, s.id];
                            field.onChange(next.length === scale.sizes.length ? undefined : next);
                          }}
                          className={cn('rounded-md border px-3 py-1.5 text-sm', selected ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted')}
                        >
                          {s.code}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            />
          )}
          <Controller
            control={form.control}
            name="colorIds"
            render={({ field }) => (
              <fieldset data-tour="modelo-colores">
                <legend className="mb-2 text-sm font-medium">Colores</legend>
                <div className="flex flex-wrap gap-2">
                  {md.colors.filter((c) => c.isActive).map((c) => {
                    const selected = field.value?.includes(c.id);
                    return (
                      <button
                        type="button"
                        key={c.id}
                        aria-pressed={selected}
                        onClick={() => field.onChange(selected ? field.value.filter((x) => x !== c.id) : [...(field.value ?? []), c.id])}
                        className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm', selected ? 'border-accent bg-accent-soft' : 'border-border')}
                      >
                        <span className="size-3 rounded-full border border-border" style={{ background: c.hex ?? undefined }} aria-hidden />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
                {err.colorIds && <p className="mt-1 text-xs text-danger">{err.colorIds.message}</p>}
              </fieldset>
            )}
          />
          <p data-tour="modelo-resumen" className="rounded-md bg-surface-2 px-3 py-2 text-sm">
            Se van a generar <strong className="num">{sizesSelected * colorIds.length}</strong> variantes ({sizesSelected} talles × {colorIds.length} colores), cada
            una con su SKU y código de barras.
          </p>
        </Card>

        <div className="flex gap-2">
          <Button data-tour="modelo-crear" type="submit" loading={create.isPending}>
            Crear modelo
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
