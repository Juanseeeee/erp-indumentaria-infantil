'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, LockOpen, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Can } from '@/lib/session';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Spinner, Textarea } from '@/components/ui';

interface Status {
  lockedUntil: string | null;
  today: string;
  history: { id: string; action: 'CLOSE' | 'REOPEN'; previousUntil: string | null; lockedUntil: string | null; notes: string | null; createdAt: string; by: string | null }[];
}

interface Checklist {
  checks: { key: string; ok: boolean; label: string; detail: string }[];
}

/** Último día del mes anterior a hoy (el cierre habitual). */
function lastMonthEnd(today: string) {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export default function PeriodClosePage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['periods'], queryFn: () => api.get<Status>('/periods') });
  const [until, setUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [reopenUntil, setReopenUntil] = useState('');
  const [reason, setReason] = useState('');

  const target = until || (data ? lastMonthEnd(data.today) : '');
  const checklist = useQuery({
    queryKey: ['periods-checklist', target],
    queryFn: () => api.get<Checklist>(`/periods/checklist${qs({ until: target })}`),
    enabled: Boolean(target),
    retry: false,
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['periods'] }), qc.invalidateQueries({ queryKey: ['periods-checklist'] })]);
  const close = useMutation({
    mutationFn: () => api.post('/periods/close', { until: target, notes: notes || null }),
    onSuccess: async () => {
      setNotes('');
      toast.success(`Período cerrado hasta el ${fmtDate(target)}.`);
      await refresh();
    },
  });
  const reopen = useMutation({
    mutationFn: () => api.post('/periods/reopen', { until: reopenUntil || null, reason }),
    onSuccess: async () => {
      setReason('');
      setReopenUntil('');
      toast.success('Período reabierto.');
      await refresh();
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const pending = checklist.data?.checks.filter((c) => !c.ok).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Cierre de período"
        description="Después de cerrar, no se registra ninguna operación con fecha igual o anterior al último día cerrado: cobros, pagos, facturas, gastos, movimientos de caja y banco, cheques ni stock."
      />

      <Card className="mb-4 flex items-center gap-3 p-4">
        {data.lockedUntil ? <Lock className="size-5 text-accent" aria-hidden /> : <LockOpen className="size-5 text-muted" aria-hidden />}
        <p>
          {data.lockedUntil ? (
            <>Cerrado hasta el <strong>{fmtDate(data.lockedUntil)}</strong>. Se puede operar desde el {fmtDate(dayAfter(data.lockedUntil))}.</>
          ) : (
            <>No hay períodos cerrados: se puede operar con cualquier fecha.</>
          )}
        </p>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Can perm="periods.close">
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Cerrar</h2>
            {close.error && <ErrorBox error={close.error} />}
            <form
              className="flex flex-col gap-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                close.mutate();
              }}
            >
              <Field label="Cerrar hasta el día" htmlFor="pc-until" hint="Inclusive. Habitualmente, el último día del mes anterior.">
                <Input id="pc-until" type="date" required max={dayBefore(data.today)} min={data.lockedUntil ? dayAfter(data.lockedUntil) : undefined} value={target} onChange={(e) => setUntil(e.target.value)} />
              </Field>
              {checklist.data && (
                <ul className="flex flex-col gap-1.5 text-sm" aria-label="Controles antes de cerrar">
                  {checklist.data.checks.map((c) => (
                    <li key={c.key} className="flex items-start gap-2">
                      {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
                      <span>
                        <span className="font-medium">{c.label}</span>
                        <span className="sr-only">{c.ok ? ': en orden' : ': pendiente'}</span>
                        <span className="block text-muted">{c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {pending > 0 && <p className="text-sm text-warning">Hay {pending} control{pending > 1 ? 'es' : ''} pendiente{pending > 1 ? 's' : ''}. Se puede cerrar igual, pero conviene resolverlo antes.</p>}
              <Field label="Observaciones" htmlFor="pc-notes">
                <Textarea id="pc-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div><Button type="submit" loading={close.isPending}>Cerrar período</Button></div>
            </form>
          </Card>
        </Can>

        {data.lockedUntil && (
          <Can perm="periods.reopen">
            <Card className="border-danger/40 p-4">
              <h2 className="mb-1 font-medium">Reabrir</h2>
              <p className="mb-3 text-sm text-muted">Permite volver a registrar operaciones en días ya cerrados. Queda registrado quién lo hizo y por qué.</p>
              {reopen.error && <ErrorBox error={reopen.error} />}
              <form
                className="flex flex-col gap-3"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  reopen.mutate();
                }}
              >
                <Field label="Dejar cerrado hasta el día" htmlFor="pr-until" hint="Vacío reabre todo.">
                  <Input id="pr-until" type="date" max={dayBefore(data.lockedUntil)} value={reopenUntil} onChange={(e) => setReopenUntil(e.target.value)} />
                </Field>
                <Field label="Motivo (obligatorio)" htmlFor="pr-reason">
                  <Textarea id="pr-reason" rows={2} required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div><Button type="submit" variant="danger" loading={reopen.isPending} disabled={reason.trim().length < 10}>Reabrir período</Button></div>
              </form>
            </Card>
          </Can>
        )}
      </div>

      <h2 className="mb-3 font-medium">Historial</h2>
      <Card className="overflow-hidden">
        {data.history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-left text-muted">
                <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Acción</th><th className="px-3 py-2">Cerrado hasta</th><th className="px-3 py-2">Por</th><th className="px-3 py-2">Observaciones</th></tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(h.createdAt)}</td>
                    <td className="px-3 py-2">{h.action === 'CLOSE' ? <Badge tone="success">Cierre</Badge> : <Badge tone="danger">Reapertura</Badge>}</td>
                    <td className="whitespace-nowrap px-3 py-2">{h.previousUntil ? `${fmtDate(h.previousUntil)} → ` : ''}{h.lockedUntil ? fmtDate(h.lockedUntil) : 'abierto'}</td>
                    <td className="px-3 py-2">{h.by}</td>
                    <td className="px-3 py-2">{h.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted">Todavía no se cerró ningún período.</p>
        )}
      </Card>
    </div>
  );
}

function dayAfter(iso: string) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
