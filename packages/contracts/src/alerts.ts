import { z } from 'zod';

/**
 * Alertas (RF §13). Cada regla detecta una condición sobre datos reales; la alerta vive mientras la
 * condición siga vigente y se resuelve sola cuando desaparece. Los destinatarios son roles (y usuarios).
 */
export const ALERT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type AlertPriority = (typeof ALERT_PRIORITIES)[number];
export const ALERT_PRIORITY_LABELS: Record<AlertPriority, string> = { LOW: 'Baja', NORMAL: 'Normal', HIGH: 'Alta', CRITICAL: 'Crítica' };

export const ALERT_STATUSES = ['NEW', 'SEEN', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = { NEW: 'Nueva', SEEN: 'Vista', RESOLVED: 'Resuelta' };

export interface AlertRuleDefinition {
  code: string;
  label: string;
  /** Qué dispara la alerta, en lenguaje de negocio. */
  description: string;
  priority: AlertPriority;
  /** Códigos de rol destinatarios por defecto. */
  roles: string[];
  /** Umbral en días, si la regla lo usa. */
  days?: { label: string; default: number; min: number; max: number };
}

export const ALERT_RULES = [
  {
    code: 'STOCK_MIN',
    label: 'Stock bajo el mínimo',
    description: 'Un artículo tiene en los depósitos propios menos que su stock mínimo.',
    priority: 'NORMAL',
    roles: ['PURCHASING', 'WAREHOUSE'],
  },
  {
    code: 'MATERIAL_SHORTAGE',
    label: 'Falta material para una OP',
    description: 'Una orden de producción liberada o en proceso necesita un material que no alcanza en el depósito de materiales.',
    priority: 'HIGH',
    roles: ['PRODUCTION', 'PURCHASING'],
  },
  {
    code: 'PRODUCTION_LATE',
    label: 'OP atrasada',
    description: 'Una orden de producción liberada o en proceso pasó su fecha de entrega.',
    priority: 'HIGH',
    roles: ['PRODUCTION', 'OWNER'],
  },
  {
    code: 'ORDER_NOT_PREPARED',
    label: 'Pedido sin preparar',
    description: 'Un pedido confirmado lleva más de N días sin ningún remito.',
    priority: 'NORMAL',
    roles: ['SALES', 'WAREHOUSE'],
    days: { label: 'Días desde la confirmación', default: 3, min: 1, max: 60 },
  },
  {
    code: 'CUSTOMER_OVERDUE',
    label: 'Cliente con deuda vencida',
    description: 'Un cliente tiene facturas vencidas hace más de N días sin cobrar.',
    priority: 'NORMAL',
    roles: ['ADMIN', 'TREASURY'],
    days: { label: 'Días de vencida', default: 15, min: 1, max: 180 },
  },
  {
    code: 'CHEQUE_DUE',
    label: 'Cheque por vencer',
    description: 'Un cheque de terceros en cartera vence en N días o menos (hay que depositarlo o usarlo).',
    priority: 'NORMAL',
    roles: ['TREASURY'],
    days: { label: 'Días de anticipación', default: 3, min: 0, max: 30 },
  },
  {
    code: 'CHEQUE_REJECTED',
    label: 'Cheque rechazado',
    description: 'Un cheque de terceros fue rechazado y todavía no se gestionó (devolución o reemplazo).',
    priority: 'CRITICAL',
    roles: ['TREASURY', 'ADMIN', 'OWNER'],
  },
  {
    code: 'APPROVAL_PENDING',
    label: 'Aprobación pendiente',
    description: 'Un ajuste de stock o un pago a proveedor espera la aprobación de otra persona.',
    priority: 'HIGH',
    roles: ['ADMIN', 'OWNER'],
  },
  {
    code: 'INVENTORY_DIFFERENCE',
    label: 'Diferencia de inventario',
    description: 'Un inventario físico en revisión tiene diferencias contra el sistema, o el saldo de stock no coincide con sus movimientos.',
    priority: 'HIGH',
    roles: ['ADMIN', 'WAREHOUSE'],
  },
  {
    code: 'RECONCILIATION_PENDING',
    label: 'Conciliación atrasada',
    description: 'Un extracto bancario tiene líneas sin conciliar con más de N días.',
    priority: 'NORMAL',
    roles: ['TREASURY'],
    days: { label: 'Días sin conciliar', default: 7, min: 1, max: 60 },
  },
  {
    code: 'INTEGRATION_ERROR',
    label: 'Error de integración',
    description: 'ARCA rechazó un comprobante o no lo autorizó en una hora, o un correo del sistema no se pudo enviar.',
    priority: 'HIGH',
    roles: ['ADMIN'],
  },
] as const satisfies readonly AlertRuleDefinition[];

export type AlertCode = (typeof ALERT_RULES)[number]['code'];
export const ALERT_CODES = ALERT_RULES.map((r) => r.code) as [AlertCode, ...AlertCode[]];
export const findAlertRule = (code: string): AlertRuleDefinition | undefined => (ALERT_RULES as readonly AlertRuleDefinition[]).find((r) => r.code === code);

export const AlertRuleUpdateSchema = z.object({
  enabled: z.boolean(),
  priority: z.enum(ALERT_PRIORITIES),
  roles: z.array(z.string().trim().min(1).max(50)).max(20),
  userIds: z.array(z.string().uuid()).max(50).default([]),
  sendEmail: z.boolean(),
  days: z.number().int().min(0).max(365).nullable().default(null),
});
export type AlertRuleUpdateInput = z.infer<typeof AlertRuleUpdateSchema>;

export const AlertQuerySchema = z.object({
  status: z.enum(['OPEN', ...ALERT_STATUSES]).default('OPEN'),
  /** `all` requiere `alerts.manage`: ver las alertas de todos, no solo las propias. */
  scope: z.enum(['mine', 'all']).default('mine'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AlertQuery = z.infer<typeof AlertQuerySchema>;

export const AlertResolveSchema = z.object({ note: z.string().trim().max(500).optional().nullable() });
