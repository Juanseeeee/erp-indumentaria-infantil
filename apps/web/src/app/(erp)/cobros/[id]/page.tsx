'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, isZero, TAX_CONDITION_LABELS } from '@/lib/format';
import { Can } from '@/lib/session';
import { DocHeader, PrintButton } from '@/components/doc-print';
import { Badge, Button, Card, ConfirmPanel, ErrorBox, Spinner } from '@/components/ui';

interface Receipt {
  id: string;
  number: string;
  status: string;
  date: string;
  total: string;
  notes: string | null;
  unapplied: string;
  customer: { id: string; legalName: string; taxId: string; taxCondition: string } | null;
  company: { legalName: string; cuit: string; address: string | null } | null;
  payments: { id: string; label: string; amount: string; reference: string | null; bank: string | null; dueDate: string | null; account: string | null; chequeStatus: string | null }[];
  allocations: { id: string; amount: string; document?: string; documentId?: string }[];
}

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { data: r, isLoading, error } = useQuery({ queryKey: ['receipt', id], queryFn: () => api.get<Receipt>(`/sales/receipts/${id}`) });
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const voidIt = useMutation({
    mutationFn: () => api.post<Receipt>(`/sales/receipts/${id}/void`, { reason }),
    onSuccess: (x) => {
      toast.success('Recibo anulado: sus imputaciones y comisiones se revirtieron.');
      qc.setQueryData(['receipt', id], x);
      setVoiding(false);
    },
    onError: (e) => toast.error(e.message),
  });
  if (isLoading) return <Spinner />;
  if (error || !r) return <ErrorBox error={error} />;
  return (
    <div className="max-w-3xl">
      <div className="print-hide mb-4 flex items-center gap-2">
        {r.status === 'VOIDED' ? <Badge tone="danger">Anulado</Badge> : !isZero(r.unapplied) && <Badge tone="warning">Sin imputar {fmtMoney(r.unapplied)}</Badge>}
        <div className="ml-auto flex gap-2" data-tour="cobro-detalle-acciones">
          {r.status === 'POSTED' && !isZero(r.unapplied) && <Link href={`/cuentas-a-cobrar/${r.customer?.id}`}><Button data-tour="cobro-detalle-imputar-saldo" variant="secondary">Imputar saldo</Button></Link>}
          {r.status === 'POSTED' && <Can perm="receivables.collect"><Button data-tour="cobro-detalle-anular" variant="secondary" onClick={() => setVoiding(true)}>Anular</Button></Can>}
          <PrintButton />
        </div>
      </div>
      {voiding && (
        <div className="print-hide mb-4">
          <ConfirmPanel
            title={`Anular el recibo ${r.number}`}
            impact="Se revierten sus imputaciones (las facturas vuelven a quedar pendientes) y las comisiones que generó."
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Anular recibo"
            loading={voidIt.isPending}
            onConfirm={() => voidIt.mutate()}
            onCancel={() => setVoiding(false)}
          />
        </div>
      )}
      <Card className="p-6" tour="cobro-detalle-recibo">
        <DocHeader company={r.company} title="Recibo" number={r.number} meta={<p className="text-muted">Fecha {fmtDate(r.date)}</p>} />
        <div className="my-4 text-sm">
          <p>Recibimos de <span className="font-medium">{r.customer?.legalName}</span> (CUIT {r.customer?.taxId}, {TAX_CONDITION_LABELS[r.customer?.taxCondition ?? '']}) la suma de <span className="num font-semibold">{fmtMoney(r.total)}</span>.</p>
        </div>
        <p className="mb-1 text-xs font-medium text-muted uppercase">Medios</p>
        <table className="mb-4 w-full text-sm">
          <tbody>
            {r.payments.map((p) => (
              <tr key={p.id} className="border-b border-border">
                <td className="py-1.5">{p.label}</td>
                <td className="py-1.5 text-muted">
                  {[p.bank, p.reference && `n.º ${p.reference}`, p.dueDate && `pago ${fmtDate(p.dueDate)}`].filter(Boolean).join(' · ')}
                  {(p.account || p.chequeStatus) && <span className="print-hide"> · {[p.chequeStatus, p.account].filter(Boolean).join(' en ')}</span>}
                </td>
                <td className="num py-1.5 text-right">{fmtMoney(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mb-1 text-xs font-medium text-muted uppercase">Aplicado a</p>
        <table className="w-full text-sm">
          <tbody>
            {r.allocations.map((a) => (
              <tr key={a.id} className="border-b border-border">
                <td className="py-1.5">{a.documentId ? <Link className="hover:underline" href={`/ventas/comprobantes/${a.documentId}`}>{a.document}</Link> : a.document}</td>
                <td className="num py-1.5 text-right">{fmtMoney(a.amount)}</td>
              </tr>
            ))}
            {!isZero(r.unapplied) && (
              <tr><td className="py-1.5 text-muted">A cuenta (saldo a favor)</td><td className="num py-1.5 text-right">{fmtMoney(r.unapplied)}</td></tr>
            )}
          </tbody>
        </table>
        {r.notes && <p className="mt-3 text-sm text-muted">{r.notes}</p>}
        <div className="mt-12 ml-auto w-64 border-t border-border pt-1 text-center text-xs text-muted">Firma</div>
      </Card>
    </div>
  );
}
