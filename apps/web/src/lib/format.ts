import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * Formato argentino SOLO para mostrar. Los valores viajan como string decimal desde la API;
 * nunca se hace aritmética de dinero en el front.
 */
function groupAR(value: string, decimals: number | 'auto') {
  if (value === null || value === undefined || value === '') return '';
  const negative = value.startsWith('-');
  const [rawInt, rawFrac = ''] = value.replace('-', '').split('.');
  const int = (rawInt || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  let frac = rawFrac;
  if (decimals === 'auto') frac = frac.replace(/0+$/, '');
  else frac = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return `${negative ? '-' : ''}${int}${frac ? ',' + frac : ''}`;
}

export const fmtQty = (v: string | null | undefined) => (v == null ? '—' : groupAR(v, 'auto'));
export const fmtMoney = (v: string | null | undefined) => (v == null ? '—' : `$ ${groupAR(roundStr(v, 2), 2)}`);

/** Redondeo de presentación sobre string (sin floats). */
function roundStr(v: string, d: number) {
  const [i, f = ''] = v.split('.');
  if (f.length <= d) return v;
  const keep = f.slice(0, d);
  const next = Number(f[d]);
  if (next < 5) return `${i}.${keep}`;
  // Propaga el acarreo usando BigInt.
  const neg = i!.startsWith('-');
  const digits = BigInt(`${i!.replace('-', '')}${keep}`) + 1n;
  const s = digits.toString().padStart(d + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -d)}.${s.slice(-d)}`;
}

/**
 * Las fechas de negocio (columnas DATE: emisión, vencimiento, entrega) llegan como medianoche UTC del día
 * calendario. Se muestran en UTC para que en Argentina (UTC−3) no aparezcan como el día anterior.
 * Los instantes (creado el, registrado el) se muestran en la hora local.
 */
const isCalendarDate = (v: string | Date) => {
  const s = typeof v === 'string' ? v : v.toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /T00:00:00(\.000)?Z$/.test(s);
};
export const fmtDate = (v: string | Date | null | undefined) =>
  v
    ? new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', ...(isCalendarDate(v) ? { timeZone: 'UTC' } : {}) })
    : '—';
export const fmtDateTime = (v: string | Date | null | undefined) =>
  v
    ? new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

export const isNegative = (v: string | null | undefined) => !!v && v.startsWith('-');
export const isZero = (v: string | null | undefined) => !v || /^-?0*(\.0*)?$/.test(v);

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: 'Stock inicial',
  PURCHASE_RECEIPT: 'Recepción de compra',
  PURCHASE_RETURN: 'Devolución a proveedor',
  SALE_DELIVERY: 'Entrega (remito)',
  SALE_RETURN: 'Devolución de cliente',
  PROD_ISSUE: 'Consumo de producción',
  PROD_OUTPUT: 'Ingreso de producción',
  PROD_SCRAP: 'Descarte de producción',
  TRANSFER_OUT: 'Transferencia (salida)',
  TRANSFER_IN: 'Transferencia (entrada)',
  ADJUSTMENT: 'Ajuste',
  COUNT_ADJUSTMENT: 'Ajuste por inventario',
};

export const DOC_TYPE_LABELS: Record<string, string> = { OPENING: 'Stock inicial', ADJUSTMENT: 'Ajuste', TRANSFER: 'Transferencia' };
export const DOC_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  POSTED: 'Confirmado',
  VOIDED: 'Anulado',
  OPEN: 'Abierto',
  REVIEW: 'En revisión',
  CANCELLED: 'Cancelado',
};
export const TAX_CONDITION_LABELS: Record<string, string> = {
  RI: 'Responsable inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor final',
  NO_ALCANZADO: 'No alcanzado',
};
export const PARTY_ROLE_LABELS: Record<string, string> = { CUSTOMER: 'Cliente', SUPPLIER: 'Proveedor', WORKSHOP: 'Taller' };
export const WAREHOUSE_TYPE_LABELS: Record<string, string> = {
  OWN: 'Propio',
  WORKSHOP: 'Taller (en poder de terceros)',
  TRANSIT: 'En tránsito',
  QUARANTINE: 'Cuarentena',
};

export const statusTone = (s: string) =>
  s === 'POSTED' ? ('success' as const) : s === 'PENDING_APPROVAL' || s === 'OPEN' ? ('warning' as const) : s === 'VOIDED' || s === 'CANCELLED' ? ('danger' as const) : ('neutral' as const);

export const PROD_STATUS: Record<string, [string, 'neutral' | 'accent' | 'success' | 'warning' | 'danger']> = {
  DRAFT: ['Borrador', 'neutral'],
  RELEASED: ['Liberada', 'accent'],
  IN_PROGRESS: ['En curso', 'warning'],
  COMPLETED: ['Terminada', 'success'],
  CLOSED: ['Cerrada', 'neutral'],
  CANCELLED: ['Cancelada', 'danger'],
};
export const PO_STATUS: Record<string, [string, 'neutral' | 'accent' | 'success' | 'warning' | 'danger']> = {
  DRAFT: ['Pendiente de aprobación', 'warning'],
  APPROVED: ['Aprobada', 'accent'],
  PARTIALLY_RECEIVED: ['Recibida parcial', 'warning'],
  RECEIVED: ['Recibida', 'success'],
  CLOSED: ['Cerrada', 'neutral'],
  CANCELLED: ['Cancelada', 'danger'],
};
export const PRIORITY: Record<number, string> = { 1: 'Alta', 2: 'Normal', 3: 'Baja' };
export const fmtDocNumber = (type: string, pos: number, n: number) =>
  `${type} ${String(pos).padStart(5, '0')}-${String(n).padStart(8, '0')}`;
/** Hoy (día calendario de Buenos Aires) como YYYY-MM-DD. */
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export const SO_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ['Borrador', 'neutral'],
  CONFIRMED: ['Confirmado', 'accent'],
  PARTIALLY_DELIVERED: ['Entregado parcial', 'warning'],
  DELIVERED: ['Entregado', 'success'],
  CLOSED: ['Cerrado', 'neutral'],
  CANCELLED: ['Cancelado', 'danger'],
};
export const FD_STATUS: Record<string, [string, Tone]> = {
  POSTED: ['Autorizado', 'success'],
  PENDING_AUTH: ['Esperando CAE', 'warning'],
  REJECTED: ['Rechazado por ARCA', 'danger'],
  VOIDED: ['Anulado', 'danger'],
};
export const ENTRY_TYPES: Record<string, string> = {
  INVOICE: 'Factura',
  CREDIT_NOTE: 'Nota de crédito',
  DEBIT_NOTE: 'Nota de débito',
  RECEIPT: 'Recibo',
  PAYMENT: 'Pago',
  REVERSAL: 'Anulación',
  OPENING: 'Saldo inicial',
};
/** Número de comprobante de venta (puede no tener número mientras espera el CAE). */
export const fmtFiscal = (d: { docType: string; pointOfSale: number; number: number | null }) =>
  d.number ? fmtDocNumber(d.docType, d.pointOfSale, d.number) : `${d.docType} ${String(d.pointOfSale).padStart(5, '0')}-(sin número)`;
