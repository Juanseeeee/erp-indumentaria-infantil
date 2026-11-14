'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@erp/contracts';
import { dec, roundMoney } from '@erp/domain-core';
import { suggestAllocation } from '@erp/domain-sales';
import { accountTypesFor } from '@erp/domain-finance';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface Entry {
  id: string;
  description: string;
  date: string;
  dueDate: string | null;
  amount: string;
  openAmount: string;
}
interface Payment {
  method: (typeof PAYMENT_METHODS)[number];
  amount: string;
  reference: string;
  bank: string;
  dueDate: string;
  cashAccountId: string;
  drawerName: string;
}
interface CashAccount {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

const emptyPayment = (method: Payment['method']): Payment => ({ method, amount: '', reference: '', bank: '', dueDate: '', cashAccountId: '', drawerName: '' });

const safe = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? dec(v) : dec(0));

function NewReceipt() {
  const router = useRouter();
  const sp = useSearchParams();
  const [customerId, setCustomerId] = useState(sp.get('cliente') ?? '');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState<Payment[]>([emptyPayment('TRANSFER')]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const key = useRef(crypto.randomUUID());
  const can = useCan();
  const cashAccounts = useQuery({
    queryKey: ['treasury-accounts'],
    queryFn: () => api.get<CashAccount[]>('/treasury/accounts'),
    enabled: can('treasury.view'),
  });
  /** Cuentas donde puede entrar el medio, en el orden en que el servidor elige la predeterminada. */
  const accountsFor = (method: Payment['method']) => {
    const types = accountTypesFor(method);
    return (cashAccounts.data ?? []).filter((a) => a.isActive && types.includes(a.type as never)).sort((a, b) => types.indexOf(a.type as never) - types.indexOf(b.type as never));
  };
  const customers = useQuery({ queryKey: ['parties', 'customers-select'], queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=CUSTOMER&pageSize=200') });
  const open = useQuery({
    queryKey: ['open-items', customerId],
    queryFn: () => api.get<{ debits: Entry[]; credits: Entry[] }>(`/accounts/${customerId}/open?tipo=RECEIVABLE`),
    enabled: !!customerId,
  });
  const total = useMemo(() => roundMoney(payments.reduce((a, p) => a.plus(safe(p.amount)), dec(0))), [payments]);
  const allocated = useMemo(() => roundMoney(Object.values(alloc).reduce((a, v) => a.plus(safe(v)), dec(0))), [alloc]);
  const unapplied = total.minus(allocated);

  const autoAllocate = (amount = total) => {
    const s = suggestAllocation(open.data?.debits ?? [], amount);
    setAlloc(Object.fromEntries(s.map((x) => [x.id, x.amount.toFixed(2)])));
  };
  const setPayment = (i: number, patch: Partial<Payment>) => setPayments((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string }>(
        '/sales/receipts',
        {
          customerId,
          date,
          notes: notes || null,
          payments: payments
            .filter((p) => safe(p.amount).gt(0))
            .map((p) => ({ ...p, reference: p.reference || null, bank: p.bank || null, dueDate: p.dueDate || null, cashAccountId: p.cashAccountId || null, drawerName: p.drawerName || null })),
          allocations: Object.entries(alloc).filter(([, v]) => safe(v).gt(0)).map(([entryId, amount]) => ({ entryId, amount })),
        },
        { idempotencyKey: key.current },
      ),
    onSuccess: (r) => {
      toast.success(`Recibo ${r.number} registrado.`);
      router.push(`/cobros/${r.id}`);
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => f.message).join(' · ') : e.message);
    },
  });

  return (
    <div className="max-w-6xl">
      <PageHeader title="Nuevo cobro" description="Cargá cómo pagó el cliente e imputá a sus comprobantes. Lo que no se impute queda como saldo a favor." />
      <Card className="mb-4 grid gap-4 p-4 sm:grid-cols-3">
        <Field label="Cliente" htmlFor="customer" className="sm:col-span-2" tour="cobro-nuevo-cliente">
          <Select id="customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAlloc({}); }}>
            <option value="">Elegí un cliente…</option>
            {customers.data?.rows.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
          </Select>
        </Field>
        <Field label="Fecha" htmlFor="date" tour="cobro-nuevo-fecha"><Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </Card>

      {customerId && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4" tour="cobro-nuevo-pendientes">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium">Comprobantes pendientes</p>
              <Button data-tour="cobro-nuevo-imputar-auto" variant="secondary" disabled={total.lte(0)} onClick={() => autoAllocate()}>Imputar por vencimiento</Button>
            </div>
            {open.isLoading ? <Spinner /> : !open.data?.debits.length ? (
              <EmptyState title="Sin deuda pendiente" description="El cobro quedará como saldo a favor del cliente." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted uppercase">
                    <th className="py-1 text-left">Comprobante</th>
                    <th className="py-1 text-left">Vence</th>
                    <th className="py-1 text-right">Pendiente</th>
                    <th className="py-1 text-right">Imputar</th>
                  </tr>
                </thead>
                <tbody>
                  {open.data.debits.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <td className="py-1.5">{e.description}</td>
                      <td className={`py-1.5 ${e.dueDate && e.dueDate.slice(0, 10) < todayISO() ? 'text-danger' : ''}`}>{fmtDate(e.dueDate)}</td>
                      <td className="num py-1.5 text-right">{fmtMoney(e.openAmount)}</td>
                      <td className="w-32 py-1 pl-2">
                        <Input
                          aria-label={`Imputar a ${e.description}`}
                          className="num h-8 text-right"
                          inputMode="decimal"
                          value={alloc[e.id] ?? ''}
                          onChange={(ev) => setAlloc({ ...alloc, [e.id]: ev.target.value.replace(',', '.') })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!!open.data?.credits.length && (
              <p className="mt-3 text-xs text-muted">El cliente además tiene saldos a favor sin imputar; se aplican desde su cuenta corriente.</p>
            )}
          </Card>

          <Card className="p-4" tour="cobro-nuevo-medios">
            <p className="mb-2 font-medium">Medios de cobro</p>
            <div className="flex flex-col gap-3">
              {payments.map((p, i) => {
                const cheque = p.method === 'CHEQUE' || p.method === 'ECHEQ';
                const options = cheque || p.method === 'RETENTION' ? [] : accountsFor(p.method);
                return (
                  <div key={i} className="grid grid-cols-[1fr_130px_auto] items-end gap-2 border-b border-border pb-3 last:border-0">
                    <Field label="Medio" htmlFor={`m${i}`}>
                      <Select id={`m${i}`} value={p.method} onChange={(e) => setPayment(i, { method: e.target.value as Payment['method'], cashAccountId: '' })}>
                        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                      </Select>
                    </Field>
                    <Field label="Importe" htmlFor={`a${i}`}><Input id={`a${i}`} className="num text-right" inputMode="decimal" value={p.amount} onChange={(e) => setPayment(i, { amount: e.target.value.replace(',', '.') })} /></Field>
                    <button aria-label="Quitar medio" className="mb-2 text-muted hover:text-danger disabled:opacity-30" disabled={payments.length === 1} onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                    <div className="col-span-3 grid gap-2 sm:grid-cols-3">
                      {options.length > 1 && (
                        <Field label="Ingresa en" htmlFor={`c${i}`}>
                          <Select id={`c${i}`} value={p.cashAccountId || options[0]!.id} onChange={(e) => setPayment(i, { cashAccountId: e.target.value })}>
                            {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </Select>
                        </Field>
                      )}
                      {p.method !== 'CASH' && <Field label={cheque ? 'Número' : 'Referencia'} htmlFor={`r${i}`}><Input id={`r${i}`} value={p.reference} onChange={(e) => setPayment(i, { reference: e.target.value })} /></Field>}
                      {cheque && <Field label="Banco" htmlFor={`b${i}`}><Input id={`b${i}`} value={p.bank} onChange={(e) => setPayment(i, { bank: e.target.value })} /></Field>}
                      {cheque && <Field label="Fecha de pago" htmlFor={`d${i}`}><Input id={`d${i}`} type="date" value={p.dueDate} onChange={(e) => setPayment(i, { dueDate: e.target.value })} /></Field>}
                      {cheque && <Field label="Librador (si no es el cliente)" htmlFor={`l${i}`} className="sm:col-span-2"><Input id={`l${i}`} value={p.drawerName} onChange={(e) => setPayment(i, { drawerName: e.target.value })} /></Field>}
                    </div>
                  </div>
                );
              })}
              <Button data-tour="cobro-nuevo-agregar-medio" variant="ghost" className="self-start" onClick={() => setPayments((ps) => [...ps, emptyPayment('CHEQUE')])}><Plus className="size-4" /> Agregar medio</Button>
            </div>
            <Field label="Observaciones" htmlFor="notes" className="mt-2"><Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm" data-tour="cobro-nuevo-totales">
              <dt className="text-muted">Total cobrado</dt><dd className="num text-right font-semibold">{fmtMoney(total.toFixed(2))}</dd>
              <dt className="text-muted">Imputado</dt><dd className="num text-right">{fmtMoney(allocated.toFixed(2))}</dd>
              <dt className="text-muted">Saldo a favor</dt><dd className={`num text-right ${unapplied.isNegative() ? 'text-danger' : ''}`}>{fmtMoney(unapplied.toFixed(2))}</dd>
            </dl>
            {unapplied.isNegative() && <p className="mt-2 text-sm text-danger">Se imputa más de lo cobrado.</p>}
            <Button data-tour="cobro-nuevo-registrar" className="mt-4 w-full" loading={save.isPending} disabled={total.lte(0) || unapplied.isNegative()} onClick={() => save.mutate()}>Registrar cobro</Button>
            <p className="mt-2 text-xs text-muted">Cada medio ingresa en su caja, banco o billetera; los cheques quedan en la cartera. Las retenciones no mueven fondos.</p>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function NewReceiptPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewReceipt />
    </Suspense>
  );
}
