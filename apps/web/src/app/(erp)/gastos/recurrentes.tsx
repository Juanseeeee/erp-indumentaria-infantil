'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Can, useCan, useMasterData } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Spinner } from '@/components/ui';

interface Template {
  id: string;
  name: string;
  amount: string;
  dayOfMonth: number;
  isActive: boolean;
  category: string;
  costCenter: string;
  account: string;
  lastPeriod: string | null;
  pending: { period: string; dueDate: string; overdue: boolean }[];
}

interface Account {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const emptyForm = () => ({ name: '', categoryId: '', costCenterId: '', cashAccountId: '', amount: '', dayOfMonth: '10', startsOn: `${todayISO().slice(0, 8)}01` });

/** Gastos que se repiten todos los meses (alquiler, servicios, abonos): se registran desde su plantilla. */
export function RecurringExpenses({ accounts }: { accounts: Account[] }) {
  const qc = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const list = useQuery({ queryKey: ['expense-templates'], queryFn: () => api.get<Template[]>('/treasury/expense-templates') });
  const refresh = () => Promise.all(['expense-templates', 'expenses', 'treasury-accounts', 'cashflow'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const create = useMutation({
    mutationFn: () => api.post('/treasury/expense-templates', form),
    onSuccess: async () => {
      setForm(emptyForm());
      setShowForm(false);
      toast.success('Gasto recurrente creado.');
      await refresh();
    },
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/expense-templates/${id}/deactivate`),
    onSuccess: refresh,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const payable = accounts.filter((a) => a.isActive && ['CASH_BOX', 'BANK', 'WALLET'].includes(a.type));
  const templates = list.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {list.error && <ErrorBox error={list.error} />}
      {create.error && <ErrorBox error={create.error} />}
      <Can perm="treasury.move">
        <div><Button variant="secondary" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>Nuevo gasto recurrente</Button></div>
        {showForm && (
          <Card className="p-4">
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Nombre" htmlFor="rt-name"><Input id="rt-name" required maxLength={100} placeholder="Alquiler depósito" value={form.name} onChange={set('name')} /></Field>
              <Field label="Categoría" htmlFor="rt-cat">
                <Select id="rt-cat" required value={form.categoryId} onChange={set('categoryId')}>
                  <option value="">Elegí la categoría</option>
                  {(md?.categories ?? []).filter((c) => c.kind === 'EXPENSE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Centro de costo" htmlFor="rt-cc">
                <Select id="rt-cc" required value={form.costCenterId} onChange={set('costCenterId')}>
                  <option value="">Elegí el centro</option>
                  {(md?.costCenters ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </Select>
              </Field>
              <Field label="Se paga desde" htmlFor="rt-acc">
                <Select id="rt-acc" required value={form.cashAccountId} onChange={set('cashAccountId')}>
                  <option value="">Elegí la cuenta</option>
                  {payable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
              <Field label="Importe habitual" htmlFor="rt-amount" hint="Se puede corregir cada mes">
                <Input id="rt-amount" required type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} />
              </Field>
              <Field label="Vence el día" htmlFor="rt-day" hint="Del 1 al 28">
                <Input id="rt-day" required type="number" min={1} max={28} value={form.dayOfMonth} onChange={set('dayOfMonth')} />
              </Field>
              <Field label="Desde" htmlFor="rt-start" hint="Primer mes que cubre">
                <Input id="rt-start" required type="date" value={form.startsOn} onChange={set('startsOn')} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" loading={create.isPending}>Crear</Button></div>
            </form>
          </Card>
        )}
      </Can>

      {list.isLoading ? (
        <Spinner />
      ) : templates.length ? (
        templates.map((t) => (
          <section key={t.id} aria-labelledby={`tpl-${t.id}`}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 id={`tpl-${t.id}`} className="font-medium">{t.name}</h3>
                  {!t.isActive && <Badge>Desactivado</Badge>}
                  <p className="text-sm text-muted">
                    {fmtMoney(t.amount)} · vence el {t.dayOfMonth} de cada mes · {t.category} · {t.costCenter} · desde {t.account}
                    {t.lastPeriod && ` · último registrado: ${monthName(t.lastPeriod)}`}
                  </p>
                </div>
                {t.isActive && can('treasury.move') && (
                  <Button size="sm" variant="ghost" loading={deactivate.isPending && deactivate.variables === t.id} onClick={() => deactivate.mutate(t.id)}>Desactivar</Button>
                )}
              </div>
              {t.isActive && (t.pending.length ? (
                <ul className="mt-3 flex flex-col gap-2">
                  {t.pending.map((p) => <PendingMonth key={p.period} template={t} pending={p} canAct={can('treasury.move')} onDone={refresh} />)}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-success">Al día.</p>
              ))}
            </Card>
          </section>
        ))
      ) : (
        <Card><EmptyState icon={<Repeat className="size-8" />} title="Sin gastos recurrentes" description="Cargá el alquiler, los servicios y los abonos para registrarlos cada mes con un clic y verlos en el flujo de fondos." /></Card>
      )}
    </div>
  );
}

function PendingMonth({ template, pending, canAct, onDone }: { template: Template; pending: Template['pending'][number]; canAct: boolean; onDone: () => Promise<unknown> }) {
  const [amount, setAmount] = useState(template.amount);
  const [doc, setDoc] = useState('');
  const register = useMutation({
    mutationFn: () => api.post<{ number: string }>(`/treasury/expense-templates/${template.id}/register`, { period: pending.period, amount, documentReference: doc || null }),
    onSuccess: async (e) => {
      toast.success(`${template.name} de ${monthName(pending.period)} registrado (${e.number}).`);
      await onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const label = `${template.name} ${monthName(pending.period)}`;
  return (
    <li className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <div className="min-w-40">
        <p className="font-medium capitalize">{monthName(pending.period)}</p>
        <p className="text-sm text-muted">
          Vence el {fmtDate(pending.dueDate)} {pending.overdue && <Badge tone="warning">Vencido</Badge>}
        </p>
      </div>
      {canAct && (
        <>
          <Field label="Importe" htmlFor={`amt-${template.id}-${pending.period}`}>
            <Input id={`amt-${template.id}-${pending.period}`} aria-label={`Importe de ${label}`} type="number" min="0.01" step="0.01" inputMode="decimal" className="w-36" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Comprobante" htmlFor={`doc-${template.id}-${pending.period}`}>
            <Input id={`doc-${template.id}-${pending.period}`} aria-label={`Comprobante de ${label}`} maxLength={100} className="w-44" value={doc} onChange={(e) => setDoc(e.target.value)} />
          </Field>
          <Button size="sm" loading={register.isPending} onClick={() => register.mutate()} aria-label={`Registrar ${label}`}>Registrar</Button>
        </>
      )}
    </li>
  );
}
