import { z } from 'zod';

/** Decimales viajan como string para no perder precisión ("1234.56"). */
export const zDecimal = (opts: { scale?: number; min?: string; positive?: boolean } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(',', '.'))
    .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: 'Número inválido' })
    .refine((v) => (opts.scale === undefined ? true : (v.split('.')[1]?.length ?? 0) <= opts.scale), {
      message: `Máximo ${opts.scale} decimales`,
    })
    .refine((v) => (opts.positive ? Number(v) > 0 : true), { message: 'Debe ser mayor a cero' });

export const zQty = () => zDecimal({ scale: 4 });
export const zMoney = () => zDecimal({ scale: 2 });
export const zUuid = () => z.string().uuid('Identificador inválido');
/** Booleano de query string: z.coerce.boolean() toma "false" como true. */
export const zQueryBool = () =>
  z.preprocess((v) => (typeof v === 'string' ? v === 'true' || v === '1' : v), z.boolean());

const trimmed = (max = 200) => z.string().trim().min(1, 'Requerido').max(max);
const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

// ─── Auth ───
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido'),
  password: z.string().min(1, 'Ingresá la contraseña'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const PasswordPolicy = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .regex(/[A-Za-z]/, 'Debe incluir letras')
  .regex(/\d/, 'Debe incluir números');

// ─── Paginación ───
export const ListQuerySchema = z.object({
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  includeInactive: zQueryBool().default(false),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

// ─── CUIT ───
export function isValidCuit(raw: string): boolean {
  const cuit = raw.replace(/\D/g, '');
  if (!/^\d{11}$/.test(cuit)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const total = weights.reduce((acc, w, i) => acc + w * Number(cuit[i]), 0);
  const mod = 11 - (total % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(cuit[10]);
}

// ─── Terceros ───
export const TaxIdTypeSchema = z.enum(['CUIT', 'CUIL', 'DNI', 'OTHER']);
export const TaxConditionSchema = z.enum(['RI', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_ALCANZADO']);
export const PartyRoleSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'WORKSHOP']);

export const PartyUpsertSchema = z
  .object({
    code: z.string().trim().max(30).optional(),
    legalName: trimmed(200),
    tradeName: optionalText(200),
    taxIdType: TaxIdTypeSchema,
    taxId: z.string().trim().transform((v) => v.replace(/[\s.-]/g, '')),
    taxCondition: TaxConditionSchema,
    email: z.string().trim().email('Email inválido').optional().nullable().or(z.literal('').transform(() => null)),
    phone: optionalText(50),
    notes: optionalText(2000),
    roles: z.array(PartyRoleSchema).min(1, 'Elegí al menos un rol'),
    address: z
      .object({ street: trimmed(200), city: optionalText(100), province: optionalText(100), zip: optionalText(20) })
      .optional()
      .nullable(),
    customer: z
      .object({
        creditLimit: zMoney().optional().nullable(),
        discountPct: zDecimal({ scale: 2 }).default('0'),
        paymentTermId: zUuid().optional().nullable(),
        zoneId: zUuid().optional().nullable(),
        priceListId: zUuid().optional().nullable(),
        sellerUserId: zUuid().optional().nullable(),
      })
      .optional(),
    version: z.number().int().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.taxIdType === 'CUIT' || v.taxIdType === 'CUIL') && !isValidCuit(v.taxId)) {
      ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'CUIT/CUIL inválido (dígito verificador)' });
    }
    if (v.taxIdType === 'DNI' && !/^\d{7,8}$/.test(v.taxId)) {
      ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'DNI inválido' });
    }
  });
export type PartyUpsertInput = z.infer<typeof PartyUpsertSchema>;

export const PartyListQuerySchema = ListQuerySchema.extend({ role: PartyRoleSchema.optional() });

// ─── Datos maestros ───
export const UomCreateSchema = z.object({
  code: trimmed(10),
  name: trimmed(50),
  dimension: z.enum(['UNIT', 'LENGTH', 'MASS', 'AREA']),
});
export const UomConversionCreateSchema = z.object({
  fromUomId: zUuid(),
  toUomId: zUuid(),
  factor: zDecimal({ scale: 6, positive: true }),
  itemId: zUuid().optional().nullable(),
});
export const ColorCreateSchema = z.object({
  code: trimmed(20),
  name: trimmed(50),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color hexadecimal inválido')
    .optional()
    .nullable(),
});
export const SizeScaleCreateSchema = z.object({
  name: trimmed(50),
  sizes: z.array(trimmed(20)).min(1, 'Cargá al menos un talle'),
});
export const CategoryCreateSchema = z.object({
  name: trimmed(80),
  kind: z.enum(['PRODUCT', 'MATERIAL', 'EXPENSE']),
  parentId: zUuid().optional().nullable(),
});
export const SeasonCreateSchema = z.object({ name: trimmed(80), year: z.number().int().min(2000).max(2100) });
export const WarehouseCreateSchema = z.object({
  code: trimmed(20),
  name: trimmed(80),
  type: z.enum(['OWN', 'WORKSHOP', 'TRANSIT', 'QUARANTINE']).default('OWN'),
  partyId: zUuid().optional().nullable(),
});

// ─── Catálogo ───
export const ProductCreateSchema = z.object({
  code: trimmed(30),
  name: trimmed(120),
  description: optionalText(2000),
  categoryId: zUuid().optional().nullable(),
  collectionId: zUuid().optional().nullable(),
  sizeScaleId: zUuid(),
  colorIds: z.array(zUuid()).min(1, 'Elegí al menos un color'),
  /** Talles a generar; si se omite, todos los de la escala. */
  sizeIds: z.array(zUuid()).optional(),
  materialText: optionalText(200),
  status: z.enum(['DRAFT', 'ACTIVE', 'DISCONTINUED']).default('DRAFT'),
});
export type ProductCreateInput = z.infer<typeof ProductCreateSchema>;

export const ProductUpdateSchema = z.object({
  name: trimmed(120),
  description: optionalText(2000),
  categoryId: zUuid().optional().nullable(),
  collectionId: zUuid().optional().nullable(),
  materialText: optionalText(200),
  status: z.enum(['DRAFT', 'ACTIVE', 'DISCONTINUED']),
  version: z.number().int(),
});

/** Agrega combinaciones nuevas (p.ej. un color nuevo) sin tocar las existentes. */
export const ProductAddVariantsSchema = z.object({
  colorIds: z.array(zUuid()).default([]),
  sizeIds: z.array(zUuid()).default([]),
});

export const VariantPatchSchema = z.object({
  updates: z
    .array(
      z.object({
        itemId: zUuid(),
        isActive: z.boolean().optional(),
        barcode: z.string().trim().max(50).optional().nullable(),
        minStock: zQty().optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

// ─── Materiales ───
export const MaterialUpsertSchema = z.object({
  sku: trimmed(40),
  name: trimmed(120),
  baseUomId: zUuid(),
  purchaseUomId: zUuid().optional().nullable(),
  categoryId: zUuid().optional().nullable(),
  defaultSupplierId: zUuid().optional().nullable(),
  trackLots: z.boolean().default(false),
  minStock: zQty().optional().nullable(),
  reorderQty: zQty().optional().nullable(),
  barcode: z.string().trim().max(50).optional().nullable(),
  fabricWidthCm: zDecimal({ scale: 2 }).optional().nullable(),
  composition: optionalText(200),
  weightGsm: zDecimal({ scale: 2 }).optional().nullable(),
  colorId: zUuid().optional().nullable(),
});
export type MaterialUpsertInput = z.infer<typeof MaterialUpsertSchema>;

// ─── Inventario ───
export const StockDocumentLineSchema = z.object({
  itemId: zUuid(),
  qty: zQty(),
  unitCost: zDecimal({ scale: 6 }).optional().nullable(),
  lotCode: z.string().trim().max(60).optional().nullable(),
});

export const StockDocumentCreateSchema = z
  .object({
    type: z.enum(['OPENING', 'ADJUSTMENT', 'TRANSFER']),
    warehouseId: zUuid(),
    targetWarehouseId: zUuid().optional().nullable(),
    reason: optionalText(200),
    notes: optionalText(2000),
    lines: z.array(StockDocumentLineSchema).min(1, 'Cargá al menos una línea').max(2000),
    /** Si es true, se postea en el mismo paso (o queda pendiente de aprobación si supera el umbral). */
    post: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'TRANSFER') {
      if (!v.targetWarehouseId) ctx.addIssue({ code: 'custom', path: ['targetWarehouseId'], message: 'Elegí el depósito destino' });
      if (v.targetWarehouseId === v.warehouseId)
        ctx.addIssue({ code: 'custom', path: ['targetWarehouseId'], message: 'El destino debe ser distinto del origen' });
    }
    if (v.type === 'ADJUSTMENT' && !v.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'El motivo del ajuste es obligatorio' });
    }
    v.lines.forEach((l, i) => {
      if (Number(l.qty) === 0) ctx.addIssue({ code: 'custom', path: ['lines', i, 'qty'], message: 'La cantidad no puede ser cero' });
      if (v.type !== 'ADJUSTMENT' && Number(l.qty) < 0)
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'qty'], message: 'La cantidad debe ser positiva' });
      if (v.type === 'OPENING' && (l.unitCost === undefined || l.unitCost === null))
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'unitCost'], message: 'Indicá el costo unitario' });
    });
  });
export type StockDocumentCreateInput = z.infer<typeof StockDocumentCreateSchema>;

export const StockQuerySchema = ListQuerySchema.extend({
  warehouseId: zUuid().optional(),
  kind: z.enum(['VARIANT', 'MATERIAL']).optional(),
  onlyCritical: zQueryBool().default(false),
});

export const KardexQuerySchema = z.object({
  itemId: zUuid(),
  warehouseId: zUuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const CountCreateSchema = z.object({
  warehouseId: zUuid(),
  kind: z.enum(['VARIANT', 'MATERIAL']).optional(),
  itemIds: z.array(zUuid()).optional(),
  notes: optionalText(2000),
});
export const CountLinesPatchSchema = z.object({
  lines: z.array(z.object({ itemId: zUuid(), countedQty: zQty() })).min(1),
});
