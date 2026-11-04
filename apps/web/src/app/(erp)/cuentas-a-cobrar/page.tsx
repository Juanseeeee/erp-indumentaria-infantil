'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, isZero } from '@/lib/format';
import { Card, EmptyState, PageHeader, Spinner, Stat } from '@/components/ui';

interface Row {
  party_id: string;
  legal_name: string;
  code: string;
  balance: string;
  overdue: string;
  over60: string;
  credits: string;
  next_due: string | null;
}

/** Suma de strings decimales para los totales del encabezado, en centavos enteros (sin floats). */
const sumCents = (vals: string[]) => {
  const cents = vals.reduce((a, v) => {
    const [i, f = ''] = v.replace('-', '').split('.');
    const n = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
    return a + (v.startsWith('-') ? -n : n);
  }, 0n);
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

export default function ReceivablesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['receivables'], queryFn: () => api.get<Row[]>('/accounts/balances?tipo=RECEIVABLE') });
  if (isLoading) return <Spinner />;
  return (
    <div className="max-w-5xl">
      <PageHeader title="Cuentas a cobrar" description="Saldos de clientes, lo vencido y los cobros sin imputar." />
      {data?.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Total a cobrar" value={fmtMoney(sumCents(data.map((r) => r.balance)))} />
          <Stat label="Vencido" value={fmtMoney(sumCents(data.map((r) => r.overdue)))} tone="warning" />
          <Stat label="Vencido hace más de 60 días" value={fmtMoney(sumCents(data.map((r) => r.over60)))} tone="danger" />
        </div>
      ) : null}
      {!data?.length ? (
        <Card><EmptyState icon={<BookOpen className="size-8" />} title="Sin saldos de clientes" description="Las facturas emitidas y los cobros aparecen acá." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2 text-right">Vencido</th>
                <th className="px-3 py-2 text-right">+60 días</th>
                <th className="px-3 py-2 text-right">Sin imputar</th>
                <th className="px-3 py-2 text-right">Próximo vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.party_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2"><Link className="hover:underline" href={`/cuentas-a-cobrar/${r.party_id}`}>{r.legal_name}</Link> <span className="text-xs text-muted">{r.code}</span></td>
                  <td className="num px-3 py-2 text-right font-medium">{fmtMoney(r.balance)}</td>
                  <td className={`num px-3 py-2 text-right ${isZero(r.overdue) ? 'text-muted' : 'text-warning'}`}>{fmtMoney(r.overdue)}</td>
                  <td className={`num px-3 py-2 text-right ${isZero(r.over60) ? 'text-muted' : 'text-danger'}`}>{fmtMoney(r.over60)}</td>
                  <td className={`num px-3 py-2 text-right ${isZero(r.credits) ? 'text-muted' : ''}`}>{fmtMoney(r.credits)}</td>
                  <td className="px-3 py-2 text-right">{fmtDate(r.next_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
