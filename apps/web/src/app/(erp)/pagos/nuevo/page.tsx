'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { SUPPLIER_PAYMENT_METHODS, SUPPLIER_PAYMENT_METHOD_LABELS } from '@erp/contracts';
import { dec, roundMoney } from '@erp/domain-core';
import { suggestAllocation } from '@erp/domain-sales';
import { accountTypesFor, suggestCheques } from '@erp/domain-finance';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

type Method = (typeof SUPPLIER_PAYMENT_METHODS)[number];
interface Entry {
  id: string;
  description: string;
  date: string;
  dueDate: string | null;
  openAmount: string;
}
interface Line {
  method: Method;
  amount: string;
  cashAccountId: string;
  chequeId: string;
  reference: string;
  paymentDate: string;
}
interface CashAccount {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  operationBalance: string;
}
interface Cheque {
  id: string;
  bank: string;
  number: string;
  amount: string;
  paymentDate: string;
  drawerName: string | null;
  isEcheq: boolean;
}

const safe = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? dec(v) : dec(0));
const emptyLine = (method: Method): Line => ({ method, amount: '', cashAccountId: '', chequeId: '', reference: '', paymentDate: '' });
const isOwn = (m: Method) => m === 'OWN_CHEQUE' || m === 'OWN_ECHEQ';

function NewPayment() {
  const router = useRouter();
  const sp = useSearchParams();
  const [supplierId, setSupplierId] = useState(sp.get('proveedor') ?? '');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine('TRANSFER')]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const key = useRef(crypto.randomUUID());

  const suppliers = useQuery({
    queryKey: ['parties', 'payees-select'],
    queryFn: async () => {
      const [s, w] = await Promise.all([
        api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=SUPPLIER&pageSize=200'),
        api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=WORKSHOP&pageSize=200'),
      ]);
      const all = new Map([...s.rows, ...w.rows].map((p) => [p.id, p]));
      return [...all.values()].sort((a, b) => a.legalName.localeCompare(b.legalName));
    },
  });
  const open = useQuery({
    queryKey: ['open-items', supplierId, 'PAYABLE'],
    queryFn: () => api.get<{ debits: Entry[]; credits: Entry[] }>(`/accounts/${supplierId}/open?tipo=PAYABLE`),
    enabled: !!supplierId,
  });
  const accounts = useQuery({ queryKey: ['treasury-accounts'], queryFn: () => api.get<CashAccount[]>('/treasury/accounts') });
  const portfolio = useQuery({
    queryKey: ['cheques', 'IN_PORTFOLIO'],
    queryFn: () => api.get<{ rows: Cheque[] }>('/treasury/cheques?ownership=THIRD&status=IN_PORTFOLIO&pageSize=200'),
  });

  const chequeById = (id: string) => portfolio.data?.rows.find((c) => c.id === id);
  const amountOf = (l: Line) => (l.method === 'THIRD_CHEQUE' ? safe(chequeById(l.chequeId)?.amount ?? '0') : safe(l.amount));
  const total = roundMoney(lines.reduce((a, l) => a.plus(amountOf(l)), dec(0)));
  const allocated = useMemo(() => roundMoney(Object.values(alloc).reduce((a, v) => a.plus(safe(v)), dec(0))), [alloc]);
  const unapplied = total.minus(allocated);
  const usedCheques = new Set(lines.map((l) => l.chequeId).filter(Boolean));

  const accountsFor = (m: Method) => {
    const types = accountTypesFor(m);
    return (accounts.data ?? []).filter((a) => a.isActive && types.includes(a.type as never)).sort((a, b) => types.indexOf(a.type as never) - types.indexOf(b.type as never));
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** Completa con cheques de cartera lo que falta para cubrir lo imputado (los que vencen primero). */
  const suggest = () => {
    const others = lines.filter((l) => l.method !== 'THIRD_CHEQUE' && safe(l.amount).gt(0));
    const covered = others.reduce((a, l) => a.plus(safe(l.amount)), dec(0));
    const target = allocated.minus(covered);
    if (target.lte(0)) return toast.info('Lo imputado ya está cubierto con los otros medios.');
    const picked = suggestCheques(portfolio.data?.rows ?? [], target);
    if (!picked.length) return toast.info('No hay cheques en cartera.');
    setLines([...others, ...picked.map((c) => ({ ...emptyLine('THIRD_CHEQUE'), chequeId: c.id }))]);
  };

  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string; status: string }>(
        '/treasury/payments',
        {
          supplierId,
          date,
          notes: notes || null,
          payments: lines
            .filter((l) => (l.method === 'THIRD_CHEQUE' ? !!l.chequeId : safe(l.amount).gt(0)))
            .map((l) => ({
              method: l.method,
              amount: l.method === 'THIRD_CHEQUE' ? null : l.amount,
              chequeId: l.chequeId || null,
              cashAccountId: l.cashAccountId || (isOwn(l.method) ? accountsFor(l.method)[0]?.id : null) || null,
              reference: l.reference || null,
              paymentDate: l.paymentDate || null,
            })),
          allocations: Object.entries(alloc).filter(([, v]) => safe(v).gt(0)).map(([entryId, amount]) => ({ entryId, amount })),
        },
        { idempotencyKey: key.current },
      ),
    onSuccess: (p) => {
      toast.success(p.status === 'PENDING_APPROVAL' ? `Orden de pago ${p.number} enviada a aprobación: todavía no se pagó.` : `Orden de pago ${p.number} registrada.`);
      router.push(`/pagos/${p.id}`);
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => f.message).join(' · ') : e.message);
    },
  });

  return (
    <div className="max-w-6xl">
      <PageHeader title="Nueva orden de pago" description="Elegí qué facturas se pagan y con qué medios. Lo que no se impute queda como anticipo al proveedor." />
      <Card className="mb-4 grid gap-4 p-4 sm:grid-cols-3">
        <Field label="Proveedor o taller" htmlFor="supplier" className="sm:col-span-2" tour="op-nueva-proveedor">
          <Select id="supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setAlloc({}); }}>
            <option value="">Elegí un proveedor…</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
          </Select>
        </Field>
        <Field label="Fecha" htmlFor="date" tour="op-nueva-fecha"><Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </Card>

      {supplierId && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4" tour="op-nueva-comprobantes">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-medium">Comprobantes a pagar</p>
              <Button
                data-tour="op-nueva-pagar-todo"
                variant="secondary"
                disabled={!open.data?.debits.length}
                onClick={() => setAlloc(Object.fromEntries((open.data?.debits ?? []).map((d) => [d.id, d.openAmount])))}
              >
                Pagar todo
              </Button>
            </div>
            {open.isLoading ? <Spinner /> : !open.data?.debits.length ? (
              <EmptyState title="Sin deuda pendiente" description="El pago quedará como anticipo al proveedor." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted uppercase">
                    <th className="py-1 text-left">Comprobante</th>
                    <th className="py-1 text-left">Vence</th>
                    <th className="py-1 text-right">Pendiente</th>
                    <th className="py-1 text-right">Pagar</th>
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
                          data-tour="op-nueva-pagar-monto"
                          aria-label={`Pagar ${e.description}`}
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
            {total.gt(0) && !!open.data?.debits.length && (
              <Button data-tour="op-nueva-imputar-vencimiento" variant="ghost" className="mt-2" onClick={() => setAlloc(Object.fromEntries(suggestAllocation(open.data!.debits, total).map((x) => [x.id, x.amount.toFixed(2)])))}>
                Imputar el total por vencimiento
              </Button>
            )}
          </Card>

          <Card className="p-4" tour="op-nueva-medios">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-medium">Medios de pago</p>
              <Button data-tour="op-nueva-sugerir-cheques" variant="secondary" disabled={allocated.lte(0) || !portfolio.data?.rows.length} onClick={suggest}>Sugerir cheques de cartera</Button>
            </div>
            <div className="flex flex-col gap-3">
              {lines.map((l, i) => {
                const options = accountsFor(l.method);
                const cheque = chequeById(l.chequeId);
                return (
                  <div key={i} className="grid grid-cols-[1fr_130px_auto] items-end gap-2 border-b border-border pb-3 last:border-0">
                    <Field label="Medio" htmlFor={`m${i}`} tour="op-nueva-medio">
                      <Select id={`m${i}`} value={l.method} onChange={(e) => setLine(i, { ...emptyLine(e.target.value as Method), amount: l.amount })}>
                        {SUPPLIER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{SUPPLIER_PAYMENT_METHOD_LABELS[m]}</option>)}
                      </Select>
                    </Field>
                    <Field label="Importe" htmlFor={`a${i}`} tour="op-nueva-importe">
                      {l.method === 'THIRD_CHEQUE' ? (
                        <Input id={`a${i}`} className="num text-right" readOnly value={cheque ? fmtMoney(cheque.amount) : ''} />
                      ) : (
                        <Input id={`a${i}`} className="num text-right" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value.replace(',', '.') })} />
                      )}
                    </Field>
                    <button aria-label="Quitar medio" className="mb-2 text-muted hover:text-danger disabled:opacity-30" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                    <div className="col-span-3 grid gap-2 sm:grid-cols-3">
                      {l.method === 'THIRD_CHEQUE' && (
                        <Field label="Cheque" htmlFor={`ch${i}`} className="sm:col-span-3" tour="op-nueva-cheque">
                          <Select id={`ch${i}`} value={l.chequeId} onChange={(e) => setLine(i, { chequeId: e.target.value })}>
                            <option value="">Elegí un cheque en cartera…</option>
                            {portfolio.data?.rows.filter((c) => c.id === l.chequeId || !usedCheques.has(c.id)).map((c) => (
                              <option key={c.id} value={c.id}>
                                {fmtDate(c.paymentDate)} · {c.bank} n.º {c.number} · {fmtMoney(c.amount)}{c.drawerName ? ` · ${c.drawerName}` : ''}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      {l.method !== 'THIRD_CHEQUE' && l.method !== 'RETENTION' && options.length > 1 && (
                        <Field label={isOwn(l.method) ? 'Banco' : 'Sale de'} htmlFor={`c${i}`} tour="op-nueva-cuenta">
                          <Select id={`c${i}`} value={l.cashAccountId || options[0]!.id} onChange={(e) => setLine(i, { cashAccountId: e.target.value })}>
                            {options.map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtMoney(a.operationBalance)})</option>)}
                          </Select>
                        </Field>
                      )}
                      {l.method !== 'CASH' && l.method !== 'THIRD_CHEQUE' && (
                        <Field label={isOwn(l.method) ? 'Número' : l.method === 'RETENTION' ? 'Certificado' : 'Referencia'} htmlFor={`r${i}`} tour="op-nueva-referencia">
                          <Input id={`r${i}`} value={l.reference} onChange={(e) => setLine(i, { reference: e.target.value })} />
                        </Field>
                      )}
                      {isOwn(l.method) && (
                        <Field label="Fecha de pago" htmlFor={`d${i}`} tour="op-nueva-fecha-pago"><Input id={`d${i}`} type="date" value={l.paymentDate} onChange={(e) => setLine(i, { paymentDate: e.target.value })} /></Field>
                      )}
                    </div>
                  </div>
                );
              })}
              <Button data-tour="op-nueva-agregar-medio" variant="ghost" className="self-start" onClick={() => setLines((ls) => [...ls, emptyLine('THIRD_CHEQUE')])}><Plus className="size-4" /> Agregar medio</Button>
            </div>
            <Field label="Observaciones" htmlFor="notes" className="mt-2"><Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <dl data-tour="op-nueva-totales" className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Total pagado</dt><dd className="num text-right font-semibold">{fmtMoney(total.toFixed(2))}</dd>
              <dt className="text-muted">Imputado</dt><dd className="num text-right">{fmtMoney(allocated.toFixed(2))}</dd>
              <dt className="text-muted">Anticipo</dt><dd className={`num text-right ${unapplied.isNegative() ? 'text-danger' : ''}`}>{fmtMoney(unapplied.toFixed(2))}</dd>
            </dl>
            {unapplied.isNegative() && <p className="mt-2 text-sm text-danger">Se imputa más de lo pagado.</p>}
            <Button data-tour="op-nueva-registrar" className="mt-4 w-full" loading={save.isPending} disabled={total.lte(0) || unapplied.isNegative()} onClick={() => save.mutate()}>Registrar pago</Button>
            <p className="mt-2 text-xs text-muted">Los cheques de cartera se endosan por su importe total. Un cheque propio baja el saldo del banco a su fecha de pago.</p>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function NewPaymentPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewPayment />
    </Suspense>
  );
}
