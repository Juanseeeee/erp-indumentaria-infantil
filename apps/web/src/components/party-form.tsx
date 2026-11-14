'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PartyUpsertSchema } from '@erp/contracts';
import { cn, PARTY_ROLE_LABELS, TAX_CONDITION_LABELS } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCan, useMasterData } from '@/lib/session';
import { Button, Card, Field, Input, Select, Textarea } from './ui';

export type PartyFormValues = z.input<typeof PartyUpsertSchema>;

export function PartyForm({
  defaultValues,
  onSubmit,
  submitting,
  submitLabel,
}: {
  defaultValues?: Partial<PartyFormValues>;
  onSubmit: (v: PartyFormValues) => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const can = useCan();
  const { data: md } = useMasterData();
  const form = useForm<PartyFormValues>({
    resolver: zodResolver(PartyUpsertSchema),
    defaultValues: { taxIdType: 'CUIT', taxCondition: 'RI', roles: ['CUSTOMER'], ...defaultValues },
  });
  const err = form.formState.errors;
  const roles = form.watch('roles') ?? [];
  const nullable = { setValueAs: (v: string) => (v === '' ? null : v) };
  const salesEnabled = can('sales.view') && roles.includes('CUSTOMER');
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => api.get<{ id: string; name: string; isActive: boolean }[]>('/sales/price-lists'), enabled: salesEnabled });
  const sellers = useQuery({ queryKey: ['sellers'], queryFn: () => api.get<{ userId: string; name: string }[]>('/sales/sellers'), enabled: salesEnabled });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <Card className="p-4">
        <Controller
          control={form.control}
          name="roles"
          render={({ field }) => (
            <fieldset data-tour="tercero-form-roles">
              <legend className="mb-2 text-sm font-medium">Es…</legend>
              <div className="flex flex-wrap gap-2">
                {(['CUSTOMER', 'SUPPLIER', 'WORKSHOP'] as const).map((r) => {
                  const on = field.value?.includes(r);
                  return (
                    <button
                      type="button"
                      key={r}
                      aria-pressed={on}
                      onClick={() => field.onChange(on ? field.value.filter((x) => x !== r) : [...(field.value ?? []), r])}
                      className={cn('rounded-md border px-3 py-1.5 text-sm', on ? 'border-accent bg-accent-soft text-accent' : 'border-border')}
                    >
                      {PARTY_ROLE_LABELS[r]}
                    </button>
                  );
                })}
              </div>
              {err.roles && <p className="mt-1 text-xs text-danger">{err.roles.message}</p>}
              {roles.includes('WORKSHOP') && (
                <p className="mt-2 text-xs text-muted">Los talleres tienen un depósito virtual propio: lo que se les envía queda registrado como stock en su poder.</p>
              )}
            </fieldset>
          )}
        />
      </Card>
      <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <Field tour="tercero-form-razon-social" label="Razón social" htmlFor="legalName" error={err.legalName?.message}>
          <Input id="legalName" autoFocus {...form.register('legalName')} />
        </Field>
        <Field label="Nombre de fantasía" htmlFor="tradeName">
          <Input id="tradeName" {...form.register('tradeName')} />
        </Field>
        <div className="grid grid-cols-3 gap-2" data-tour="tercero-form-documento">
          <Field label="Documento" htmlFor="taxIdType">
            <Select id="taxIdType" {...form.register('taxIdType')}>
              <option value="CUIT">CUIT</option>
              <option value="CUIL">CUIL</option>
              <option value="DNI">DNI</option>
              <option value="OTHER">Otro</option>
            </Select>
          </Field>
          <Field label="Número" htmlFor="taxId" error={err.taxId?.message} className="col-span-2">
            <Input id="taxId" inputMode="numeric" placeholder="30-12345678-9" {...form.register('taxId')} />
          </Field>
        </div>
        <Field tour="tercero-form-condicion-fiscal" label="Condición fiscal" htmlFor="taxCondition">
          <Select id="taxCondition" {...form.register('taxCondition')}>
            {Object.entries(TAX_CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field tour="tercero-form-email" label="Email" htmlFor="email" error={err.email?.message}>
          <Input id="email" type="email" {...form.register('email')} />
        </Field>
        <Field label="Teléfono" htmlFor="phone">
          <Input id="phone" {...form.register('phone')} />
        </Field>
        <Field tour="tercero-form-domicilio" label="Domicilio fiscal" htmlFor="street" className="sm:col-span-2">
          <Input id="street" {...form.register('address.street')} placeholder="Calle y número" />
        </Field>
        <Field label="Localidad" htmlFor="city">
          <Input id="city" {...form.register('address.city')} />
        </Field>
        <Field label="Provincia" htmlFor="province">
          <Input id="province" {...form.register('address.province')} />
        </Field>
        <Field label="Notas" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" {...form.register('notes')} />
        </Field>
      </Card>
      {roles.includes('CUSTOMER') && md && (
        <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2" tour="tercero-form-condiciones">
          <p className="text-sm font-medium sm:col-span-2">Condiciones comerciales</p>
          <Field tour="tercero-form-condicion-pago" label="Condición de pago" htmlFor="pt">
            <Select id="pt" {...form.register('customer.paymentTermId', nullable)}>
              <option value="">—</option>
              {md.paymentTerms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Zona" htmlFor="zone">
            <Select id="zone" {...form.register('customer.zoneId', nullable)}>
              <option value="">—</option>
              {md.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </Select>
          </Field>
          {salesEnabled && (
            <>
              <Field tour="tercero-form-lista-precios" label="Lista de precios" htmlFor="pricelist">
                <Select id="pricelist" {...form.register('customer.priceListId', nullable)}>
                  <option value="">—</option>
                  {lists.data?.filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
              <Field tour="tercero-form-vendedor" label="Vendedor" htmlFor="seller" hint="Cobra comisión sobre lo que se cobre de este cliente">
                <Select id="seller" {...form.register('customer.sellerUserId', nullable)}>
                  <option value="">—</option>
                  {sellers.data?.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}
                </Select>
              </Field>
            </>
          )}
          {can('parties.credit.view') ? (
            <>
              <Field tour="tercero-form-limite-credito" label="Límite de crédito ($)" htmlFor="credit" error={err.customer?.creditLimit?.message}>
                <Input id="credit" inputMode="decimal" {...form.register('customer.creditLimit', nullable)} />
              </Field>
              <Field tour="tercero-form-descuento" label="Descuento general (%)" htmlFor="disc" error={err.customer?.discountPct?.message}>
                <Input id="disc" inputMode="decimal" {...form.register('customer.discountPct')} />
              </Field>
            </>
          ) : (
            <p className="text-xs text-muted sm:col-span-2">El límite de crédito y los descuentos los define Administración.</p>
          )}
        </Card>
      )}
      <div>
        <Button data-tour="tercero-form-guardar" type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
