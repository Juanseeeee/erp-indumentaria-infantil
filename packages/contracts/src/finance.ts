import { z } from 'zod';
import { zMoney } from './schemas';

export const CASH_ACCOUNT_TYPES = ['CASH_BOX', 'BANK', 'WALLET', 'CARD_CLEARING', 'CHEQUE_PORTFOLIO'] as const;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Fecha inválida');

export const CashAccountCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(CASH_ACCOUNT_TYPES),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default('ARS'),
  bank: z.string().trim().max(100).optional().nullable(),
  accountReference: z.string().trim().max(100).optional().nullable(),
});
export type CashAccountCreateInput = z.infer<typeof CashAccountCreateSchema>;

export const TreasuryMovementCreateSchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  amount: zMoney().refine((value) => Number(value) > 0, 'Debe ser mayor a cero'),
  operationDate: dateOnly.optional(),
  valueDate: dateOnly.optional().nullable(),
  concept: z.string().trim().min(1).max(300),
  paymentMethod: z.string().trim().max(40).optional().nullable(),
});
export type TreasuryMovementCreateInput = z.infer<typeof TreasuryMovementCreateSchema>;

export const TreasuryMovementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export type TreasuryMovementQuery = z.infer<typeof TreasuryMovementQuerySchema>;

// ─── Cheques ───
export const CHEQUE_STATUSES = ['IN_PORTFOLIO', 'DELIVERED', 'DEPOSITED', 'CREDITED', 'REJECTED', 'RETURNED', 'ISSUED', 'DEBITED', 'VOIDED'] as const;

export const ChequeQuerySchema = z.object({
  ownership: z.enum(['THIRD', 'OWN']).optional(),
  status: z.enum(CHEQUE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ChequeQuery = z.infer<typeof ChequeQuerySchema>;

export const ChequeDepositSchema = z.object({ bankAccountId: z.string().uuid(), date: dateOnly.optional() });
export type ChequeDepositInput = z.infer<typeof ChequeDepositSchema>;

export const ChequeCreditSchema = z.object({ date: dateOnly.optional() });
export type ChequeCreditInput = z.infer<typeof ChequeCreditSchema>;

export const ChequeRejectSchema = z.object({
  date: dateOnly.optional(),
  reason: z.string().trim().min(3, 'Indicá el motivo').max(300),
  /** Gasto bancario por el rechazo, que se debita del banco y se traslada al cliente. */
  bankFee: zMoney().optional().nullable(),
});
export type ChequeRejectInput = z.infer<typeof ChequeRejectSchema>;

// ─── Órdenes de pago ───
export const SUPPLIER_PAYMENT_METHODS = ['CASH', 'TRANSFER', 'THIRD_CHEQUE', 'OWN_CHEQUE', 'OWN_ECHEQ', 'RETENTION'] as const;
export const SUPPLIER_PAYMENT_METHOD_LABELS: Record<(typeof SUPPLIER_PAYMENT_METHODS)[number], string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  THIRD_CHEQUE: 'Cheque de cartera (endoso)',
  OWN_CHEQUE: 'Cheque propio',
  OWN_ECHEQ: 'E-cheq propio',
  RETENTION: 'Retención practicada',
};

const optionalString = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const SupplierPaymentCreateSchema = z.object({
  supplierId: z.string().uuid(),
  date: dateOnly.optional(),
  notes: optionalString(1000),
  payments: z
    .array(
      z
        .object({
          method: z.enum(SUPPLIER_PAYMENT_METHODS),
          /** En un endoso se toma el importe del cheque. */
          amount: zMoney().optional().nullable(),
          cashAccountId: z.string().uuid().optional().nullable(),
          chequeId: z.string().uuid().optional().nullable(),
          /** Número del cheque propio o referencia de la transferencia / certificado de retención. */
          reference: optionalString(100),
          /** Fecha de pago del cheque propio. */
          paymentDate: dateOnly.optional().nullable(),
        })
        .refine((p) => p.method !== 'THIRD_CHEQUE' || p.chequeId, { message: 'Elegí el cheque de cartera' })
        .refine((p) => p.method === 'THIRD_CHEQUE' || (p.amount && Number(p.amount) > 0), { message: 'Indicá el importe' })
        .refine((p) => !['OWN_CHEQUE', 'OWN_ECHEQ'].includes(p.method) || (p.cashAccountId && p.reference && p.paymentDate), {
          message: 'El cheque propio necesita banco, número y fecha de pago',
        }),
    )
    .min(1, 'Indicá cómo se paga'),
  allocations: z.array(z.object({ entryId: z.string().uuid(), amount: zMoney().refine((v) => Number(v) > 0, 'Debe ser mayor a cero') })).default([]),
});
export type SupplierPaymentCreateInput = z.infer<typeof SupplierPaymentCreateSchema>;

export const SUPPLIER_PAYMENT_STATUSES = ['PENDING_APPROVAL', 'POSTED', 'REJECTED', 'VOIDED'] as const;
export const SupplierPaymentQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
  status: z.enum(SUPPLIER_PAYMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type SupplierPaymentQuery = z.infer<typeof SupplierPaymentQuerySchema>;

export const ChequeDebitSchema = z.object({ date: dateOnly.optional() });
export type ChequeDebitInput = z.infer<typeof ChequeDebitSchema>;

// ─── Transferencias, arqueos y gastos ───
const positiveMoney = () => zMoney().refine((v) => Number(v) > 0, 'Debe ser mayor a cero');

export const TreasuryTransferCreateSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: positiveMoney(),
  /** Comisión o gasto que se descuenta de lo que llega al destino (p. ej., acreditación de tarjetas). */
  fee: zMoney().optional().nullable(),
  date: dateOnly.optional(),
  /** Fecha en que el destino dispone del dinero; por defecto, la de la transferencia. */
  valueDate: dateOnly.optional().nullable(),
  concept: optionalString(300),
});
export type TreasuryTransferCreateInput = z.infer<typeof TreasuryTransferCreateSchema>;

export const CashClosingCreateSchema = z.object({
  cashAccountId: z.string().uuid(),
  date: dateOnly.optional(),
  counted: zMoney().refine((v) => Number(v) >= 0, 'No puede ser negativo'),
  notes: optionalString(500),
});
export type CashClosingCreateInput = z.infer<typeof CashClosingCreateSchema>;

export const CostCenterCreateSchema = z.object({
  code: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(80),
});
export type CostCenterCreateInput = z.infer<typeof CostCenterCreateSchema>;

export const ExpenseCreateSchema = z.object({
  date: dateOnly.optional(),
  categoryId: z.string().uuid(),
  costCenterId: z.string().uuid(),
  cashAccountId: z.string().uuid(),
  supplierId: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1, 'Indicá el concepto').max(300),
  documentReference: optionalString(100),
  amount: positiveMoney(),
});
export type ExpenseCreateInput = z.infer<typeof ExpenseCreateSchema>;

export const ExpenseQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  costCenterId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ExpenseQuery = z.infer<typeof ExpenseQuerySchema>;

export const DateRangeQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

// ─── Extractos y conciliación ───
export const STATEMENT_LINE_STATUSES = ['PENDING', 'MATCHED', 'CREATED', 'IGNORED'] as const;
export const STATEMENT_LINE_STATUS_LABELS: Record<(typeof STATEMENT_LINE_STATUSES)[number], string> = {
  PENDING: 'Sin conciliar',
  MATCHED: 'Conciliada',
  CREATED: 'Registrada desde el extracto',
  IGNORED: 'Ignorada',
};

export const StatementImportSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  /** Contenido del CSV tal como lo exporta el home banking. */
  content: z.string().min(1, 'El archivo está vacío').max(1_000_000, 'El archivo es demasiado grande (máximo 1 MB)'),
});
export type StatementImportInput = z.infer<typeof StatementImportSchema>;

export const StatementLineMatchSchema = z.object({ movementId: z.string().uuid() });
export type StatementLineMatchInput = z.infer<typeof StatementLineMatchSchema>;

/** Registra en el sistema lo que solo figura en el banco (comisiones, impuestos, intereses, débitos automáticos). */
export const StatementLineCreateSchema = z
  .object({
    concept: z.string().trim().min(1, 'Indicá el concepto').max(300),
    /** Si se indican, el débito se registra como gasto con su categoría y centro de costo. */
    categoryId: z.string().uuid().optional().nullable(),
    costCenterId: z.string().uuid().optional().nullable(),
  })
  .refine((v) => !v.categoryId === !v.costCenterId, { message: 'Para registrarlo como gasto indicá categoría y centro de costo' });
export type StatementLineCreateInput = z.infer<typeof StatementLineCreateSchema>;

export const StatementLineIgnoreSchema = z.object({ reason: z.string().trim().min(3, 'Indicá el motivo').max(300) });
export type StatementLineIgnoreInput = z.infer<typeof StatementLineIgnoreSchema>;

// ─── Flujo de fondos proyectado ───
export const CASHFLOW_KINDS = ['COBRANZAS', 'CHEQUES_A_COBRAR', 'TARJETAS', 'PAGOS', 'CHEQUES_PROPIOS', 'GASTOS_FIJOS', 'DIFERIDOS'] as const;
export type CashflowKind = (typeof CASHFLOW_KINDS)[number];
export const CASHFLOW_KIND_LABELS: Record<CashflowKind, string> = {
  COBRANZAS: 'Facturas a cobrar',
  CHEQUES_A_COBRAR: 'Cheques en cartera y depositados',
  TARJETAS: 'Tarjetas a acreditar',
  PAGOS: 'Facturas a pagar',
  CHEQUES_PROPIOS: 'Cheques propios a debitar',
  GASTOS_FIJOS: 'Gastos recurrentes sin registrar',
  DIFERIDOS: 'Otros movimientos con fecha de valor futura',
};

export const CashflowQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(26).default(13),
  /** Lo vencido y no cobrado ni pagado entra en la primera semana; sin esto, se informa aparte. */
  includeOverdue: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
export type CashflowQuery = z.infer<typeof CashflowQuerySchema>;

// ─── Cierre de período ───
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
export const PeriodCloseSchema = z.object({
  /** Último día cerrado (inclusive). */
  until: isoDate,
  notes: z.string().trim().max(500).optional().nullable(),
});
export type PeriodCloseInput = z.infer<typeof PeriodCloseSchema>;

export const PeriodReopenSchema = z.object({
  /** Nuevo último día cerrado; vacío reabre todo. */
  until: isoDate.optional().nullable(),
  reason: z.string().trim().min(10, 'Explicá por qué se reabre (mínimo 10 caracteres)').max(500),
});
export type PeriodReopenInput = z.infer<typeof PeriodReopenSchema>;

// ─── Gastos recurrentes ───
export const ExpenseTemplateCreateSchema = z.object({
  name: z.string().trim().min(1, 'Indicá un nombre').max(100),
  categoryId: z.string().uuid(),
  costCenterId: z.string().uuid(),
  cashAccountId: z.string().uuid(),
  supplierId: z.string().uuid().optional().nullable(),
  amount: zMoney().refine((v) => Number(v) > 0, 'Debe ser mayor a cero'),
  dayOfMonth: z.coerce.number().int().min(1).max(28, 'Elegí un día del 1 al 28 (existe en todos los meses)'),
  startsOn: dateOnly.optional(),
});
export type ExpenseTemplateCreateInput = z.infer<typeof ExpenseTemplateCreateSchema>;

export const ExpenseTemplateRegisterSchema = z.object({
  /** Mes que cubre (AAAA-MM). */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido'),
  /** Importe real de este mes; por defecto, el habitual. */
  amount: zMoney().refine((v) => Number(v) > 0, 'Debe ser mayor a cero').optional().nullable(),
  date: dateOnly.optional(),
  documentReference: optionalString(100),
});
export type ExpenseTemplateRegisterInput = z.infer<typeof ExpenseTemplateRegisterSchema>;

// ─── Rentabilidad (margen bruto estimado, RF-COS-03) ───
export const PROFITABILITY_DIMENSIONS = ['product', 'category', 'customer', 'order', 'seller'] as const;
export type ProfitabilityDimension = (typeof PROFITABILITY_DIMENSIONS)[number];
export const PROFITABILITY_DIMENSION_LABELS: Record<ProfitabilityDimension, string> = {
  product: 'Modelo',
  category: 'Categoría',
  customer: 'Cliente',
  order: 'Pedido',
  seller: 'Vendedor',
};
export const ProfitabilityQuerySchema = z
  .object({
    from: dateOnly,
    to: dateOnly,
    groupBy: z.enum(PROFITABILITY_DIMENSIONS).default('product'),
  })
  .refine((q) => q.from <= q.to, { message: 'La fecha desde no puede ser posterior a la fecha hasta.', path: ['from'] });
export type ProfitabilityQuery = z.infer<typeof ProfitabilityQuerySchema>;
