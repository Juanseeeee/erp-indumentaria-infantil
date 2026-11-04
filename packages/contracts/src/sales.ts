import { z } from 'zod';
import { zDecimal, zMoney, zUuid } from './schemas';

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optionalDate = () =>
  z
    .union([z.string(), z.date()])
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null))
    .refine((v) => v === null || !Number.isNaN(v.getTime()), { message: 'Fecha inválida' });
const positiveQty = () => zDecimal({ scale: 4, positive: true });
const positiveMoney = () => zDecimal({ scale: 2, positive: true });
const pct = () => zDecimal({ scale: 2 }).refine((v) => Number(v) >= 0 && Number(v) < 100, { message: 'Entre 0 y 99,99 %' });
const reason = () => z.string().trim().min(3, 'Indicá el motivo').max(500);

// ─── Listas de precios ───
export const PriceListUpsertSchema = z
  .object({
    name: z.string().trim().min(1, 'Requerido').max(80),
    kind: z.enum(['WHOLESALE', 'RETAIL', 'SPECIAL']).default('WHOLESALE'),
    includesVat: z.boolean().default(false),
    baseListId: zUuid().optional().nullable(),
    markupPct: zDecimal({ scale: 2 }).optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => !v.baseListId === !v.markupPct, { message: 'Una lista derivada necesita la lista base y el porcentaje', path: ['markupPct'] });
export type PriceListUpsertInput = z.infer<typeof PriceListUpsertSchema>;

export const PriceSetSchema = z.object({
  validFrom: optionalDate(),
  prices: z
    .array(
      z
        .object({ productId: zUuid().optional().nullable(), itemId: zUuid().optional().nullable(), price: zMoney() })
        .refine((p) => !p.productId !== !p.itemId, { message: 'Indicá el modelo o la variante' }),
    )
    .min(1),
});
export type PriceSetInput = z.infer<typeof PriceSetSchema>;

export const PriceBulkUpdateSchema = z.object({
  pct: zDecimal({ scale: 2 }).refine((v) => Number(v) > -100 && Number(v) !== 0, { message: 'Porcentaje inválido' }),
  /** Redondear hacia arriba a múltiplos de este valor (p.ej. 10 o 100). */
  roundTo: zDecimal({ scale: 2 }).optional().nullable(),
  /** Vacío = todos los modelos con precio en la lista. */
  productIds: z.array(zUuid()).optional(),
  validFrom: optionalDate(),
});
export type PriceBulkUpdateInput = z.infer<typeof PriceBulkUpdateSchema>;

export const SalesRepUpsertSchema = z.object({ userId: zUuid(), commissionPct: pct(), isActive: z.boolean().default(true) });

// ─── Promociones (RF-VEN-08) ───
export const PROMOTION_SCOPES = ['ALL', 'PRODUCTS', 'CATEGORIES', 'COLLECTIONS'] as const;
export type PromotionScopeCode = (typeof PROMOTION_SCOPES)[number];
export const PROMOTION_SCOPE_LABELS: Record<PromotionScopeCode, string> = {
  ALL: 'Todos los modelos',
  PRODUCTS: 'Modelos elegidos',
  CATEGORIES: 'Categorías',
  COLLECTIONS: 'Colecciones',
};
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
export const PromotionUpsertSchema = z
  .object({
    name: z.string().trim().min(3, 'Poné un nombre que se entienda en el pedido').max(80),
    discountPct: zDecimal({ scale: 2, positive: true }).refine((v) => Number(v) <= 100, { message: 'Hasta 100 %' }),
    /** Unidades mínimas del pedido dentro del alcance (0 = sin mínimo). */
    minQty: zDecimal({ scale: 4 }).default('0').refine((v) => Number(v) >= 0, { message: 'No puede ser negativo' }),
    scope: z.enum(PROMOTION_SCOPES),
    targetIds: z.array(zUuid()).max(500).default([]),
    customerIds: z.array(zUuid()).max(500).default([]),
    priceListIds: z.array(zUuid()).max(50).default([]),
    validFrom: isoDay,
    validTo: isoDay.optional().nullable().transform((v) => v ?? null),
    isActive: z.boolean().default(true),
    notes: optionalText(500),
  })
  .refine((p) => p.scope === 'ALL' || p.targetIds.length > 0, { message: 'Elegí a qué modelos, categorías o colecciones aplica', path: ['targetIds'] })
  .refine((p) => !p.validTo || p.validTo >= p.validFrom, { message: 'La fecha hasta no puede ser anterior a la fecha desde', path: ['validTo'] })
  .transform((p) => ({ ...p, targetIds: p.scope === 'ALL' ? [] : p.targetIds }));
export type PromotionUpsertInput = z.infer<typeof PromotionUpsertSchema>;

// ─── Pedidos ───
const OrderLineSchema = z.object({
  itemId: zUuid(),
  qty: positiveQty(),
  /** Solo quien administra precios puede cambiar el de lista (neto de IVA). */
  unitPrice: zDecimal({ scale: 6 }).optional().nullable(),
  discountPct: pct().optional().nullable(),
});

export const SalesOrderUpsertSchema = z.object({
  customerId: zUuid(),
  warehouseId: zUuid(),
  priceListId: zUuid().optional().nullable(),
  sellerUserId: zUuid().optional().nullable(),
  paymentTermId: zUuid().optional().nullable(),
  promisedAt: optionalDate(),
  deliveryAddress: optionalText(300),
  notes: optionalText(2000),
  lines: z
    .array(OrderLineSchema)
    .min(1, 'Cargá al menos una línea')
    .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, { message: 'Hay artículos repetidos' }),
  version: z.number().int().optional(),
});
export type SalesOrderUpsertInput = z.infer<typeof SalesOrderUpsertSchema>;

export const SalesOrderConfirmSchema = z.object({
  /** Obligatorio si el pedido supera el crédito y quien confirma puede autorizarlo. */
  creditOverrideNote: optionalText(500),
});

export const SalesOrderCloseSchema = z.object({ reason: reason() });

// ─── Remitos ───
export const DeliveryCreateSchema = z.object({
  orderId: zUuid(),
  issueDate: optionalDate(),
  carrier: optionalText(100),
  packages: z.number().int().min(1).max(9999).optional().nullable(),
  notes: optionalText(1000),
  lines: z.array(z.object({ orderLineId: zUuid(), qty: positiveQty() })).min(1, 'Indicá qué se entrega'),
});
export type DeliveryCreateInput = z.infer<typeof DeliveryCreateSchema>;

export const VoidSchema = z.object({ reason: reason() });

// ─── Comprobantes de venta ───
export const SalesInvoiceCreateSchema = z.object({
  customerId: zUuid(),
  deliveryIds: z.array(zUuid()).min(1, 'Elegí al menos un remito'),
  issueDate: optionalDate(),
  notes: optionalText(1000),
});
export type SalesInvoiceCreateInput = z.infer<typeof SalesInvoiceCreateSchema>;

const ConceptLineSchema = z.object({
  description: z.string().trim().min(3).max(200),
  net: positiveMoney(),
  vatRate: z.enum(['0', '10.5', '21', '27']).default('21'),
});

export const CreditNoteCreateSchema = z
  .object({
    invoiceId: zUuid(),
    reason: reason(),
    issueDate: optionalDate(),
    /** Devolución: reingresa la mercadería a este depósito al costo de salida. */
    returnWarehouseId: zUuid().optional().nullable(),
    /** Devolución o anulación parcial por cantidades de la factura. */
    lines: z.array(z.object({ invoiceLineId: zUuid(), qty: positiveQty() })).default([]),
    /** Bonificaciones o ajustes de precio sin mercadería. */
    concepts: z.array(ConceptLineSchema).default([]),
  })
  .refine((v) => v.lines.length + v.concepts.length > 0, { message: 'Indicá qué se acredita', path: ['lines'] })
  .refine((v) => !v.returnWarehouseId || v.lines.length > 0, { message: 'La devolución necesita las cantidades devueltas', path: ['lines'] });
export type CreditNoteCreateInput = z.infer<typeof CreditNoteCreateSchema>;

export const DebitNoteCreateSchema = z.object({
  invoiceId: zUuid(),
  reason: reason(),
  issueDate: optionalDate(),
  concepts: z.array(ConceptLineSchema).min(1),
});
export type DebitNoteCreateInput = z.infer<typeof DebitNoteCreateSchema>;

// ─── Cobros e imputaciones ───
export const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'CHEQUE', 'ECHEQ', 'CARD', 'MERCADO_PAGO', 'RETENTION'] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CHEQUE: 'Cheque',
  ECHEQ: 'E-cheq',
  CARD: 'Tarjeta',
  MERCADO_PAGO: 'Mercado Pago',
  RETENTION: 'Retención sufrida',
};

const AllocationLine = z.object({ entryId: zUuid(), amount: positiveMoney() });

export const ReceiptCreateSchema = z.object({
  customerId: zUuid(),
  date: optionalDate(),
  notes: optionalText(1000),
  payments: z
    .array(
      z
        .object({
          method: z.enum(PAYMENT_METHODS),
          amount: positiveMoney(),
          reference: optionalText(100),
          bank: optionalText(100),
          dueDate: optionalDate(),
          /** Caja, banco o billetera donde entra. Si falta se usa la primera activa del tipo que corresponde. */
          cashAccountId: zUuid().optional().nullable(),
          /** Cheques: librador (si no es el mismo cliente) y fecha de emisión. */
          drawerName: optionalText(150),
          drawerTaxId: optionalText(13),
          issueDate: optionalDate(),
        })
        .refine((p) => !['CHEQUE', 'ECHEQ'].includes(p.method) || (p.reference && p.bank && p.dueDate), {
          message: 'El cheque necesita banco, número y fecha de pago',
        }),
    )
    .min(1, 'Indicá cómo pagó'),
  /** Imputaciones a facturas o débitos. Lo no imputado queda como saldo a favor. */
  allocations: z.array(AllocationLine).default([]),
});
export type ReceiptCreateInput = z.infer<typeof ReceiptCreateSchema>;

export const AllocateSchema = z.object({
  creditEntryId: zUuid(),
  allocations: z.array(AllocationLine).min(1),
});
export type AllocateInput = z.infer<typeof AllocateSchema>;

export const CommissionSettleSchema = z.object({ sellerUserId: zUuid(), periodTo: z.union([z.string(), z.date()]).transform((v) => new Date(v)), notes: optionalText(500) });
