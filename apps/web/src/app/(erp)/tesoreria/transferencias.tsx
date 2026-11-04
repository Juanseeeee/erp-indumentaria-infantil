'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, isZero, todayISO } from '@/lib/format';
import { Can, useCan } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Card, ConfirmPanel, EmptyState, ErrorBox, Field, Input, Select } from '@/components/ui';

interface Account {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  operationBalance: string;
}

interface Transfer {
  id: string;
  number: string;
  date: string;
  valueDate: string;
  from: string;
  to: string;
  amount: string;
  fee: string;
  received: string;
  concept: string | null;
  status: 'POSTED' | 'VOIDED';
}

/** Transferencias entre cuentas propias: extracciones, depósitos de efectivo y acreditación de tarjetas. */
export function Transfers({ accounts }: { accounts: Account[] }) {
  const queryClient = useQueryClient();
  const can = useCan();
  const usable = accounts.filter((a) => a.isActive && a.type !== 'CHEQUE_PORTFOLIO');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [date, setDate] = useState(todayISO());
  const [valueDate, setValueDate] = useState('');
  const [concept, setConcept] = useState('');
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<Transfer | null>(null);
  const [reason, setReason] = useState('');

  const from = usable.find((a) => a.id === fromId);
  const list = useQuery({
    queryKey: ['treasury-transfers', page],
    queryFn: () => api.get<{ total: number; rows: Transfer[] }>(`/treasury/transfers${qs({ page, pageSize: 50 })}`),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['treasury-transfers'] }),
      queryClient.invalidateQueries({ queryKey: ['treasury-accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['treasury-movements'] }),
    ]);
  const create = useMutation({
    mutationFn: () =>
      api.post<Transfer>('/treasury/transfers', { fromAccountId: fromId, toAccountId: toId, amount, fee: fee || null, date, valueDate: valueDate || null, concept: concept || null }),
    onSuccess: async () => {
      setAmount('');
      setFee('');
      setValueDate('');
      setConcept('');
      await refresh();
    },
  });
  const voidTransfer = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/transfers/${id}/void`, { reason }),
    onSuccess: async () => {
      setVoiding(null);
      setReason('');
      await refresh();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const received = Number(amount || 0) - Number(fee || 0);
  const columns: ColumnDef<Transfer, unknown>[] = [
    { accessorKey: 'number', header: 'Número', cell: ({ row }) => <span className="font-medium">{row.original.number}</span> },
    { accessorKey: 'date', header: 'Fecha', cell: ({ row }) => fmtDate(row.original.date) },
    { accessorKey: 'from', header: 'Desde' },
    { accessorKey: 'to', header: 'Hacia' },
    { accessorKey: 'concept', header: 'Concepto', cell: ({ row }) => row.original.concept ?? '' },
    {
      accessorKey: 'amount',
      header: 'Importe',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span>
          {fmtMoney(row.original.amount)}
          {!isZero(row.original.fee) && <span className="block text-xs text-muted">comisión {fmtMoney(row.original.fee)}</span>}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.status === 'VOIDED' ? (
          <Badge tone="danger">Anulada</Badge>
        ) : can('treasury.move') ? (
          <Button variant="secondary" onClick={(e) => { e.stopPropagation(); setVoiding(row.original); }}>Anular</Button>
        ) : (
          <Badge tone="success">Registrada</Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {create.error && <ErrorBox error={create.error} />}
      {voidTransfer.error && <ErrorBox error={voidTransfer.error} />}
      <Can perm="treasury.move">
        <Card className="p-4">
          <h2 className="mb-3 font-medium">Nueva transferencia</h2>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={submit}>
            <Field label="Desde" htmlFor="tr-from" hint={from ? `Saldo ${fmtMoney(from.operationBalance)}` : undefined}>
              <Select id="tr-from" required value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">Elegí la cuenta</option>
                {usable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Hacia" htmlFor="tr-to">
              <Select id="tr-to" required value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">Elegí la cuenta</option>
                {usable.filter((a) => a.id !== fromId && a.type !== 'CARD_CLEARING').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Importe" htmlFor="tr-amount">
              <Input id="tr-amount" required type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Comisión" htmlFor="tr-fee" hint="Se descuenta de lo que llega">
              <Input id="tr-fee" type="number" min="0" step="0.01" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
            <Field label="Fecha" htmlFor="tr-date">
              <Input id="tr-date" required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Disponible desde" htmlFor="tr-value" hint="Si se acredita otro día">
              <Input id="tr-value" type="date" min={date} value={valueDate} onChange={(e) => setValueDate(e.target.value)} />
            </Field>
            <Field label="Concepto" htmlFor="tr-concept" className="sm:col-span-2">
              <Input id="tr-concept" maxLength={300} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Extracción para caja, liquidación de tarjetas…" />
            </Field>
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
              <Button type="submit" loading={create.isPending}>Transferir</Button>
              {Number(fee) > 0 && received > 0 && <span className="text-sm text-muted">Llegan {fmtMoney(received.toFixed(2))}</span>}
            </div>
          </form>
        </Card>
      </Can>

      {voiding && (
        <ConfirmPanel
          title={`¿Anular la transferencia ${voiding.number}?`}
          impact={<>Vuelven {fmtMoney(voiding.amount)} a {voiding.from} y salen {fmtMoney(voiding.received)} de {voiding.to}, con fecha de hoy.</>}
          requireReason
          reason={reason}
          setReason={setReason}
          confirmLabel="Anular transferencia"
          loading={voidTransfer.isPending}
          onConfirm={() => voidTransfer.mutate(voiding.id)}
          onCancel={() => setVoiding(null)}
        />
      )}

      <DataTable
        id="treasury-transfers"
        columns={columns}
        data={list.data?.rows ?? []}
        total={list.data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        loading={list.isLoading}
        empty={<EmptyState icon={<ArrowLeftRight className="size-8" />} title="Sin transferencias" description="Las extracciones, depósitos de efectivo y acreditaciones de tarjetas aparecerán aquí." />}
      />
    </div>
  );
}
