'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Undo2 } from 'lucide-react';
import { dec } from '@erp/domain-core';
import { suggestAllocation } from '@erp/domain-sales';
import { api } from '@/lib/api';
import { ENTRY_TYPES, fmtDate, fmtMoney, isZero, todayISO } from '@/lib/format';
import { Can, useCan } from '@/lib/session';
import { PrintButton } from '@/components/doc-print';
import { Button, Card, ConfirmPanel, ErrorBox, LinkButton, PageHeader, Select, Spinner, Stat } from '@/components/ui';

interface Entry {
  id: string;
  date: string;
  dueDate: string | null;
  description: string;
  entryType: string;
  sourceDocType: string;
  sourceDocId: string;
  amount: string;
  openAmount: string;
  balance: string;
}
interface Ledger {
  party: { legalName: string; code: string; taxId: string } | null;
  balance: string;
  unappliedCredits: string;
  aging: Record<'current' | 'd30' | 'd60' | 'd90' | 'over90', string>;
  entries: Entry[];
  allocations: { id: string; debitEntryId: string; creditEntryId: string; amount: string; createdAt: string; debit?: string; credit?: string }[];
}

const docHref = (e: Entry) =>
  e.sourceDocType === 'FISCAL_DOCUMENT' ? `/ventas/comprobantes/${e.sourceDocId}` : e.sourceDocType.startsWith('CUSTOMER_RECEIPT') ? `/cobros/${e.sourceDocId}` : null;

export default function ReceivableLedgerPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data, isLoading, error } = useQuery({ queryKey: ['ledger-ar', partyId], queryFn: () => api.get<Ledger>(`/accounts/${partyId}?tipo=RECEIVABLE`) });
  const [creditId, setCreditId] = useState('');
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['ledger-ar', partyId] });

  const allocate = useMutation({
    mutationFn: () => {
      const credit = data!.entries.find((e) => e.id === creditId)!;
      const debits = data!.entries.filter((e) => dec(e.openAmount).gt(0));
      const lines = suggestAllocation(debits, dec(credit.openAmount).abs());
      return api.post('/accounts/allocations', { creditEntryId: creditId, allocations: lines.map((l) => ({ entryId: l.id, amount: l.amount.toFixed(2) })) });
    },
    onSuccess: () => { toast.success('Saldo imputado a los comprobantes más antiguos.'); setCreditId(''); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const reverse = useMutation({
    mutationFn: () => api.post(`/accounts/allocations/${reversing}/reverse`, { reason }),
    onSuccess: () => { toast.success('Imputación revertida.'); setReversing(null); setReason(''); refresh(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const credits = data.entries.filter((e) => dec(e.openAmount).lt(0));
  const hasDebits = data.entries.some((e) => dec(e.openAmount).gt(0));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Estado de cuenta · ${data.party?.legalName}`}
        description={`CUIT ${data.party?.taxId} · al ${fmtDate(todayISO())}`}
        actions={
          <div className="print-hide flex gap-2">
            <Can perm="receivables.collect"><LinkButton href={`/cobros/nuevo?cliente=${partyId}`}>Nuevo cobro</LinkButton></Can>
            <PrintButton />
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Saldo" value={fmtMoney(data.balance)} />
        <Stat label="A vencer" value={fmtMoney(data.aging.current)} />
        <Stat label="1–30 días" value={fmtMoney(data.aging.d30)} tone={isZero(data.aging.d30) ? undefined : 'warning'} />
        <Stat label="31–60 días" value={fmtMoney(data.aging.d60)} tone={isZero(data.aging.d60) ? undefined : 'warning'} />
        <Stat label="61–90 días" value={fmtMoney(data.aging.d90)} tone={isZero(data.aging.d90) ? undefined : 'danger'} />
        <Stat label="+90 días" value={fmtMoney(data.aging.over90)} tone={isZero(data.aging.over90) ? undefined : 'danger'} />
      </div>

      {credits.length > 0 && hasDebits && can('receivables.collect') && (
        <Card className="print-hide mb-4 flex flex-wrap items-end gap-3 border-warning/40 p-4">
          <div className="min-w-72 flex-1">
            <p className="text-sm font-medium">Hay {fmtMoney(data.unappliedCredits)} a favor del cliente sin imputar</p>
            <Select aria-label="Saldo a imputar" className="mt-2" value={creditId} onChange={(e) => setCreditId(e.target.value)}>
              <option value="">Elegí el cobro o crédito…</option>
              {credits.map((c) => <option key={c.id} value={c.id}>{c.description} · {fmtMoney(c.openAmount.replace('-', ''))}</option>)}
            </Select>
          </div>
          <Button disabled={!creditId} loading={allocate.isPending} onClick={() => allocate.mutate()}>Imputar por vencimiento</Button>
        </Card>
      )}

      {reversing && (
        <div className="print-hide mb-4">
          <ConfirmPanel
            title="Revertir la imputación"
            impact="El comprobante vuelve a quedar pendiente y el cobro queda a favor del cliente. Si generó comisión, se descuenta."
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Revertir"
            loading={reverse.isPending}
            onConfirm={() => reverse.mutate()}
            onCancel={() => setReversing(null)}
          />
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Comprobante</th>
              <th className="px-3 py-2 text-left">Vence</th>
              <th className="px-3 py-2 text-right">Debe</th>
              <th className="px-3 py-2 text-right">Haber</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2 text-right">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => {
              const href = docHref(e);
              const overdue = e.dueDate && dec(e.openAmount).gt(0) && e.dueDate.slice(0, 10) < todayISO();
              return (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2">{ENTRY_TYPES[e.entryType] ?? e.entryType} · {href ? <Link className="hover:underline" href={href}>{e.description}</Link> : e.description}</td>
                  <td className={`px-3 py-2 ${overdue ? 'text-danger' : ''}`}>{fmtDate(e.dueDate)}</td>
                  <td className="num px-3 py-2 text-right">{e.amount.startsWith('-') ? '' : fmtMoney(e.amount)}</td>
                  <td className="num px-3 py-2 text-right">{e.amount.startsWith('-') ? fmtMoney(e.amount.slice(1)) : ''}</td>
                  <td className="num px-3 py-2 text-right font-medium">{fmtMoney(e.balance)}</td>
                  <td className={`num px-3 py-2 text-right ${isZero(e.openAmount) ? 'text-muted' : ''}`}>{fmtMoney(e.openAmount.replace('-', ''))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-xs text-muted">Debe = facturas y notas de débito. Haber = cobros y notas de crédito. Pendiente = lo que falta imputar de cada comprobante.</p>

      {data.allocations.length > 0 && (
        <Card className="print-hide mt-4 overflow-x-auto">
          <p className="px-3 pt-3 font-medium">Imputaciones vigentes</p>
          <table className="w-full text-sm">
            <tbody>
              {data.allocations.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{fmtDate(a.createdAt)}</td>
                  <td className="px-3 py-2">{a.credit} → {a.debit}</td>
                  <td className="num px-3 py-2 text-right">{fmtMoney(a.amount)}</td>
                  <td className="w-10 px-2 py-2">
                    <Can perm="receivables.collect">
                      <button aria-label="Revertir imputación" title="Revertir imputación" className="text-muted hover:text-danger" onClick={() => setReversing(a.id)}><Undo2 className="size-4" /></button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
