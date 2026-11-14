'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { DOC_STATUS_LABELS, fmtDateTime, statusTone } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select } from '@/components/ui';

interface Count {
  id: string;
  number: string;
  warehouseId: string;
  status: string;
  createdAt: string;
  postedAt: string | null;
}

export default function CountsPage() {
  const router = useRouter();
  const can = useCan();
  const { data: md } = useMasterData();
  const [warehouseId, setWarehouseId] = useState('');
  const [kind, setKind] = useState('');
  const { data } = useQuery({ queryKey: ['counts'], queryFn: () => api.get<Count[]>('/inventory/counts') });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/inventory/counts', { warehouseId, kind: kind || undefined }),
    onSuccess: (c) => router.push(`/stock/inventarios/${c.id}`),
    onError: (e) => toast.error(e.message),
  });
  const wh = (id: string) => md?.warehouses.find((w) => w.id === id)?.name ?? '—';

  return (
    <div className="max-w-4xl">
      <PageHeader title="Inventarios físicos" description="Al abrir un inventario se toma una foto del stock; al confirmarlo se ajustan solo las diferencias contadas." />
      {can('inventory.count') && (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
          <Field label="Depósito" htmlFor="cwh" className="min-w-56" tour="stockinv-deposito">
            <Select id="cwh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Elegí un depósito…</option>
              {md?.warehouses.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Alcance" htmlFor="ckind" tour="stockinv-alcance">
            <Select id="ckind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Todos los artículos</option>
              <option value="VARIANT">Solo prendas</option>
              <option value="MATERIAL">Solo materiales</option>
            </Select>
          </Field>
          <Button data-tour="stockinv-abrir" disabled={!warehouseId} loading={create.isPending} onClick={() => create.mutate()}>
            Abrir inventario
          </Button>
        </Card>
      )}
      <Card tour="stockinv-lista">
        {data?.length ? (
          <ul>
            {data.map((c) => (
              <li key={c.id} className="flex items-center justify-between border-b border-border px-4 py-3 text-sm last:border-0">
                <Link href={`/stock/inventarios/${c.id}`} className="font-medium hover:underline">
                  {c.number} · {wh(c.warehouseId)}
                </Link>
                <span className="flex items-center gap-3">
                  <Badge tone={statusTone(c.status)}>{DOC_STATUS_LABELS[c.status]}</Badge>
                  <span className="text-xs text-muted">{fmtDateTime(c.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<ClipboardList className="size-8" />} title="Sin inventarios" description="Abrí un inventario por depósito y cargá lo contado, a mano o con lector de códigos." />
        )}
      </Card>
    </div>
  );
}
