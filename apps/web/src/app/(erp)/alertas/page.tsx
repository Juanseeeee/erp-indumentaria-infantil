'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertOctagon, AlertTriangle, BellOff, CheckCircle2, Info, Mail, RefreshCw } from 'lucide-react';
import { ALERT_PRIORITIES, ALERT_PRIORITY_LABELS, ALERT_STATUS_LABELS, type AlertPriority, type AlertRuleDefinition, type AlertStatus } from '@erp/contracts';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui';

interface Alert {
  id: string;
  code: string;
  ruleLabel: string;
  priority: AlertPriority;
  title: string;
  detail: string | null;
  link: string | null;
  status: AlertStatus;
  createdAt: string;
  lastDetectedAt: string;
  seenByName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
}

interface Rule {
  code: string;
  label: string;
  enabled: boolean;
  priority: AlertPriority;
  roles: string[];
  userIds: string[];
  sendEmail: boolean;
  days: number | null;
  open: number;
  definition: AlertRuleDefinition;
}

/** Prioridad: color de estado + ícono + texto (nunca solo color). */
const PRIORITY_STYLE: Record<AlertPriority, { tone: 'danger' | 'warning' | 'accent' | 'neutral'; icon: typeof Info }> = {
  CRITICAL: { tone: 'danger', icon: AlertOctagon },
  HIGH: { tone: 'warning', icon: AlertTriangle },
  NORMAL: { tone: 'accent', icon: Info },
  LOW: { tone: 'neutral', icon: Info },
};

export default function AlertsPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const manage = can('alerts.manage');
  const tab = params.get('tab') ?? 'abiertas';
  const setTab = (id: string) => router.replace(`/alertas${id === 'abiertas' ? '' : `?tab=${id}`}`);
  const [everyone, setEveryone] = useState(false);

  return (
    <div>
      <PageHeader title="Alertas" description="Lo que necesita tu atención. Se revisan solas cada 15 minutos y se resuelven solas cuando la situación se normaliza." />
      <Tabs
        tabs={[
          { id: 'abiertas', label: 'Abiertas', tour: 'alertas-tab-abiertas' },
          { id: 'resueltas', label: 'Resueltas', tour: 'alertas-tab-resueltas' },
          ...(manage ? [{ id: 'reglas', label: 'Reglas', tour: 'alertas-tab-reglas' }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {manage && tab !== 'reglas' && (
        <label data-tour="alertas-ver-todos" className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Ver las alertas de todos los usuarios
        </label>
      )}
      {tab === 'reglas' && manage ? <RulesTab /> : <AlertList status={tab === 'resueltas' ? 'RESOLVED' : 'OPEN'} scope={everyone ? 'all' : 'mine'} />}
    </div>
  );
}

function AlertList({ status, scope }: { status: 'OPEN' | 'RESOLVED'; scope: 'mine' | 'all' }) {
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts', status, scope],
    queryFn: () => api.get<{ total: number; rows: Alert[] }>(`/alerts?status=${status}&scope=${scope}&pageSize=200`),
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['alerts'] }), qc.invalidateQueries({ queryKey: ['alerts-summary'] })]);
  const seen = useMutation({ mutationFn: (id: string) => api.post(`/alerts/${id}/seen`), onSuccess: refresh });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/resolve`, { note: note.trim() || null }),
    onSuccess: async () => {
      setResolving(null);
      setNote('');
      toast.success('Alerta resuelta. No vuelve a aparecer mientras la situación siga igual.');
      await refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.rows.length)
    return (
      <Card>
        <EmptyState
          icon={status === 'OPEN' ? <CheckCircle2 className="size-8" aria-hidden /> : <BellOff className="size-8" aria-hidden />}
          title={status === 'OPEN' ? 'Todo en orden' : 'Sin alertas resueltas'}
          description={status === 'OPEN' ? 'No hay alertas abiertas para vos.' : 'Todavía no se resolvió ninguna alerta.'}
        />
      </Card>
    );

  return (
    <ul data-tour="alertas-lista" className="flex flex-col gap-2" aria-label={status === 'OPEN' ? 'Alertas abiertas' : 'Alertas resueltas'}>
      {data.rows.map((a) => {
        const style = PRIORITY_STYLE[a.priority];
        const Icon = style.icon;
        return (
          <li key={a.id}>
            <Card className={`p-4 ${a.status === 'NEW' ? 'border-l-4 border-l-accent' : ''}`}>
              <article aria-label={a.title}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={style.tone}>
                        <Icon className="mr-1 size-3" aria-hidden /> {ALERT_PRIORITY_LABELS[a.priority]}
                      </Badge>
                      <span className="text-muted">{a.ruleLabel}</span>
                      {a.status === 'NEW' && <Badge tone="accent">{ALERT_STATUS_LABELS.NEW}</Badge>}
                    </div>
                    {a.link ? (
                      <Link href={a.link} className="font-medium hover:underline" onClick={() => a.status === 'NEW' && seen.mutate(a.id)}>
                        {a.title}
                      </Link>
                    ) : (
                      <p className="font-medium">{a.title}</p>
                    )}
                    {a.detail && <p className="mt-0.5 text-sm text-muted">{a.detail}</p>}
                    <p className="mt-1 text-xs text-muted">
                      Desde el {fmtDateTime(a.createdAt)}
                      {a.seenByName && a.status !== 'RESOLVED' && ` · vista por ${a.seenByName}`}
                      {a.resolvedAt && ` · resuelta el ${fmtDateTime(a.resolvedAt)}${a.resolvedByName ? ` por ${a.resolvedByName}` : ''}`}
                      {a.resolutionNote && ` · ${a.resolutionNote}`}
                    </p>
                  </div>
                  {a.status !== 'RESOLVED' && (
                    <div className="flex gap-2">
                      {a.status === 'NEW' && (
                        <Button size="sm" variant="secondary" loading={seen.isPending && seen.variables === a.id} onClick={() => seen.mutate(a.id)}>
                          Marcar vista
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setResolving(resolving === a.id ? null : a.id)} aria-expanded={resolving === a.id}>
                        Resolver
                      </Button>
                    </div>
                  )}
                </div>
                {resolving === a.id && (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      resolve.mutate(a.id);
                    }}
                  >
                    <Field label="Qué se hizo (opcional)" htmlFor={`note-${a.id}`} className="min-w-64 flex-1">
                      <Input id={`note-${a.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoFocus />
                    </Field>
                    <Button type="submit" size="sm" loading={resolve.isPending}>Confirmar</Button>
                  </form>
                )}
              </article>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function RulesTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => api.get<{ rules: Rule[]; roles: { code: string; name: string }[]; emailConfigured: boolean }>('/alerts/rules'),
  });
  const evaluate = useMutation({
    mutationFn: () => api.post<{ created: number; resolved: number; open: number; email: { configured: boolean; sent: number; failed: number } }>('/alerts/evaluate'),
    onSuccess: async (r) => {
      toast.success(`${r.created} ${r.created === 1 ? 'alerta nueva' : 'alertas nuevas'}, ${r.resolved} resueltas, ${r.open} abiertas${r.email.configured ? ` · ${r.email.sent} correos enviados` : ''}.`);
      await Promise.all([qc.invalidateQueries({ queryKey: ['alerts'] }), qc.invalidateQueries({ queryKey: ['alerts-summary'] }), qc.invalidateQueries({ queryKey: ['alert-rules'] })]);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="flex flex-col gap-3" data-tour="alertas-reglas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Cada regla avisa a los roles elegidos. Las alertas nuevas se mandan por correo en un resumen por persona.</p>
        <Button data-tour="alertas-revisar-ahora" variant="secondary" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>
          <RefreshCw className="size-4" aria-hidden /> Revisar ahora
        </Button>
      </div>
      {!data.emailConfigured && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
          El envío de correos no está configurado (falta SMTP_URL): las alertas se ven en el sistema y los correos quedan en espera hasta configurarlo.
        </div>
      )}
      {data.rules.map((r) => <RuleCard key={r.code} rule={r} roles={data.roles} />)}
    </div>
  );
}

function RuleCard({ rule, roles }: { rule: Rule; roles: { code: string; name: string }[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ enabled: rule.enabled, priority: rule.priority, roles: rule.roles, sendEmail: rule.sendEmail, days: rule.days });
  const dirty = JSON.stringify(form) !== JSON.stringify({ enabled: rule.enabled, priority: rule.priority, roles: rule.roles, sendEmail: rule.sendEmail, days: rule.days });
  const save = useMutation({
    mutationFn: () => api.put(`/alerts/rules/${rule.code}`, { ...form, userIds: rule.userIds }),
    onSuccess: async () => {
      toast.success(`Regla "${rule.label}" guardada.`);
      await qc.invalidateQueries({ queryKey: ['alert-rules'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const id = `rule-${rule.code}`;
  const toggleRole = (code: string) => setForm((f) => ({ ...f, roles: f.roles.includes(code) ? f.roles.filter((r) => r !== code) : [...f.roles, code] }));

  return (
    <Card className="p-4">
      <section aria-labelledby={`${id}-title`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id={`${id}-title`} className="font-medium">{rule.label}</h2>
            <p className="text-sm text-muted">{rule.definition.description}</p>
          </div>
          <span className="text-xs text-muted">{rule.open} {rule.open === 1 ? 'abierta' : 'abiertas'}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} /> Activa
          </label>
          <Field label="Prioridad" htmlFor={`${id}-priority`}>
            <Select id={`${id}-priority`} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as AlertPriority }))}>
              {ALERT_PRIORITIES.map((p) => <option key={p} value={p}>{ALERT_PRIORITY_LABELS[p]}</option>)}
            </Select>
          </Field>
          {rule.definition.days && (
            <Field label={rule.definition.days.label} htmlFor={`${id}-days`}>
              <Input
                id={`${id}-days`}
                type="number"
                className="w-24"
                min={rule.definition.days.min}
                max={rule.definition.days.max}
                value={form.days ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, days: e.target.value === '' ? null : Number(e.target.value) }))}
              />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm((f) => ({ ...f, sendEmail: e.target.checked }))} /> Avisar por correo
          </label>
        </div>
        <fieldset className="mt-3">
          <legend className="mb-1 text-xs font-medium text-muted">Destinatarios</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {roles.map((r) => (
              <label key={r.code} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.roles.includes(r.code)} onChange={() => toggleRole(r.code)} /> {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-3">
          <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button>
        </div>
      </section>
    </Card>
  );
}
