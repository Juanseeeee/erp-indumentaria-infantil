'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote } from 'lucide-react';
import { CHEQUE_PRESENTATION_DAYS, allowedChequeEvents, type ChequeStatus } from '@erp/domain-finance';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Spinner, Stat, Tabs } from '@/components/ui';

interface Cheque {
  id: string;
  ownership: 'THIRD' | 'OWN';
  isEcheq: boolean;
  bank: string;
  number: string;
  amount: string;
  paymentDate: string;
  drawerName: string | null;
  status: ChequeStatus;
  statusLabel: string;
  account: string | null;
  receivedFrom: string | null;
  deliveredTo: string | null;
}
interface ChequeList {
  total: number;
  rows: Cheque[];
  summary: { status: ChequeStatus; label: string; count: number; amount: string }[];
}
interface BankAccount {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

const FILTERS = {
  THIRD: [
    { id: 'IN_PORTFOLIO', label: 'En cartera' },
    { id: 'DEPOSITED', label: 'Depositados' },
    { id: 'CREDITED', label: 'Acreditados' },
    { id: 'DELIVERED', label: 'Endosados' },
    { id: 'REJECTED', label: 'Rechazados' },
    { id: '', label: 'Todos' },
  ],
  OWN: [
    { id: 'ISSUED', label: 'Emitidos' },
    { id: 'DEBITED', label: 'Debitados' },
    { id: 'VOIDED', label: 'Anulados' },
    { id: '', label: 'Todos' },
  ],
};
const TONE: Partial<Record<ChequeStatus, 'accent' | 'success' | 'warning' | 'danger'>> = {
  IN_PORTFOLIO: 'accent',
  DEPOSITED: 'warning',
  CREDITED: 'success',
  REJECTED: 'danger',
  ISSUED: 'warning',
  DEBITED: 'success',
};

const daysFrom = (iso: string) => Math.round((new Date(`${todayISO()}T00:00:00Z`).getTime() - new Date(iso).getTime()) / 86_400_000);

type Action = { cheque: Cheque; kind: 'DEPOSIT' | 'CREDIT' | 'REJECT' | 'DEBIT' };

export function ChequePortfolio({ banks }: { banks: BankAccount[] }) {
  const qc = useQueryClient();
  const can = useCan();
  const [ownership, setOwnership] = useState<'THIRD' | 'OWN'>('THIRD');
  const [status, setStatus] = useState('IN_PORTFOLIO');
  const [action, setAction] = useState<Action | null>(null);
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('');

  const list = useQuery({
    queryKey: ['cheques', ownership, status],
    queryFn: () => api.get<ChequeList>(`/treasury/cheques?ownership=${ownership}&pageSize=200${status ? `&status=${status}` : ''}`),
  });
  const activeBanks = banks.filter((b) => b.type === 'BANK' && b.isActive);
  const sum = (s: ChequeStatus) => list.data?.summary.find((x) => x.status === s);

  const run = useMutation({
    mutationFn: ({ cheque, kind }: Action) => {
      if (kind === 'DEPOSIT') return api.post(`/treasury/cheques/${cheque.id}/deposit`, { bankAccountId: bankId || activeBanks[0]?.id, date });
      if (kind === 'CREDIT') return api.post(`/treasury/cheques/${cheque.id}/credit`, { date });
      if (kind === 'DEBIT') return api.post(`/treasury/cheques/${cheque.id}/debit`, { date });
      return api.post(`/treasury/cheques/${cheque.id}/reject`, { date, reason, bankFee: fee || null });
    },
    onSuccess: async (_, a) => {
      toast.success(
        a.kind === 'DEPOSIT' ? 'Cheque depositado.' : a.kind === 'CREDIT' ? 'Acreditación registrada.' : a.kind === 'DEBIT' ? 'Débito registrado.' : 'Rechazo registrado: se debitó al cliente.',
      );
      setAction(null);
      setReason('');
      setFee('');
      await Promise.all([qc.invalidateQueries({ queryKey: ['cheques'] }), qc.invalidateQueries({ queryKey: ['treasury-accounts'] }), qc.invalidateQueries({ queryKey: ['treasury-movements'] })]);
    },
  });

  const open = (cheque: Cheque, kind: Action['kind']) => {
    run.reset();
    setDate(todayISO());
    setAction({ cheque, kind });
  };

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(['THIRD', 'OWN'] as const).map((o) => (
          <Button
            key={o}
            variant={ownership === o ? 'primary' : 'secondary'}
            aria-pressed={ownership === o}
            onClick={() => { setOwnership(o); setStatus(FILTERS[o][0]!.id); setAction(null); }}
          >
            {o === 'THIRD' ? 'De terceros' : 'Propios'}
          </Button>
        ))}
      </div>
      {ownership === 'OWN' ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Stat label="Emitidos sin debitar" value={fmtMoney(sum('ISSUED')?.amount ?? '0')} hint={`${sum('ISSUED')?.count ?? 0} cheques`} tone={sum('ISSUED') ? 'warning' : undefined} />
          <Stat label="Debitados" value={fmtMoney(sum('DEBITED')?.amount ?? '0')} hint={`${sum('DEBITED')?.count ?? 0} cheques`} />
        </div>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="En cartera" value={fmtMoney(sum('IN_PORTFOLIO')?.amount ?? '0')} hint={`${sum('IN_PORTFOLIO')?.count ?? 0} cheques`} />
          <Stat label="Depositados sin acreditar" value={fmtMoney(sum('DEPOSITED')?.amount ?? '0')} hint={`${sum('DEPOSITED')?.count ?? 0} cheques`} tone={sum('DEPOSITED') ? 'warning' : undefined} />
          <Stat label="Rechazados" value={fmtMoney(sum('REJECTED')?.amount ?? '0')} hint={`${sum('REJECTED')?.count ?? 0} cheques`} tone={sum('REJECTED') ? 'danger' : undefined} />
        </div>
      )}
      <Tabs tabs={FILTERS[ownership]} value={status} onChange={(s) => { setStatus(s); setAction(null); }} />
      {list.error && <ErrorBox error={list.error} />}

      {action && (
        <Card className="mb-4 p-4">
          <p className="font-medium">
            {action.kind === 'DEPOSIT' ? 'Depositar' : action.kind === 'CREDIT' ? 'Registrar acreditación de' : action.kind === 'DEBIT' ? 'Registrar el débito de' : 'Registrar rechazo de'} {action.cheque.isEcheq ? 'e-cheq' : 'cheque'} {action.cheque.bank} n.º {action.cheque.number} · {fmtMoney(action.cheque.amount)}
          </p>
          <p className="mt-1 text-sm text-muted">
            {action.kind === 'DEPOSIT' && 'Sale de la cartera. Suma al banco recién cuando se registra la acreditación.'}
            {action.kind === 'CREDIT' && 'El importe pasa a formar parte del saldo del banco.'}
            {action.kind === 'DEBIT' && 'Confirma que el banco lo pagó. El egreso ya figura en el banco a la fecha de pago del cheque.'}
            {action.kind === 'REJECT' &&
              `Se debita al cliente${action.cheque.receivedFrom ? ` (${action.cheque.receivedFrom})` : ''} el importe más el gasto bancario, con vencimiento en el día.${action.cheque.status === 'DELIVERED' ? ` La deuda con ${action.cheque.deliveredTo ?? 'el proveedor'} vuelve a quedar pendiente.` : ''}`}
          </p>
          {run.error && <div className="mt-3"><ErrorBox error={run.error} /></div>}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {action.kind === 'DEPOSIT' && (
              <Field label="Banco" htmlFor="ch-bank">
                <Select id="ch-bank" value={bankId || activeBanks[0]?.id || ''} onChange={(e) => setBankId(e.target.value)}>
                  {activeBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Fecha" htmlFor="ch-date"><Input id="ch-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            {action.kind === 'REJECT' && (
              <>
                <Field label="Motivo" htmlFor="ch-reason"><Input id="ch-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sin fondos, firma…" /></Field>
                {action.cheque.status === 'DEPOSITED' && (
                  <Field label="Gasto bancario" htmlFor="ch-fee"><Input id="ch-fee" className="num text-right" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(',', '.'))} /></Field>
                )}
              </>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              variant={action.kind === 'REJECT' ? 'danger' : 'primary'}
              loading={run.isPending}
              disabled={(action.kind === 'DEPOSIT' && !activeBanks.length) || (action.kind === 'REJECT' && reason.trim().length < 3)}
              onClick={() => run.mutate(action)}
            >
              Confirmar
            </Button>
            <Button variant="secondary" onClick={() => setAction(null)}>Cancelar</Button>
          </div>
          {action.kind === 'DEPOSIT' && !activeBanks.length && <p className="mt-2 text-sm text-danger">No hay cuentas bancarias activas.</p>}
        </Card>
      )}

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.rows.length ? (
          <EmptyState
            icon={<Banknote className="size-8" />}
            title="Sin cheques"
            description={ownership === 'THIRD' ? 'Los cheques que entran con los cobros aparecen aquí.' : 'Los cheques propios se emiten desde una orden de pago.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-left text-muted">
                <tr>
                  <th className="px-3 py-2">Pago</th>
                  <th className="px-3 py-2">Cheque</th>
                  {ownership === 'THIRD' && <th className="px-3 py-2">Librador</th>}
                  <th className="px-3 py-2">{ownership === 'THIRD' ? 'Recibido de / entregado a' : 'Entregado a'}</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Importe</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((c) => {
                  const events = allowedChequeEvents(c.ownership, c.status);
                  const age = daysFrom(c.paymentDate);
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDate(c.paymentDate)}
                        {c.status === 'IN_PORTFOLIO' && age < 0 && <span className="block text-xs text-muted">en {-age} días</span>}
                        {c.status === 'IN_PORTFOLIO' && age >= 0 && age <= CHEQUE_PRESENTATION_DAYS && (
                          <span className={`block text-xs ${age > CHEQUE_PRESENTATION_DAYS - 5 ? 'text-danger' : 'text-success'}`}>
                            {age > CHEQUE_PRESENTATION_DAYS - 5 ? `quedan ${CHEQUE_PRESENTATION_DAYS - age} días para presentarlo` : 'para depositar'}
                          </span>
                        )}
                        {c.status === 'IN_PORTFOLIO' && age > CHEQUE_PRESENTATION_DAYS && <span className="block text-xs text-danger">plazo vencido</span>}
                      </td>
                      <td className="px-3 py-2">{c.isEcheq ? 'E-cheq' : 'Cheque'} {c.bank} n.º {c.number}</td>
                      {ownership === 'THIRD' && <td className="px-3 py-2">{c.drawerName ?? '—'}</td>}
                      <td className="px-3 py-2">
                        {ownership === 'THIRD' ? (c.receivedFrom ?? '—') : (c.deliveredTo ?? '—')}
                        {ownership === 'THIRD' && c.deliveredTo && <span className="block text-xs text-muted">→ {c.deliveredTo}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={TONE[c.status]}>{c.statusLabel}</Badge>
                        {c.account && c.status !== 'IN_PORTFOLIO' && c.status !== 'DELIVERED' && <span className="block text-xs text-muted">{c.account}</span>}
                      </td>
                      <td className="num px-3 py-2 text-right">{fmtMoney(c.amount)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {can('treasury.move') && (
                          <div className="flex justify-end gap-1">
                            {events.includes('DEPOSIT') && <Button variant="secondary" onClick={() => open(c, 'DEPOSIT')}>Depositar</Button>}
                            {events.includes('CREDIT') && <Button variant="secondary" onClick={() => open(c, 'CREDIT')}>Acreditado</Button>}
                            {events.includes('REJECT') && <Button variant="ghost" onClick={() => open(c, 'REJECT')}>Rechazo</Button>}
                            {events.includes('DEBIT') && <Button variant="secondary" onClick={() => open(c, 'DEBIT')}>Debitado</Button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-muted">
        Los cheques se depositan desde su fecha de pago y dentro de los {CHEQUE_PRESENTATION_DAYS} días siguientes. Para devolver un cheque al cliente, anulá el <Link className="underline" href="/cobros">cobro</Link> mientras siga en cartera.
      </p>
    </div>
  );
}
