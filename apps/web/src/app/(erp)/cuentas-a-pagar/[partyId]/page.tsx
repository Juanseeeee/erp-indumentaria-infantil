'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Can } from '@/lib/session';
import { Card, ErrorBox, LinkButton, PageHeader, Spinner } from '@/components/ui';

interface Ledger {
  party: { legalName: string; code: string } | null;
  balance: string;
  entries: { id: string; date: string; dueDate: string | null; description: string; entryType: string; amount: string; openAmount: string; balance: string }[];
}

const TYPES: Record<string, string> = { INVOICE: 'Factura', CREDIT_NOTE: 'Nota de crédito', DEBIT_NOTE: 'Nota de débito', PAYMENT: 'Pago', REVERSAL: 'Anulación', CHEQUE_REJECTED: 'Débito', OPENING: 'Saldo inicial' };

export default function PayableLedgerPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = use(params);
  const { data, isLoading, error } = useQuery({ queryKey: ['ledger', partyId], queryFn: () => api.get<Ledger>(`/accounts/${partyId}?tipo=PAYABLE`) });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`Cuenta corriente · ${data.party?.legalName}`}
        description={`Saldo: ${fmtMoney(data.balance)}`}
        actions={<Can perm="payables.pay"><LinkButton href={`/pagos/nuevo?proveedor=${partyId}`}>Pagar</LinkButton></Can>}
      />
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
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{fmtDate(e.date)}</td>
                <td className="px-3 py-2">{TYPES[e.entryType] ?? e.entryType} · {e.description}</td>
                <td className="px-3 py-2">{fmtDate(e.dueDate)}</td>
                <td className="num px-3 py-2 text-right">{e.amount.startsWith('-') ? fmtMoney(e.amount.slice(1)) : ''}</td>
                <td className="num px-3 py-2 text-right">{e.amount.startsWith('-') ? '' : fmtMoney(e.amount)}</td>
                <td className="num px-3 py-2 text-right font-medium">{fmtMoney(e.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-xs text-muted">Haber = lo que le debemos (facturas). Debe = lo que reduce la deuda (notas de crédito y pagos).</p>
    </div>
  );
}
