'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Calculator } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, isNegative, isZero, todayISO } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Stat, Textarea } from '@/components/ui';

interface Account {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface Preview {
  expected: string;
  lastClosing: { closingDate: string; counted: string; difference: string } | null;
  incomeSinceLast: string;
  outcomeSinceLast: string;
  movementsSinceLast: number;
}

interface Closing {
  id: string;
  closingDate: string;
  account: string;
  expected: string;
  counted: string;
  difference: string;
  notes: string | null;
  closedBy: string | null;
  createdAt: string;
}

const differenceBadge = (d: string) =>
  isZero(d) ? <Badge tone="success">Cuadra</Badge> : isNegative(d) ? <Badge tone="danger">Faltan {fmtMoney(d.slice(1))}</Badge> : <Badge tone="warning">Sobran {fmtMoney(d)}</Badge>;

/** Arqueo de caja: se cuenta el efectivo, se compara con el sistema y la diferencia queda registrada. */
export function CashClosings({ accounts }: { accounts: Account[] }) {
  const queryClient = useQueryClient();
  const boxes = accounts.filter((a) => a.type === 'CASH_BOX' && a.isActive);
  const [selected, setSelected] = useState('');
  const accountId = boxes.some((b) => b.id === selected) ? selected : boxes[0]?.id ?? '';
  const [date, setDate] = useState(todayISO());
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [page, setPage] = useState(1);
  const [done, setDone] = useState<Closing | null>(null);

  const preview = useQuery({
    queryKey: ['closing-preview', accountId, date],
    queryFn: () => api.get<Preview>(`/treasury/accounts/${accountId}/closing-preview${qs({ date })}`),
    enabled: Boolean(accountId && date),
  });
  const list = useQuery({
    queryKey: ['cash-closings', page],
    queryFn: () => api.get<{ total: number; rows: Closing[] }>(`/treasury/cash-closings${qs({ page, pageSize: 50 })}`),
  });
  const create = useMutation({
    mutationFn: () => api.post<Closing>('/treasury/cash-closings', { cashAccountId: accountId, date, counted, notes: notes || null }),
    onSuccess: async (closing) => {
      setDone(closing);
      setCounted('');
      setNotes('');
      await Promise.all(['cash-closings', 'closing-preview', 'treasury-accounts', 'treasury-movements'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setDone(null);
    create.mutate();
  }

  const p = preview.data;
  const difference = p && counted !== '' ? (Number(counted) - Number(p.expected)).toFixed(2) : null;
  const columns: ColumnDef<Closing, unknown>[] = [
    { accessorKey: 'closingDate', header: 'Fecha', cell: ({ row }) => <span className="font-medium">{fmtDate(row.original.closingDate)}</span> },
    { accessorKey: 'account', header: 'Caja' },
    { accessorKey: 'expected', header: 'Según sistema', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.expected) },
    { accessorKey: 'counted', header: 'Contado', meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.counted) },
    { accessorKey: 'difference', header: 'Diferencia', cell: ({ row }) => differenceBadge(row.original.difference) },
    { accessorKey: 'closedBy', header: 'Hecho por', cell: ({ row }) => <span>{row.original.closedBy}<span className="block text-xs text-muted">{fmtDateTime(row.original.createdAt)}</span></span> },
    { accessorKey: 'notes', header: 'Observaciones', cell: ({ row }) => row.original.notes ?? '' },
  ];

  return (
    <div className="flex flex-col gap-4">
      {preview.error && <ErrorBox error={preview.error} />}
      {create.error && <ErrorBox error={create.error} />}
      {boxes.length ? (
        <Can perm="treasury.move">
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Nuevo arqueo</h2>
            <form className="grid gap-4 lg:grid-cols-[1fr_1fr]" onSubmit={submit}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Caja" htmlFor="cl-box">
                  <Select id="cl-box" value={accountId} onChange={(e) => setSelected(e.target.value)}>
                    {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="Fecha" htmlFor="cl-date">
                  <Input id="cl-date" type="date" required max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Efectivo contado" htmlFor="cl-counted">
                  <Input id="cl-counted" required type="number" min="0" step="0.01" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
                </Field>
                <Field label="Observaciones" htmlFor="cl-notes" className="sm:col-span-2">
                  <Textarea id="cl-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" loading={create.isPending} disabled={!p}>Registrar arqueo</Button>
                </div>
              </div>
              {p && (
                <div className="grid content-start gap-3 sm:grid-cols-2">
                  <Stat label="Según sistema" value={fmtMoney(p.expected)} hint={p.lastClosing ? `Último arqueo ${fmtDate(p.lastClosing.closingDate)}: ${fmtMoney(p.lastClosing.counted)}` : 'Primer arqueo de esta caja'} />
                  <Stat label="Diferencia" value={difference == null ? '—' : fmtMoney(difference)} tone={difference == null || isZero(difference) ? undefined : isNegative(difference) ? 'danger' : 'warning'} hint={difference == null ? 'Ingresá el conteo' : isZero(difference) ? 'Cuadra' : isNegative(difference) ? 'Faltante' : 'Sobrante'} />
                  <Stat label="Ingresos desde el último" value={fmtMoney(p.incomeSinceLast)} hint={`${p.movementsSinceLast} movimientos`} />
                  <Stat label="Egresos desde el último" value={fmtMoney(p.outcomeSinceLast)} />
                  <p className="text-sm text-muted sm:col-span-2">La diferencia se registra como movimiento de ajuste. Después del arqueo, la caja no admite movimientos con fecha anterior.</p>
                </div>
              )}
            </form>
            {done && <p className="mt-3 text-sm" role="status">Arqueo registrado: {differenceBadge(done.difference)}</p>}
          </Card>
        </Can>
      ) : (
        <Card>
          <EmptyState icon={<Calculator className="size-8" />} title="Sin cajas" description="Creá una caja en la pestaña Cuentas para poder arquearla." />
        </Card>
      )}
      <DataTable
        id="cash-closings"
        columns={columns}
        data={list.data?.rows ?? []}
        total={list.data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={list.isLoading}
        empty={<EmptyState icon={<Calculator className="size-8" />} title="Sin arqueos" description="Contá el efectivo de la caja y registrá el arqueo." />}
      />
    </div>
  );
}
