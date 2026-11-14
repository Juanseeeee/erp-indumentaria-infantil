'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, ReceiptText } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Can, useCan, useMasterData } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Card, ConfirmPanel, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Stat, Tabs } from '@/components/ui';
import { RecurringExpenses } from './recurrentes';

interface Expense {
  id: string;
  number: string;
  date: string;
  category: string;
  costCenter: string;
  account: string;
  description: string;
  documentReference: string | null;
  amount: string;
  status: 'POSTED' | 'VOIDED';
}

interface ExpenseList {
  total: number;
  rows: Expense[];
  totalAmount: string;
  byCostCenter: { id: string; code: string; name: string; total: string }[];
  byCategory: { id: string; name: string; total: string }[];
}

interface Account {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  operationBalance: string;
}

const PAYABLE_FROM = ['CASH_BOX', 'BANK', 'WALLET'];
const monthStart = () => `${todayISO().slice(0, 8)}01`;
const share = (part: string, total: string) => (Number(total) > 0 ? `${Math.round((Number(part) / Number(total)) * 100)} %` : '—');

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const categories = (md?.categories ?? []).filter((c) => c.kind === 'EXPENSE');
  const centers = (md?.costCenters ?? []).filter((c) => c.isActive);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [centerFilter, setCenterFilter] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('gastos');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: todayISO(), categoryId: '', costCenterId: '', cashAccountId: '', description: '', documentReference: '', amount: '' });
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [reason, setReason] = useState('');

  const accountsQuery = useQuery({ queryKey: ['treasury-accounts'], queryFn: () => api.get<Account[]>('/treasury/accounts') });
  const accounts = (accountsQuery.data ?? []).filter((a) => a.isActive && PAYABLE_FROM.includes(a.type));
  const list = useQuery({
    queryKey: ['expenses', from, to, centerFilter, page],
    queryFn: () => api.get<ExpenseList>(`/treasury/expenses${qs({ from: from || undefined, to: to || undefined, costCenterId: centerFilter || undefined, page, pageSize: 50 })}`),
  });
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['expenses'] }), queryClient.invalidateQueries({ queryKey: ['treasury-accounts'] })]);
  const create = useMutation({
    mutationFn: () => api.post<Expense>('/treasury/expenses', { ...form, documentReference: form.documentReference || null }),
    onSuccess: async () => {
      setForm((f) => ({ ...f, description: '', documentReference: '', amount: '' }));
      await refresh();
    },
  });
  const voidExpense = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/expenses/${id}/void`, { reason }),
    onSuccess: async () => {
      setVoiding(null);
      setReason('');
      await refresh();
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const data = list.data;
  const columns: ColumnDef<Expense, unknown>[] = [
    { accessorKey: 'number', header: 'Número', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'date', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.date) },
    {
      accessorKey: 'description',
      header: 'Concepto',
      cell: ({ row }) => (
        <span>
          {row.original.description}
          {row.original.documentReference && <span className="block text-xs text-muted">{row.original.documentReference}</span>}
        </span>
      ),
    },
    { accessorKey: 'category', header: 'Categoría' },
    { accessorKey: 'costCenter', header: 'Centro de costo' },
    { accessorKey: 'account', header: 'Pagado desde' },
    { accessorKey: 'amount', header: 'Importe', meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.status === 'VOIDED' ? 'text-muted line-through' : ''}>{fmtMoney(row.original.amount)}</span> },
    {
      id: 'status',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.status === 'VOIDED' ? (
          <Badge tone="danger">Anulado</Badge>
        ) : can('treasury.move') ? (
          <Button data-tour="gas-anular" variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setVoiding(row.original); }}>Anular</Button>
        ) : (
          <Badge tone="success">Registrado</Badge>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Gastos"
        description="Gastos pagados desde caja, banco o billetera, por categoría y centro de costo. Las facturas de proveedores a plazo se cargan en Compras."
        actions={tab === 'gastos' && <Can perm="treasury.move"><Button data-tour="gas-nuevo" onClick={() => setShowForm((v) => !v)}><Plus className="size-4" /> Nuevo gasto</Button></Can>}
      />
      <Tabs tabs={[{ id: 'gastos', label: 'Gastos', tour: 'gas-tab-gastos' }, { id: 'recurrentes', label: 'Recurrentes', tour: 'gas-tab-recurrentes' }]} value={tab} onChange={setTab} />
      {tab === 'recurrentes' ? (
        <RecurringExpenses accounts={accountsQuery.data ?? []} />
      ) : (
        <>
          {list.error && <ErrorBox error={list.error} />}
          {create.error && <ErrorBox error={create.error} />}
          {voidExpense.error && <ErrorBox error={voidExpense.error} />}

          {showForm && (
            <Card className="mb-4 p-4" tour="gas-form">
              <h2 className="mb-3 font-medium">Nuevo gasto</h2>
              {!categories.length || !centers.length ? (
                <p className="text-sm text-muted">Primero cargá categorías de gastos y centros de costo en Configuración.</p>
              ) : (
                <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={submit}>
                  <Field label="Fecha" htmlFor="ex-date" tour="gas-fecha"><Input id="ex-date" type="date" required value={form.date} onChange={set('date')} /></Field>
                  <Field label="Categoría" htmlFor="ex-cat" tour="gas-categoria">
                    <Select id="ex-cat" required value={form.categoryId} onChange={set('categoryId')}>
                      <option value="">Elegí la categoría</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Centro de costo" htmlFor="ex-cc" tour="gas-centro">
                    <Select id="ex-cc" required value={form.costCenterId} onChange={set('costCenterId')}>
                      <option value="">Elegí el centro</option>
                      {centers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Pagado desde" htmlFor="ex-acc" tour="gas-pagado-desde" hint={accounts.find((a) => a.id === form.cashAccountId) ? `Saldo ${fmtMoney(accounts.find((a) => a.id === form.cashAccountId)!.operationBalance)}` : undefined}>
                    <Select id="ex-acc" required value={form.cashAccountId} onChange={set('cashAccountId')}>
                      <option value="">Elegí la cuenta</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Concepto" htmlFor="ex-desc" className="sm:col-span-2" tour="gas-concepto"><Input id="ex-desc" required maxLength={300} value={form.description} onChange={set('description')} /></Field>
                  <Field label="Comprobante" htmlFor="ex-doc" hint="Ticket o factura" tour="gas-comprobante"><Input id="ex-doc" maxLength={100} value={form.documentReference} onChange={set('documentReference')} /></Field>
                  <Field label="Importe" htmlFor="ex-amount" tour="gas-importe"><Input id="ex-amount" required type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} /></Field>
                  <div className="sm:col-span-2 lg:col-span-4"><Button data-tour="gas-registrar" type="submit" loading={create.isPending}>Registrar gasto</Button></div>
                </form>
              )}
            </Card>
          )}

          {voiding && (
            <div className="mb-4" data-tour="gas-motivo-anulacion">
              <ConfirmPanel
                title={`¿Anular el gasto ${voiding.number}?`}
                impact={<>Vuelven {fmtMoney(voiding.amount)} a {voiding.account} con fecha de hoy y el gasto deja de sumar en los totales.</>}
                requireReason
                reason={reason}
                setReason={setReason}
                confirmLabel="Anular gasto"
                loading={voidExpense.isPending}
                onConfirm={() => voidExpense.mutate(voiding.id)}
                onCancel={() => setVoiding(null)}
              />
            </div>
          )}

          <Card className="mb-4 p-4" tour="gas-filtros">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Desde" htmlFor="f-from"><Input id="f-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
              <Field label="Hasta" htmlFor="f-to"><Input id="f-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
              <Field label="Centro de costo" htmlFor="f-cc">
                <Select id="f-cc" value={centerFilter} onChange={(e) => { setCenterFilter(e.target.value); setPage(1); }}>
                  <option value="">Todos</option>
                  {(md?.costCenters ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          {data && (
            <div data-tour="gas-resumen" className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,14rem)_1fr_1fr]">
              <Stat label="Total del período" value={fmtMoney(data.totalAmount)} hint="Sin gastos anulados" />
              <SummaryCard title="Por centro de costo" rows={data.byCostCenter.map((r) => ({ key: r.id, label: `${r.code} · ${r.name}`, total: r.total }))} grand={data.totalAmount} />
              <SummaryCard title="Por categoría" rows={data.byCategory.map((r) => ({ key: r.id, label: r.name, total: r.total }))} grand={data.totalAmount} />
            </div>
          )}

          <DataTable
            id="expenses"
            columns={columns}
            data={data?.rows ?? []}
            total={data?.total}
            page={page}
            pageSize={50}
            onPageChange={setPage}
            loading={list.isLoading}
            empty={<EmptyState icon={<ReceiptText className="size-8" />} title="Sin gastos en el período" description="Registrá los gastos pagados en el momento: fletes, servicios, librería, mantenimiento." />}
          />
        </>
      )}
    </div>
  );
}

function SummaryCard({ title, rows, grand }: { title: string; rows: { key: string; label: string; total: string }[]; grand: string }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-medium text-muted">{title}</h2>
      {rows.length ? (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="py-1.5">{r.label}</td>
                <td className="num py-1.5 text-right">{fmtMoney(r.total)}</td>
                <td className="num w-14 py-1.5 text-right text-muted">{share(r.total, grand)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">Sin gastos.</p>
      )}
    </Card>
  );
}
