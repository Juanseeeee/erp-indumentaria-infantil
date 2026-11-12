import { z } from 'zod';
import { zDecimal, zMoney, zQty, zUuid } from './schemas';

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

// ─── Compras ───
export const VatRateSchema = z.enum(['0', '2.5', '5', '10.5', '21', '27']);

export const PurchaseRequestCreateSchema = z.object({
  neededBy: optionalDate(),
  notes: optionalText(2000),
  productionOrderId: zUuid().optional().nullable(),
  lines: z.array(z.object({ itemId: zUuid(), qty: positiveQty(), supplierId: zUuid().optional().nullable() })).min(1),
});

export const PurchaseOrderCreateSchema = z.object({
  supplierId: zUuid(),
  warehouseId: zUuid(),
  expectedAt: optionalDate(),
  notes: optionalText(2000),
  /** Si se crea desde solicitudes, las líneas quedan vinculadas. */
  requestLineIds: z.array(zUuid()).optional(),
  lines: z
    .array(
      z.object({
        itemId: zUuid(),
        qty: positiveQty(),
        unitPrice: zDecimal({ scale: 6 }),
        vatRate: VatRateSchema.default('21'),
      }),
    )
    .min(1, 'Cargá al menos una línea'),
});
export type PurchaseOrderCreateInput = z.infer<typeof PurchaseOrderCreateSchema>;

export const GoodsReceiptCreateSchema = z.object({
  supplierId: zUuid(),
  warehouseId: zUuid(),
  purchaseOrderId: zUuid().optional().nullable(),
  supplierDeliveryNote: optionalText(60),
  notes: optionalText(2000),
  /** El proveedor no entrega lo que falta: la OC se cierra con esta recepción. */
  closePending: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        poLineId: zUuid().optional().nullable(),
        itemId: zUuid(),
        qty: positiveQty(),
        /** Sin OC el costo es obligatorio; con OC se toma el precio de la OC si no se indica. */
        unitCost: zDecimal({ scale: 6 }).optional().nullable(),
        lotCode: z.string().trim().max(60).optional().nullable(),
      }),
    )
    .min(1),
});
export type GoodsReceiptCreateInput = z.infer<typeof GoodsReceiptCreateSchema>;

export const SupplierInvoiceCreateSchema = z.object({
  supplierId: zUuid(),
  docType: z.enum(['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC']),
  pointOfSale: z.coerce.number().int().min(0).max(99999),
  number: z.coerce.number().int().min(1).max(99999999),
  issueDate: z.coerce.date(),
  dueDate: optionalDate(),
  otherTaxes: zMoney().default('0'),
  notes: optionalText(2000),
  lines: z
    .array(
      z.object({
        receiptLineId: zUuid().optional().nullable(),
        itemId: zUuid().optional().nullable(),
        description: z.string().trim().min(1).max(200),
        qty: positiveQty(),
        unitPrice: zDecimal({ scale: 6 }),
        vatRate: VatRateSchema,
      }),
    )
    .min(1),
});
export type SupplierInvoiceCreateInput = z.infer<typeof SupplierInvoiceCreateSchema>;

// ─── Configuración de producción ───
export const ProductionStageSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(1).max(60),
  sortOrder: z.coerce.number().int().min(0),
  isExternal: z.boolean().default(false),
});
export const DefectReasonSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const WorkshopRateSchema = z.object({
  workshopId: zUuid(),
  productId: zUuid(),
  price: zMoney(),
  validFrom: z.coerce.date(),
});

// ─── Fichas técnicas ───
export const TechSheetMaterialSchema = z
  .object({
    materialItemId: zUuid().optional().nullable(),
    byGarmentColor: z.boolean().default(false),
    colorMap: z.record(zUuid(), zUuid()).default({}),
    qtyPerUnit: positiveQty(),
    sizeQty: z.record(zUuid(), zDecimal({ scale: 4, positive: true })).default({}),
    wastePct: zDecimal({ scale: 2 }).default('0'),
    notes: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (!v.byGarmentColor && !v.materialItemId) ctx.addIssue({ code: 'custom', path: ['materialItemId'], message: 'Elegí el material' });
    if (v.byGarmentColor && Object.keys(v.colorMap).length === 0)
      ctx.addIssue({ code: 'custom', path: ['colorMap'], message: 'Indicá el material para cada color de prenda' });
    if (Number(v.wastePct) < 0 || Number(v.wastePct) >= 100)
      ctx.addIssue({ code: 'custom', path: ['wastePct'], message: 'La merma debe estar entre 0 y 99 %' });
  });

export const TechSheetVersionSaveSchema = z.object({
  stageIds: z.array(zUuid()).default([]),
  instructions: optionalText(5000),
  materials: z.array(TechSheetMaterialSchema).min(1, 'La ficha necesita al menos un material'),
});
export type TechSheetVersionSaveInput = z.infer<typeof TechSheetVersionSaveSchema>;

// ─── Órdenes de producción ───
export const ProductionOrderCreateSchema = z.object({
  productId: zUuid(),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  plannedStart: optionalDate(),
  dueDate: optionalDate(),
  responsibleUserId: zUuid().optional().nullable(),
  materialsWarehouseId: zUuid(),
  outputWarehouseId: zUuid(),
  secondsWarehouseId: zUuid().optional().nullable(),
  notes: optionalText(2000),
  lines: z.array(z.object({ variantItemId: zUuid(), qty: positiveQty() })).min(1, 'Cargá al menos una cantidad'),
});
export type ProductionOrderCreateInput = z.infer<typeof ProductionOrderCreateSchema>;

export const IssueMaterialsSchema = z.object({
  /** Sin taller: consumo interno (corte propio). Con taller: se transfiere a su depósito. */
  workshopId: zUuid().optional().nullable(),
  lines: z.array(z.object({ materialItemId: zUuid(), qty: positiveQty(), lotCode: z.string().trim().max(60).optional().nullable() })).min(1),
  notes: optionalText(500),
});

export const ReturnMaterialsSchema = z.object({
  workshopId: zUuid().optional().nullable(),
  lines: z.array(z.object({ materialItemId: zUuid(), qty: positiveQty() })).min(1),
  notes: optionalText(500),
});

export const WorkshopDispatchCreateSchema = z.object({
  workshopId: zUuid(),
  expectedAt: optionalDate(),
  notes: optionalText(1000),
  /** Prendas a confeccionar por variante. */
  garments: z.array(z.object({ variantItemId: zUuid(), qty: positiveQty() })).min(1),
  /** Materiales que viajan con el envío (se transfieren al depósito del taller). */
  materials: z.array(z.object({ materialItemId: zUuid(), qty: positiveQty(), lotCode: z.string().trim().max(60).optional().nullable() })).default([]),
});

export const ProgressReportSchema = z.object({
  stageId: zUuid(),
  qtyGood: zQty(),
  qtyDefect: zQty().default('0'),
  defectReasonId: zUuid().optional().nullable(),
  notes: optionalText(500),
  /** Marca la etapa como terminada. */
  finishStage: z.boolean().default(false),
});

export const ProductionOutputCreateSchema = z.object({
  dispatchId: zUuid().optional().nullable(),
  notes: optionalText(1000),
  lines: z
    .array(
      z.object({
        variantItemId: zUuid(),
        approvedQty: zQty().default('0'),
        secondQty: zQty().default('0'),
        scrapQty: zQty().default('0'),
        defectReasonId: zUuid().optional().nullable(),
      }),
    )
    .min(1),
});
export type ProductionOutputCreateInput = z.infer<typeof ProductionOutputCreateSchema>;

export const ProductionCancelSchema = z.object({ reason: z.string().trim().min(3, 'Indicá el motivo') });

export const WorkshopSettlementCreateSchema = z.object({
  workshopId: zUuid(),
  outputIds: z.array(zUuid()).min(1, 'Elegí al menos una recepción'),
  deductions: z.array(z.object({ description: z.string().trim().min(1).max(200), amount: zMoney() })).default([]),
  /** Comprobante del taller (si emite factura). Si no, se registra como liquidación interna. */
  invoice: z
    .object({
      docType: z.enum(['FA', 'FB', 'FC']),
      pointOfSale: z.coerce.number().int().min(0).max(99999),
      number: z.coerce.number().int().min(1).max(99999999),
      vatRate: VatRateSchema.default('0'),
    })
    .optional()
    .nullable(),
  issueDate: z.coerce.date(),
  dueDate: optionalDate(),
  notes: optionalText(1000),
});
export type WorkshopSettlementCreateInput = z.infer<typeof WorkshopSettlementCreateSchema>;
