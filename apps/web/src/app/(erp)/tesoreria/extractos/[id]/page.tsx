'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { STATEMENT_LINE_STATUS_LABELS } from '@erp/contracts';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, isNegative } from '@/lib/format';
import { Can, useCan, useMasterData } from '@/lib/session';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Stat } from '@/components/ui';

interface Movement {
  id: string;
  operationDate: string;
  valueDate: string;
  concept: string;
  amount: string;
}

interface Line {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: string;
  status: keyof typeof STATEMENT_LINE_STATUS_LABELS;
  notes: string | null;
  movement: Movement | null;
  suggestions: Movement[];
}

interface Statement {
  id: string;
  fileName: string;
  account: string;
  periodFrom: string;
  periodTo: string;
  skippedCount: number;
  summary: { lines: number; pending: number; bankTotal: string; pendingTotal: string };
  lines: Line[];
  systemOnly: Movement[];
}

const TONES: Record<Line['status'], 'warning' | 'success' | 'accent' | 'neutral'> = { PENDING: 'warning', MATCHED: 'success', CREATED: 'accent', IGNORED: 'neutral' };
const signed = (v: string) => <span className={`num ${isNegative(v) ? 'text-danger' : 'text-success'}`}>{isNegative(v) ? '−' : '+'}{fmtMoney(v.replace('-', ''))}</span>;

export default function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const key = ['bank-statement', id];
  const { data: s, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<Statement>(`/treasury/statements/${id}`) });
  const [openId, setOpenId] = useState<string | null>(null);

  const done = (message: string) => async (data: Statement | { statement: Statement }) => {
    qc.setQueryData(key, 'statement' in data ? data.statement : data);
    setOpenId(null);
    toast.success(message);
    await Promise.all(['bank-statements', 'treasury-accounts', 'treasury-movements', 'expenses'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
  const auto = useMutation({
    mutationFn: () => api.post<{ matched: number; statement: Statement }>(`/treasury/statements/${id}/auto-match`),
    onSuccess: async (r) => done(r.matched ? `Se conciliaron ${r.matched} líneas.` : 'No hubo coincidencias inequívocas.')(r),
  });
  const undo = useMutation({ mutationFn: (lineId: string) => api.post<Statement>(`/treasury/statement-lines/${lineId}/undo`), onSuccess: done('La línea volvió a pendiente.') });

  if (isLoading) return <Spinner />;
  if (error || !s) return <ErrorBox error={error} />;
  const withSuggestion = s.lines.filter((l) => l.status === 'PENDING' && l.suggestions.length).length;

  return (
    <div>
      <PageHeader
        title={`Extracto ${s.account}`}
        description={`${s.fileName} · ${fmtDate(s.periodFrom)} al ${fmtDate(s.periodTo)}${s.skippedCount ? ` · ${s.skippedCount} líneas ya estaban importadas` : ''}`}
        actions={
          <Can perm="treasury.move">
            <Button data-tour="ext-conciliar-sugeridas" onClick={() => auto.mutate()} loading={auto.isPending} disabled={!withSuggestion}>Conciliar sugeridas</Button>
          </Can>
        }
      />
      <p className="mb-4 text-sm"><Link href="/tesoreria" className="text-accent underline">← Volver a Tesorería</Link></p>
      {auto.error && <ErrorBox error={auto.error} />}
      {undo.error && <ErrorBox error={undo.error} />}

      <div data-tour="ext-resumen" className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Líneas" value={s.summary.lines} hint={`${s.summary.lines - s.summary.pending} resueltas`} />
        <Stat label="Sin conciliar" value={s.summary.pending} tone={s.summary.pending ? 'warning' : undefined} hint={s.summary.pending ? `Neto ${fmtMoney(s.summary.pendingTotal)}` : 'Extracto conciliado'} />
        <Stat label="Neto del extracto" value={fmtMoney(s.summary.bankTotal)} hint="Créditos menos débitos" />
      </div>

      <Card className="mb-6 overflow-hidden" tour="ext-lineas">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Concepto del banco</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">En el sistema</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <LineRows key={l.id} line={l} open={openId === l.id} canAct={can('treasury.move')} onToggle={() => setOpenId(openId === l.id ? null : l.id)} onUndo={() => undo.mutate(l.id)} onDone={done} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 className="mb-1 font-medium">En el sistema y no en el banco</h2>
      <p className="mb-3 text-sm text-muted">Movimientos del período sin conciliar: cheques propios sin debitar, depósitos en tránsito o errores de carga.</p>
      <Card tour="ext-solo-sistema">
        {s.systemOnly.length ? (
          <ul className="divide-y divide-border text-sm">
            {s.systemOnly.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>{fmtDate(m.valueDate)} · {m.concept}</span>
                {signed(m.amount)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted">Todo lo registrado en el período figura en el extracto.</p>
        )}
      </Card>
    </div>
  );
}

function LineRows({
  line: l,
  open,
  canAct,
  onToggle,
  onUndo,
  onDone,
}: {
  line: Line;
  open: boolean;
  canAct: boolean;
  onToggle: () => void;
  onUndo: () => void;
  onDone: (message: string) => (data: Statement) => Promise<void>;
}) {
  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="px-3 py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
        <td className="px-3 py-2">
          {l.description}
          {l.reference && <span className="block text-xs text-muted">{l.reference}</span>}
        </td>
        <td className="px-3 py-2 text-right">{signed(l.amount)}</td>
        <td className="px-3 py-2"><Badge tone={TONES[l.status]}>{STATEMENT_LINE_STATUS_LABELS[l.status]}</Badge></td>
        <td className="px-3 py-2 text-muted">
          {l.movement ? `${fmtDate(l.movement.valueDate)} · ${l.movement.concept}` : l.status === 'IGNORED' ? l.notes : l.suggestions.length ? `${l.suggestions.length} sugerencia${l.suggestions.length > 1 ? 's' : ''}` : 'Sin coincidencias'}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {canAct && l.status === 'PENDING' && <Button data-tour="ext-resolver" size="sm" variant="secondary" onClick={onToggle} aria-expanded={open}>{open ? 'Cerrar' : 'Resolver'}</Button>}
          {canAct && (l.status === 'MATCHED' || l.status === 'IGNORED') && <Button data-tour="ext-deshacer" size="sm" variant="ghost" onClick={onUndo}>Deshacer</Button>}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-surface-2">
          <td colSpan={6} className="px-3 py-3">
            <ResolvePanel line={l} onDone={onDone} />
          </td>
        </tr>
      )}
    </>
  );
}

function ResolvePanel({ line, onDone }: { line: Line; onDone: (message: string) => (data: Statement) => Promise<void> }) {
  const { data: md } = useMasterData();
  const [concept, setConcept] = useState(line.description);
  const [asExpense, setAsExpense] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [reason, setReason] = useState('');
  const isDebit = isNegative(line.amount);

  const match = useMutation({ mutationFn: (movementId: string) => api.post<Statement>(`/treasury/statement-lines/${line.id}/match`, { movementId }), onSuccess: onDone('Línea conciliada.') });
  const create = useMutation({
    mutationFn: () => api.post<Statement>(`/treasury/statement-lines/${line.id}/create`, asExpense ? { concept, categoryId, costCenterId } : { concept }),
    onSuccess: onDone(asExpense ? 'Gasto registrado y conciliado.' : 'Movimiento registrado y conciliado.'),
  });
  const ignore = useMutation({ mutationFn: () => api.post<Statement>(`/treasury/statement-lines/${line.id}/ignore`, { reason }), onSuccess: onDone('Línea ignorada.') });
  const err = match.error ?? create.error ?? ignore.error;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {err && <div className="lg:col-span-3"><ErrorBox error={err} /></div>}
      <div data-tour="ext-resolver-conciliar">
        <p className="mb-2 font-medium">Conciliar con un movimiento</p>
        {line.suggestions.length ? (
          <ul className="flex flex-col gap-2">
            {line.suggestions.map((m) => (
              <li key={m.id}>
                <Button size="sm" variant="secondary" className="h-auto w-full justify-between py-1.5 text-left" loading={match.isPending} onClick={() => match.mutate(m.id)}>
                  <span>{fmtDate(m.valueDate)} · {m.concept}</span>
                  <span className="num">{fmtMoney(m.amount.replace('-', ''))}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No hay movimientos del mismo importe en ±5 días. Si es un gasto o impuesto del banco, registralo.</p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="flex flex-col gap-2"
        data-tour="ext-resolver-registrar"
      >
        <p className="font-medium">Registrar en el sistema</p>
        <Field label="Concepto" htmlFor={`cr-${line.id}`}><Input id={`cr-${line.id}`} required maxLength={300} value={concept} onChange={(e) => setConcept(e.target.value)} /></Field>
        {isDebit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={asExpense} onChange={(e) => setAsExpense(e.target.checked)} /> Registrar como gasto
          </label>
        )}
        {asExpense && (
          <>
            <Field label="Categoría" htmlFor={`cat-${line.id}`}>
              <Select id={`cat-${line.id}`} required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Elegí la categoría</option>
                {(md?.categories ?? []).filter((c) => c.kind === 'EXPENSE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Centro de costo" htmlFor={`cc-${line.id}`}>
              <Select id={`cc-${line.id}`} required value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
                <option value="">Elegí el centro</option>
                {(md?.costCenters ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </Select>
            </Field>
          </>
        )}
        <div><Button type="submit" size="sm" loading={create.isPending}>Registrar</Button></div>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ignore.mutate();
        }}
        className="flex flex-col gap-2"
        data-tour="ext-resolver-ignorar"
      >
        <p className="font-medium">Ignorar</p>
        <Field label="Motivo" htmlFor={`ig-${line.id}`} hint="Por ejemplo, una línea informativa del banco"><Input id={`ig-${line.id}`} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div><Button type="submit" size="sm" variant="secondary" loading={ignore.isPending}>Ignorar línea</Button></div>
      </form>
    </div>
  );
}
