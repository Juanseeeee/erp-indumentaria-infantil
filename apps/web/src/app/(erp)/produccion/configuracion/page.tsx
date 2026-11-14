'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui';

interface Config {
  stages: { id: string; code: string; name: string; sortOrder: number; isExternal: boolean }[];
  defectReasons: { id: string; name: string }[];
  workshops: { id: string; legalName: string }[];
  rates: { id: string; price: string; validFrom: string; product?: { name: string; code: string }; workshop?: { legalName: string } }[];
}

function useSave(path: string, method: 'post' | 'put' = 'post') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: object) => (method === 'post' ? api.post(path, b) : api.put(path, b)),
    onSuccess: () => {
      toast.success('Guardado.');
      qc.invalidateQueries({ queryKey: ['production-config'] });
    },
    onError: (e) => toast.error(e.message),
  });
}

export default function ProductionConfigPage() {
  const [tab, setTab] = useState('tarifas');
  const { data, isLoading } = useQuery({ queryKey: ['production-config'], queryFn: () => api.get<Config>('/production/config') });
  const products = useQuery({ queryKey: ['products', 'for-rates'], queryFn: () => api.get<{ rows: { id: string; code: string; name: string }[] }>('/catalog/products?pageSize=200') });
  const stage = useSave('/production/config/stages', 'put');
  const defect = useSave('/production/config/defect-reasons');
  const rate = useSave('/production/config/workshop-rates');
  if (isLoading || !data) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Configuración de producción" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'tarifas', label: 'Tarifas de talleres', tour: 'prodcfg-tab-tarifas' }, { id: 'etapas', label: 'Etapas', tour: 'prodcfg-tab-etapas' }, { id: 'fallas', label: 'Motivos de falla', tour: 'prodcfg-tab-fallas' }]} />
      {tab === 'tarifas' && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              rate.mutate({ workshopId: f.get('w'), productId: f.get('p'), price: String(f.get('price')).replace(',', '.'), validFrom: f.get('from') });
            }}
          >
            <Field tour="prodcfg-tarifa-taller" label="Taller" htmlFor="w"><Select id="w" name="w" required>{data.workshops.map((w) => <option key={w.id} value={w.id}>{w.legalName}</option>)}</Select></Field>
            <Field tour="prodcfg-tarifa-modelo" label="Modelo" htmlFor="p"><Select id="p" name="p" required>{products.data?.rows.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select></Field>
            <Field tour="prodcfg-tarifa-precio" label="Precio por prenda ($)" htmlFor="price"><Input id="price" name="price" inputMode="decimal" className="w-32" required /></Field>
            <Field tour="prodcfg-tarifa-desde" label="Vigente desde" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={todayISO()} required /></Field>
            <Button data-tour="prodcfg-tarifa-agregar" type="submit" loading={rate.isPending}>Agregar tarifa</Button>
          </form>
          <p className="px-4 pt-3 text-xs text-muted">El taller cobra por prenda terminada. Una tarifa nueva no pisa la anterior: cada recepción usa la vigente a su fecha.</p>
          <ul data-tour="prodcfg-tarifas-lista" className="mt-2">
            {data.rates.map((r) => (
              <li key={r.id} className="flex justify-between border-t border-border px-4 py-2 text-sm">
                <span>{r.workshop?.legalName} · {r.product?.name}</span>
                <span className="num">{fmtMoney(r.price)} <span className="text-muted">desde {fmtDate(r.validFrom)}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === 'etapas' && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              stage.mutate({ code: f.get('code'), name: f.get('name'), sortOrder: Number(f.get('order')), isExternal: f.get('ext') === 'on' });
            }}
          >
            <Field tour="prodcfg-etapa-codigo" label="Código" htmlFor="sc"><Input id="sc" name="code" className="w-28" required /></Field>
            <Field label="Nombre" htmlFor="sn"><Input id="sn" name="name" required /></Field>
            <Field label="Orden" htmlFor="so"><Input id="so" name="order" type="number" className="w-20" defaultValue={data.stages.length + 1} /></Field>
            <label data-tour="prodcfg-etapa-taller" className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="ext" /> La hace un taller</label>
            <Button data-tour="prodcfg-etapa-guardar" type="submit" loading={stage.isPending}>Guardar etapa</Button>
          </form>
          <ol>
            {data.stages.map((s) => (
              <li key={s.id} className="flex justify-between border-b border-border px-4 py-2 text-sm last:border-0">
                <span>{s.sortOrder}. {s.name} <span className="text-muted">({s.code})</span></span>
                {s.isExternal && <Badge tone="accent">Taller externo</Badge>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {tab === 'fallas' && (
        <Card>
          <form className="flex items-end gap-3 border-b border-border p-4" onSubmit={(e) => { e.preventDefault(); defect.mutate({ name: new FormData(e.currentTarget).get('name') }); e.currentTarget.reset(); }}>
            <Field tour="prodcfg-falla-motivo" label="Motivo" htmlFor="dn"><Input id="dn" name="name" required /></Field>
            <Button data-tour="prodcfg-falla-agregar" type="submit" loading={defect.isPending}>Agregar</Button>
          </form>
          <ul>{data.defectReasons.map((r) => <li key={r.id} className="border-b border-border px-4 py-2 text-sm last:border-0">{r.name}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
