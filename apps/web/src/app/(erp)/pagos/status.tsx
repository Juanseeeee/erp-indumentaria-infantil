import { Badge } from '@/components/ui';

/** Estado de una orden de pago, con texto (no solo color). */
export function PaymentStatus({ status }: { status: string }) {
  if (status === 'VOIDED') return <Badge tone="danger">Anulada</Badge>;
  if (status === 'REJECTED') return <Badge tone="danger">Rechazada</Badge>;
  if (status === 'PENDING_APPROVAL') return <Badge tone="warning">Pendiente de aprobación</Badge>;
  return <Badge tone="success">Pagada</Badge>;
}
