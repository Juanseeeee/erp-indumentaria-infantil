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
import { PaymentStatus } from '../status';

interface Payment {
  id: string;
  number: string;
  status: string;
  date: string;
  total: string;
  notes: string | null;
  unapplied: string;
  supplier: { id: string; legalName: string; taxId: string; taxCondition: string } | null;
  company: { legalName: string; cuit: string; address: string | null } | null;
  lines: {
    id: string;
    method: string;
    label: string;
    amount: string;
    reference: string | null;
    paymentDate: string | null;
    account: string | null;
    cheque: { bank: string; number: string; paymentDate: string; statusLabel: string; isEcheq: boolean } | null;
  }[];
  allocations: { id: string; amount: string; document?: string }[];
  plannedAllocations: { id: string; amount: string; document?: string }[];
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
}

export default function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { data: p, isLoading, error } = useQuery({ queryKey: ['supplier-payment', id], queryFn: () => api.get<Payment>(`/treasury/payments/${id}`) });
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const voidIt = useMutation({
    mutationFn: () => api.post<Payment>(`/treasury/payments/${id}/void`, { reason }),
    onSuccess: (x) => {
      toast.success('Orden de pago anulada: se revirtieron las imputaciones y los fondos.');
      qc.setQueryData(['supplier-payment', id], x);
      setVoiding(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const approve = useMutation({
    mutationFn: () => api.post<Payment>(`/treasury/payments/${id}/approve`),
    onSuccess: (x) => {
      toast.success('Orden de pago aprobada: se pagó y se imputó.');
      qc.setQueryData(['supplier-payment', id], x);
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: () => api.post<Payment>(`/treasury/payments/${id}/reject`, { reason: rejectReason }),
    onSuccess: (x) => {
      toast.success('Orden de pago rechazada.');
      qc.setQueryData(['supplier-payment', id], x);
      setRejecting(false);
    },
    onError: (e) => toast.error(e.message),
  });
  if (isLoading) return <Spinner />;
  if (error || !p) return <ErrorBox error={error} />;
  return (
    <div className="max-w-3xl">
      <div data-tour="op-detalle-acciones" className="print-hide mb-4 flex items-center gap-2">
        <PaymentStatus status={p.status} />
        {p.status === 'POSTED' && !isZero(p.unapplied) && <Badge tone="warning">Anticipo {fmtMoney(p.unapplied)}</Badge>}
        <div className="ml-auto flex gap-2">
          <Link href={`/cuentas-a-pagar/${p.supplier?.id}`}><Button data-tour="op-detalle-cuenta-corriente" variant="secondary">Cuenta corriente</Button></Link>
          {p.status === 'POSTED' && <Can perm="payables.pay"><Button data-tour="op-detalle-anular" variant="secondary" onClick={() => setVoiding(true)}>Anular</Button></Can>}
          {p.status === 'PENDING_APPROVAL' && (
            <Can perm="payables.approve">
              <Button data-tour="op-detalle-rechazar" variant="secondary" onClick={() => setRejecting(true)}>Rechazar</Button>
              <Button data-tour="op-detalle-aprobar" loading={approve.isPending} onClick={() => approve.mutate()}>Aprobar y pagar</Button>
            </Can>
          )}
          <PrintButton />
        </div>
      </div>
      {voiding && (
        <div className="print-hide mb-4" data-tour="op-detalle-motivo-anulacion">
          <ConfirmPanel
            title={`Anular la orden de pago ${p.number}`}
            impact="Las facturas vuelven a quedar pendientes, el dinero vuelve a su caja o banco, los cheques endosados vuelven a la cartera y los cheques propios se anulan. No se puede si un cheque propio ya fue debitado."
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Anular orden de pago"
            loading={voidIt.isPending}
            onConfirm={() => voidIt.mutate()}
            onCancel={() => setVoiding(false)}
          />
        </div>
      )}
      {p.status === 'PENDING_APPROVAL' && (
        <div data-tour="op-detalle-pendiente" role="status" className="print-hide mb-4 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
          <strong>Pendiente de aprobación.</strong> Cargada por {p.createdByName}. Todavía no salió dinero ni se entregaron cheques; al aprobarla se paga y se imputa. Debe aprobarla otra persona con permiso.
        </div>
      )}
      {p.status === 'REJECTED' && (
        <div role="status" className="print-hide mb-4 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">
          <strong>Rechazada</strong> por {p.approvedByName}: {p.rejectionReason}. No se pagó nada.
        </div>
      )}
      {p.status === 'POSTED' && p.approvedByName && <p className="print-hide mb-4 text-sm text-muted">Aprobada por {p.approvedByName}.</p>}
      {rejecting && (
        <div className="print-hide mb-4" data-tour="op-detalle-motivo-rechazo">
          <ConfirmPanel
            title={`Rechazar la orden de pago ${p.number}`}
            impact="No se paga nada: la deuda con el proveedor sigue pendiente y los cheques de cartera elegidos quedan libres."
            requireReason
            reason={rejectReason}
            setReason={setRejectReason}
            confirmLabel="Rechazar orden de pago"
            loading={reject.isPending}
            onConfirm={() => reject.mutate()}
            onCancel={() => setRejecting(false)}
          />
        </div>
      )}
      <Card className="p-6" tour="op-detalle-documento">
        <DocHeader company={p.company} title="Orden de pago" number={p.number} meta={<p className="text-muted">Fecha {fmtDate(p.date)}</p>} />
        <div className="my-4 text-sm">
          <p>Pagamos a <span className="font-medium">{p.supplier?.legalName}</span> (CUIT {p.supplier?.taxId}, {TAX_CONDITION_LABELS[p.supplier?.taxCondition ?? '']}) la suma de <span className="num font-semibold">{fmtMoney(p.total)}</span>.</p>
        </div>
        <p className="mb-1 text-xs font-medium text-muted uppercase">Medios</p>
        <table className="mb-4 w-full text-sm">
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="py-1.5">{l.label}</td>
                <td className="py-1.5 text-muted">
                  {l.cheque
                    ? `${l.cheque.bank} n.º ${l.cheque.number} · pago ${fmtDate(l.cheque.paymentDate)}`
                    : `${l.reference ?? ''}${l.paymentDate ? ` · pago ${fmtDate(l.paymentDate)}` : ''}`}
                  {(l.account || l.cheque) && <span className="print-hide"> · {[l.cheque?.statusLabel, l.account].filter(Boolean).join(' · ')}</span>}
                </td>
                <td className="num py-1.5 text-right">{fmtMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mb-1 text-xs font-medium text-muted uppercase">Aplicado a</p>
        <table className="w-full text-sm">
          <tbody>
            {(p.status === 'PENDING_APPROVAL' ? p.plannedAllocations : p.allocations).map((a) => (
              <tr key={a.id} className="border-b border-border">
                <td className="py-1.5">{a.document}</td>
                <td className="num py-1.5 text-right">{fmtMoney(a.amount)}</td>
              </tr>
            ))}
            {!isZero(p.unapplied) && (
              <tr><td className="py-1.5 text-muted">Anticipo a cuenta</td><td className="num py-1.5 text-right">{fmtMoney(p.unapplied)}</td></tr>
            )}
          </tbody>
        </table>
        {p.notes && <p className="mt-3 text-sm text-muted">{p.notes}</p>}
        <div className="mt-12 ml-auto w-64 border-t border-border pt-1 text-center text-xs text-muted">Recibí conforme</div>
      </Card>
    </div>
  );
}
