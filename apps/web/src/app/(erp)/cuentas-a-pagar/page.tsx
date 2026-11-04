'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, isZero } from '@/lib/format';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

interface Row {
  party_id: string;
  legal_name: string;
  code: string;
  balance: string;
  overdue: string;
  next_due: string | null;
}

export default function PayablesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['payables'], queryFn: () => api.get<Row[]>('/accounts/balances?tipo=PAYABLE') });
  if (isLoading) return <Spinner />;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Cuentas a pagar" description="Saldos con proveedores y talleres. Los pagos e imputaciones se registran desde Tesorería (Fase 4)." />
      {!data?.length ? (
        <Card><EmptyState icon={<Landmark className="size-8" />} title="Sin deudas registradas" description="Las facturas de proveedores y las liquidaciones de talleres aparecen acá." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                <th className="px-3 py-2 text-left">Proveedor / taller</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2 text-right">Vencido</th>
                <th className="px-3 py-2 text-right">Próximo vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.party_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2"><Link className="hover:underline" href={`/cuentas-a-pagar/${r.party_id}`}>{r.legal_name}</Link> <span className="text-xs text-muted">{r.code}</span></td>
                  <td className="num px-3 py-2 text-right font-medium">{fmtMoney(r.balance)}</td>
                  <td className={`num px-3 py-2 text-right ${isZero(r.overdue) ? 'text-muted' : 'text-danger'}`}>{fmtMoney(r.overdue)}</td>
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
