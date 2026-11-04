'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgePercent, Plus } from 'lucide-react';
import { PROMOTION_SCOPES, PROMOTION_SCOPE_LABELS, type PromotionScopeCode } from '@erp/contracts';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, isZero, todayISO } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface Promotion {
  id: string;
  name: string;
  discountPct: string;
  minQty: string;
  scope: PromotionScopeCode;
  targetIds: string[];
  customerIds: string[];
  priceListIds: string[];
  targets: string[];
  customers: string[];
  priceLists: string[];
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  notes: string | null;
  status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'PAUSED';
  usage: { orders: number; units: string; discount: string };
}

interface Form {
  name: string;
  discountPct: string;
  minQty: string;
  scope: PromotionScopeCode;
  targetIds: string[];
  customerIds: string[];
  priceListIds: string[];
  validFrom: string;
  validTo: string;
  isActive: boolean;
  notes: string;
}

const STATUS: Record<Promotion['status'], [string, 'success' | 'accent' | 'neutral' | 'warning']> = {
  ACTIVE: ['Vigente', 'success'],
  SCHEDULED: ['Programada', 'accent'],
  EXPIRED: ['Vencida', 'neutral'],
  PAUSED: ['Pausada', 'warning'],
};
const empty = (): Form => ({ name: '', discountPct: '', minQty: '0', scope: 'ALL', targetIds: [], customerIds: [], priceListIds: [], validFrom: todayISO(), validTo: '', isActive: true, notes: '' });
const fromPromotion = (p: Promotion): Form => ({
  name: p.name,
  discountPct: p.discountPct,
  minQty: p.minQty,
  scope: p.scope,
  targetIds: p.targetIds,
  customerIds: p.customerIds,
  priceListIds: p.priceListIds,
  validFrom: p.validFrom.slice(0, 10),
  validTo: p.validTo?.slice(0, 10) ?? '',
  isActive: p.isActive,
  notes: p.notes ?? '',
});
const payload = (f: Form) => ({ ...f, validTo: f.validTo || null, notes: f.notes || null });

export default function PromotionsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const manage = can('sales.prices.manage');
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['promotions'], queryFn: () => api.get<Promotion[]>('/sales/promotions') });
  const toggle = useMutation({
    mutationFn: (p: Promotion) => api.put(`/sales/promotions/${p.id}`, payload({ ...fromPromotion(p), isActive: !p.isActive })),
    onSuccess: async (_r, p) => {
      toast.success(p.isActive ? `"${p.name}" pausada: los pedidos nuevos ya no la toman.` : `"${p.name}" reactivada.`);
      await qc.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div>
      <PageHeader
        title="Promociones"
        description="Descuentos con vigencia, por volumen o por modelo, categoría o colección. En cada línea del pedido rige el mejor entre el descuento del cliente y la promoción: no se suman."
        actions={manage && !editing ? <Button onClick={() => setEditing({ id: null, form: empty() })}><Plus className="size-4" aria-hidden /> Nueva promoción</Button> : undefined}
      />
      {editing && (
        <PromotionForm
          key={editing.id ?? 'new'}
          id={editing.id}
          initial={editing.form}
          onDone={() => setEditing(null)}
        />
      )}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<BadgePercent className="size-8" aria-hidden />} title="Sin promociones" description="Creá una para que los pedidos la tomen solos mientras esté vigente." />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Promociones">
          {data.map((p) => {
            const [label, tone] = STATUS[p.status];
            return (
              <li key={p.id}>
                <Card className="p-4">
                  <article aria-label={p.name}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="num text-lg font-semibold">{fmtQty(p.discountPct)} %</span>
                          <span className="font-medium">{p.name}</span>
                          <Badge tone={tone}>{label}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {p.scope === 'ALL' ? 'Todos los modelos' : `${PROMOTION_SCOPE_LABELS[p.scope]}: ${p.targets.join(', ')}`}
                          {!isZero(p.minQty) && ` · desde ${fmtQty(p.minQty)} unidades por pedido`}
                          {p.customers.length > 0 && ` · solo ${p.customers.join(', ')}`}
                          {p.priceLists.length > 0 && ` · lista ${p.priceLists.join(', ')}`}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {p.validTo ? `Del ${fmtDate(p.validFrom)} al ${fmtDate(p.validTo)}` : `Desde el ${fmtDate(p.validFrom)}, sin vencimiento`}
                          {` · usada en ${p.usage.orders} ${p.usage.orders === 1 ? 'pedido' : 'pedidos'}`}
                          {p.usage.orders > 0 && ` (${fmtQty(p.usage.units)} u., ${fmtMoney(p.usage.discount)} de descuento)`}
                        </p>
                        {p.notes && <p className="mt-1 text-xs text-muted">{p.notes}</p>}
                      </div>
                      {manage && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditing({ id: p.id, form: fromPromotion(p) })}>Editar</Button>
                          <Button size="sm" variant="secondary" loading={toggle.isPending && toggle.variables?.id === p.id} onClick={() => toggle.mutate(p)}>
                            {p.isActive ? 'Pausar' : 'Reactivar'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PromotionForm({ id, initial, onDone }: { id: string | null; initial: Form; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: md } = useMasterData();
  const [f, setF] = useState<Form>(initial);
  const products = useQuery({ queryKey: ['products', 'all-select'], queryFn: () => api.get<{ rows: { id: string; code: string; name: string }[] }>('/catalog/products?pageSize=200'), enabled: f.scope === 'PRODUCTS' });
  const customers = useQuery({ queryKey: ['parties', 'customers-select'], queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=CUSTOMER&pageSize=200') });
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => api.get<{ id: string; name: string; isActive: boolean }[]>('/sales/price-lists') });
  const save = useMutation({
    mutationFn: () => (id ? api.put(`/sales/promotions/${id}`, payload(f)) : api.post('/sales/promotions', payload(f))),
    onSuccess: async () => {
      toast.success(id ? 'Promoción guardada. Los pedidos ya armados conservan su descuento.' : 'Promoción creada.');
      await qc.invalidateQueries({ queryKey: ['promotions'] });
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((x) => x.message).join(' · ') : (e as Error).message),
  });
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const targets =
    f.scope === 'PRODUCTS'
      ? (products.data?.rows ?? []).map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }))
      : f.scope === 'CATEGORIES'
        ? (md?.categories ?? []).filter((c) => c.kind === 'PRODUCT').map((c) => ({ id: c.id, label: c.name }))
        : f.scope === 'COLLECTIONS'
          ? (md?.collections ?? []).map((c) => ({ id: c.id, label: c.name }))
          : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card className="mb-4 p-4">
      <form onSubmit={submit} aria-label={id ? 'Editar promoción' : 'Nueva promoción'}>
        <h2 className="mb-3 font-medium">{id ? 'Editar promoción' : 'Nueva promoción'}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Nombre (se ve en el pedido)" htmlFor="pr-name" className="sm:col-span-2">
            <Input id="pr-name" required value={f.name} onChange={set('name')} placeholder="Ej.: 12 bodies, 12 % off" />
          </Field>
          <Field label="Descuento %" htmlFor="pr-pct">
            <Input id="pr-pct" required inputMode="decimal" value={f.discountPct} onChange={(e) => setF((x) => ({ ...x, discountPct: e.target.value.replace(',', '.') }))} />
          </Field>
          <Field label="Mínimo de unidades por pedido" htmlFor="pr-min" hint="0 = sin mínimo">
            <Input id="pr-min" inputMode="numeric" value={f.minQty} onChange={set('minQty')} />
          </Field>
          <Field label="Vigente desde" htmlFor="pr-from">
            <Input id="pr-from" type="date" required value={f.validFrom} onChange={set('validFrom')} />
          </Field>
          <Field label="Hasta (inclusive)" htmlFor="pr-to" hint="Vacío = sin vencimiento">
            <Input id="pr-to" type="date" min={f.validFrom} value={f.validTo} onChange={set('validTo')} />
          </Field>
          <Field label="Aplica a" htmlFor="pr-scope">
            <Select id="pr-scope" value={f.scope} onChange={(e) => setF((x) => ({ ...x, scope: e.target.value as PromotionScopeCode, targetIds: [] }))}>
              {PROMOTION_SCOPES.map((s) => <option key={s} value={s}>{PROMOTION_SCOPE_LABELS[s]}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF((x) => ({ ...x, isActive: e.target.checked }))} /> Activa
          </label>
        </div>
        {f.scope !== 'ALL' && (
          <CheckList title={PROMOTION_SCOPE_LABELS[f.scope]} options={targets} value={f.targetIds} onChange={(v) => setF((x) => ({ ...x, targetIds: v }))} loading={f.scope === 'PRODUCTS' && products.isLoading} />
        )}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CheckList
            title="Solo para estos clientes (opcional)"
            options={(customers.data?.rows ?? []).map((c) => ({ id: c.id, label: c.legalName }))}
            value={f.customerIds}
            onChange={(v) => setF((x) => ({ ...x, customerIds: v }))}
            emptyMeans="Ninguno elegido: vale para todos los clientes."
          />
          <CheckList
            title="Solo con estas listas de precios (opcional)"
            options={(lists.data ?? []).filter((l) => l.isActive).map((l) => ({ id: l.id, label: l.name }))}
            value={f.priceListIds}
            onChange={(v) => setF((x) => ({ ...x, priceListIds: v }))}
            emptyMeans="Ninguna elegida: vale para todas las listas."
          />
        </div>
        <Field label="Notas" htmlFor="pr-notes" className="mt-4">
          <Textarea id="pr-notes" rows={2} value={f.notes} onChange={set('notes')} />
        </Field>
        <div className="mt-4 flex gap-2">
          <Button type="submit" loading={save.isPending}>{id ? 'Guardar' : 'Crear promoción'}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

/** Selección múltiple con buscador (modelos, categorías, colecciones, clientes, listas). */
function CheckList({ title, options, value, onChange, loading, emptyMeans }: { title: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; loading?: boolean; emptyMeans?: string }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = options.filter((o) => !term || o.label.toLowerCase().includes(term));
  return (
    <fieldset className="mt-4 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">
        {title} <span className="font-normal text-muted">({value.length} {value.length === 1 ? 'elegido' : 'elegidos'})</span>
      </legend>
      {options.length > 8 && <Input aria-label={`Buscar en ${title}`} placeholder="Buscar…" className="mb-2" value={q} onChange={(e) => setQ(e.target.value)} />}
      {loading ? (
        <Spinner />
      ) : (
        <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
          {shown.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} /> {o.label}
            </label>
          ))}
          {!shown.length && <p className="text-sm text-muted">Sin resultados.</p>}
        </div>
      )}
      {!value.length && emptyMeans && <p className="mt-1 text-xs text-muted">{emptyMeans}</p>}
    </fieldset>
  );
}
