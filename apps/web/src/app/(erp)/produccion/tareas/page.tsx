'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Minus, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, fmtDate, fmtQty } from '@/lib/format';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Spinner } from '@/components/ui';

interface Task {
  orderId: string;
  number: string;
  priority: number;
  dueDate: string | null;
  planned: string;
  product?: { name: string; code: string };
  stage: { stageId: string; completedQty: string; defectQty: string; stage?: { name: string } };
}

/** Vista de planta: pensada para celular. Tarjeta → cantidades con botones grandes → Informar. */
export default function TasksPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['my-tasks'], queryFn: () => api.get<Task[]>('/production/my-tasks'), refetchInterval: 60_000 });
  const reasons = useQuery({ queryKey: ['production-config'], queryFn: () => api.get<{ defectReasons: { id: string; name: string }[] }>('/production/config') });
  const [open, setOpen] = useState<string | null>(null);
  const [good, setGood] = useState(0);
  const [bad, setBad] = useState(0);
  const [reason, setReason] = useState('');
  const report = useMutation({
    mutationFn: (t: Task & { finish: boolean }) =>
      api.post(`/production/orders/${t.orderId}/report`, { stageId: t.stage.stageId, qtyGood: String(good), qtyDefect: String(bad), defectReasonId: reason || null, finishStage: t.finish }),
    onSuccess: () => {
      toast.success('Avance informado.');
      setOpen(null);
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  const Counter = ({ label, value, set, tone }: { label: string; value: number; set: (n: number) => void; tone?: string }) => (
    <div className="flex flex-col items-center gap-2">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <button className="flex size-12 items-center justify-center rounded-full border border-border" onClick={() => set(Math.max(0, value - 1))} aria-label={`Restar ${label}`}><Minus className="size-5" /></button>
        <input
          inputMode="numeric"
          className={cn('num w-20 rounded-md border border-border bg-surface py-2 text-center text-2xl font-semibold', tone)}
          value={value}
          onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')) || 0)}
          aria-label={label}
        />
        <button className="flex size-12 items-center justify-center rounded-full border border-border" onClick={() => set(value + 1)} aria-label={`Sumar ${label}`}><Plus className="size-5" /></button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader tour="tareas-header" title="Mis tareas" description="Órdenes con etapas para hacer en planta, las más urgentes primero." />
      {!data?.length && <Card><EmptyState title="No hay tareas pendientes" description="Cuando se libere una orden, sus etapas internas aparecen acá." /></Card>}
      <div className="flex flex-col gap-3">
        {data?.map((t) => (
          <Card key={t.orderId} className="p-4">
            <button data-tour="tareas-tarjeta" className="w-full text-left" onClick={() => { setOpen(open === t.orderId ? null : t.orderId); setGood(0); setBad(0); setReason(''); }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{t.stage.stage?.name}</p>
                  <p className="text-sm">{t.product?.name}</p>
                  <p className="text-xs text-muted">{t.number} · entrega {fmtDate(t.dueDate)}</p>
                </div>
                <div className="text-right">
                  {t.priority === 1 && <Badge tone="danger">Urgente</Badge>}
                  <p className="num mt-1 text-sm">{fmtQty(t.stage.completedQty)} / {fmtQty(t.planned)}</p>
                </div>
              </div>
            </button>
            {open === t.orderId && (
              <div data-tour="tareas-cantidades" className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                <Counter label="Prendas OK" value={good} set={setGood} />
                <Counter label="Con falla" value={bad} set={setBad} tone={bad ? 'text-danger' : ''} />
                {bad > 0 && (
                  <Select data-tour="tareas-motivo" aria-label="Motivo de la falla" value={reason} onChange={(e) => setReason(e.target.value)} className="h-11">
                    <option value="">Motivo de la falla…</option>
                    {reasons.data?.defectReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button data-tour="tareas-informar" className="h-12 text-base whitespace-normal" disabled={!good && !bad} loading={report.isPending} onClick={() => report.mutate({ ...t, finish: false })}>Informar</Button>
                  <Button data-tour="tareas-terminar" className="h-12 text-sm leading-tight whitespace-normal" variant="secondary" loading={report.isPending} onClick={() => report.mutate({ ...t, finish: true })}>Informar y terminar etapa</Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
