'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Tags } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/format';
import { Can } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';

interface PriceList {
  id: string;
  name: string;
  kind: 'WHOLESALE' | 'RETAIL' | 'SPECIAL';
  includesVat: boolean;
  baseListId: string | null;
  baseList: string | null;
  markupPct: string | null;
  isActive: boolean;
  customers: number;
}
const KIND: Record<string, string> = { WHOLESALE: 'Mayorista', RETAIL: 'Minorista', SPECIAL: 'Especial' };
const empty = { name: '', kind: 'WHOLESALE', includesVat: false, baseListId: '', markupPct: '' };

export default function PriceListsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['price-lists'], queryFn: () => api.get<PriceList[]>('/sales/price-lists') });
  const [form, setForm] = useState<typeof empty | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post<PriceList>('/sales/price-lists', {
        name: form!.name,
        kind: form!.kind,
        includesVat: form!.includesVat,
        baseListId: form!.baseListId || null,
        markupPct: form!.baseListId ? form!.markupPct : null,
      }),
    onSuccess: () => { toast.success('Lista creada.'); setForm(null); qc.invalidateQueries({ queryKey: ['price-lists'] }); },
    onError: (e) => toast.error(e.message),
  });
  if (isLoading) return <Spinner />;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Listas de precios"
        description="Precio por modelo con excepción por variante. Las listas derivadas se calculan desde otra con un porcentaje."
        actions={<Can perm="sales.prices.manage"><Button data-tour="precios-nueva-lista" onClick={() => setForm(empty)}><Plus className="size-4" /> Nueva lista</Button></Can>}
      />
      {form && (
        <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2" tour="precios-form">
          <Field label="Nombre" htmlFor="pl-name" tour="precios-form-nombre"><Input id="pl-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Tipo" htmlFor="pl-kind" tour="precios-form-tipo">
            <Select id="pl-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field tour="precios-form-base" label="Deriva de" htmlFor="pl-base" hint="Opcional: sin precios propios, calcula desde la base">
            <Select id="pl-base" value={form.baseListId} onChange={(e) => setForm({ ...form, baseListId: e.target.value })}>
              <option value="">Precios propios</option>
              {data?.filter((l) => !l.baseListId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          {form.baseListId && (
            <Field tour="precios-form-porcentaje" label="Porcentaje sobre la base" htmlFor="pl-mk" hint="Ej.: 60 para +60 %, -10 para −10 %">
              <Input id="pl-mk" inputMode="decimal" value={form.markupPct} onChange={(e) => setForm({ ...form, markupPct: e.target.value.replace(',', '.') })} />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2" data-tour="precios-form-iva">
            <input type="checkbox" checked={form.includesVat} onChange={(e) => setForm({ ...form, includesVat: e.target.checked })} /> Los precios incluyen IVA
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button data-tour="precios-form-crear" loading={create.isPending} disabled={!form.name || (!!form.baseListId && !form.markupPct)} onClick={() => create.mutate()}>Crear</Button>
            <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
          </div>
        </Card>
      )}
      {!data?.length ? (
        <Card><EmptyState icon={<Tags className="size-8" />} title="Sin listas de precios" description="Creá la lista mayorista y cargá el precio de cada modelo." /></Card>
      ) : (
        <Card className="overflow-x-auto" tour="precios-listas">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                <th className="px-3 py-2 text-left">Lista</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Precios</th>
                <th className="px-3 py-2 text-right">Clientes</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2"><Link className="font-medium hover:underline" href={`/ventas/precios/${l.id}`}>{l.name}</Link> {!l.isActive && <Badge>Inactiva</Badge>}</td>
                  <td className="px-3 py-2">{KIND[l.kind]}</td>
                  <td className="px-3 py-2">{l.baseList ? `${l.baseList} ${Number(l.markupPct) >= 0 ? '+' : ''}${fmtQty(l.markupPct)} %` : 'Propios'} · {l.includesVat ? 'con IVA' : 'sin IVA'}</td>
                  <td className="num px-3 py-2 text-right">{l.customers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
