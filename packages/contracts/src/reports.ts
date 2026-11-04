import { z } from 'zod';
import type { PermissionCode } from './permissions';

/**
 * Centro de reportes (RF §12). El catálogo es compartido: la API valida parámetros y permisos con él,
 * y la web arma el formulario de cada reporte. Las definiciones de los números están en docs/METRICS.md.
 */
export type ReportColumnType = 'text' | 'date' | 'money' | 'qty' | 'int' | 'pct';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export type ReportParam =
  | { key: string; label: string; type: 'date'; default: 'monthStart' | 'today' | 'yearStart' }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default: string }
  /** Depósitos de la empresa (opcional: vacío = todos). */
  | { key: string; label: string; type: 'warehouse' }
  | { key: string; label: string; type: 'int'; min: number; max: number; default: number }
  | { key: string; label: string; type: 'text'; placeholder?: string; required: boolean };

export const REPORT_CATEGORIES = ['Ventas', 'Inventario', 'Producción', 'Cuentas corrientes', 'Tesorería'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export interface ReportDefinition {
  code: string;
  title: string;
  description: string;
  category: ReportCategory;
  /** Se exigen todos. Exportar además requiere `data.export`. */
  permissions: PermissionCode[];
  params: ReportParam[];
}

const from = { key: 'from', label: 'Desde', type: 'date', default: 'monthStart' } as const;
const to = { key: 'to', label: 'Hasta', type: 'date', default: 'today' } as const;

export const REPORTS = [
  {
    code: 'ventas',
    title: 'Ventas por período',
    description: 'Facturación neta de IVA (facturas y débitos menos créditos) agrupada por mes, cliente, vendedor o modelo.',
    category: 'Ventas',
    permissions: ['sales.view'],
    params: [
      from,
      to,
      {
        key: 'groupBy',
        label: 'Agrupar por',
        type: 'select',
        default: 'month',
        options: [
          { value: 'month', label: 'Mes' },
          { value: 'customer', label: 'Cliente' },
          { value: 'seller', label: 'Vendedor' },
          { value: 'product', label: 'Modelo' },
        ],
      },
    ],
  },
  {
    code: 'ranking',
    title: 'Ranking de productos',
    description: 'Modelos ordenados por neto facturado, con participación y acumulado (curva ABC).',
    category: 'Ventas',
    permissions: ['sales.view'],
    params: [from, to],
  },
  {
    code: 'baja-rotacion',
    title: 'Productos de baja rotación',
    description: 'Modelos con stock que no tuvieron entregas a clientes en los últimos días indicados.',
    category: 'Ventas',
    permissions: ['sales.view', 'inventory.view'],
    params: [{ key: 'days', label: 'Días sin ventas', type: 'int', min: 7, max: 730, default: 90 }],
  },
  {
    code: 'pedidos-pendientes',
    title: 'Pedidos pendientes',
    description: 'Pedidos confirmados con unidades sin entregar, con su atraso respecto de la fecha prometida.',
    category: 'Ventas',
    permissions: ['sales.view'],
    params: [],
  },
  {
    code: 'rentabilidad',
    title: 'Rentabilidad (margen bruto estimado)',
    description: 'Vendido neto, costo de salida y margen bruto estimado por modelo, categoría, cliente, pedido o vendedor. No es el resultado contable.',
    category: 'Ventas',
    permissions: ['sales.view', 'costs.view'],
    params: [
      from,
      to,
      {
        key: 'groupBy',
        label: 'Agrupar por',
        type: 'select',
        default: 'product',
        options: [
          { value: 'product', label: 'Modelo' },
          { value: 'category', label: 'Categoría' },
          { value: 'customer', label: 'Cliente' },
          { value: 'order', label: 'Pedido' },
          { value: 'seller', label: 'Vendedor' },
        ],
      },
    ],
  },
  {
    code: 'stock-valorizado',
    title: 'Stock valorizado',
    description: 'Existencias por artículo y depósito a costo promedio ponderado.',
    category: 'Inventario',
    permissions: ['inventory.view', 'costs.view'],
    params: [{ key: 'warehouseId', label: 'Depósito', type: 'warehouse' }],
  },
  {
    code: 'stock-critico',
    title: 'Stock crítico',
    description: 'Artículos con stock en depósitos propios por debajo de su mínimo, con la reposición sugerida.',
    category: 'Inventario',
    permissions: ['inventory.view'],
    params: [],
  },
  {
    code: 'kardex',
    title: 'Kardex',
    description: 'Movimientos de un artículo con su documento de origen y el saldo después de cada uno.',
    category: 'Inventario',
    permissions: ['inventory.view'],
    params: [{ key: 'sku', label: 'SKU', type: 'text', required: true, placeholder: 'Ej.: BODY-ML-BL-3M' }, from, to, { key: 'warehouseId', label: 'Depósito', type: 'warehouse' }],
  },
  {
    code: 'op-abiertas',
    title: 'Órdenes de producción abiertas',
    description: 'OP liberadas o en proceso con su avance y los días de atraso.',
    category: 'Producción',
    permissions: ['production.view'],
    params: [],
  },
  {
    code: 'materiales-talleres',
    title: 'Materiales en talleres',
    description: 'Lo que está en poder de cada taller externo (materiales y prendas en proceso).',
    category: 'Producción',
    permissions: ['production.view', 'inventory.view'],
    params: [],
  },
  {
    code: 'antiguedad-cobrar',
    title: 'Cuentas a cobrar por antigüedad',
    description: 'Saldo pendiente de cada cliente por tramo de vencimiento a hoy.',
    category: 'Cuentas corrientes',
    permissions: ['accounts.receivable.view'],
    params: [],
  },
  {
    code: 'antiguedad-pagar',
    title: 'Cuentas a pagar por antigüedad',
    description: 'Saldo pendiente con cada proveedor y taller por tramo de vencimiento a hoy.',
    category: 'Cuentas corrientes',
    permissions: ['accounts.payable.view'],
    params: [],
  },
  {
    code: 'cheques',
    title: 'Cartera de cheques',
    description: 'Cheques de terceros por fecha de pago, con quién los entregó y dónde están.',
    category: 'Tesorería',
    permissions: ['treasury.view'],
    params: [
      {
        key: 'status',
        label: 'Estado',
        type: 'select',
        default: 'IN_PORTFOLIO',
        options: [
          { value: 'IN_PORTFOLIO', label: 'En cartera' },
          { value: 'DEPOSITED', label: 'Depositados' },
          { value: 'DELIVERED', label: 'Entregados a terceros' },
          { value: 'REJECTED', label: 'Rechazados' },
          { value: 'ALL', label: 'Todos' },
        ],
      },
    ],
  },
  {
    code: 'caja-bancos',
    title: 'Caja y bancos',
    description: 'Saldo inicial, ingresos, egresos y saldo final de cada cuenta en el período (por fecha de operación).',
    category: 'Tesorería',
    permissions: ['treasury.view'],
    params: [from, to],
  },
  {
    code: 'flujo-90',
    title: 'Flujo proyectado a 90 días',
    description: 'Ingresos, egresos y saldo esperados semana por semana (13 semanas), con lo vencido en la primera.',
    category: 'Tesorería',
    permissions: ['treasury.view'],
    params: [],
  },
  {
    code: 'gastos',
    title: 'Gastos por categoría',
    description: 'Gastos registrados del período por categoría o centro de costo, con su participación.',
    category: 'Tesorería',
    permissions: ['treasury.view'],
    params: [
      from,
      to,
      {
        key: 'groupBy',
        label: 'Agrupar por',
        type: 'select',
        default: 'category',
        options: [
          { value: 'category', label: 'Categoría' },
          { value: 'costCenter', label: 'Centro de costo' },
        ],
      },
    ],
  },
] as const satisfies readonly ReportDefinition[];

export type ReportCode = (typeof REPORTS)[number]['code'];
export const REPORT_CODES = REPORTS.map((r) => r.code) as ReportCode[];
export const findReport = (code: string): ReportDefinition | undefined => (REPORTS as readonly ReportDefinition[]).find((r) => r.code === code);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Fecha inválida');

/** Esquema de validación de los parámetros de un reporte, a partir de su definición. */
export function reportParamsSchema(def: ReportDefinition, defaults: { today: string }) {
  const shape: Record<string, z.ZodTypeAny> = {};
  const monthStart = `${defaults.today.slice(0, 8)}01`;
  const yearStart = `${defaults.today.slice(0, 5)}01-01`;
  for (const p of def.params) {
    if (p.type === 'date') shape[p.key] = isoDate.default(p.default === 'today' ? defaults.today : p.default === 'monthStart' ? monthStart : yearStart);
    else if (p.type === 'select') shape[p.key] = z.enum(p.options.map((o) => o.value) as [string, ...string[]]).default(p.default);
    else if (p.type === 'warehouse') shape[p.key] = z.string().uuid().optional().or(z.literal('').transform(() => undefined));
    else if (p.type === 'int') shape[p.key] = z.coerce.number().int().min(p.min).max(p.max).default(p.default);
    else shape[p.key] = p.required ? z.string().trim().min(1, `Indicá ${p.label}`).max(100) : z.string().trim().max(100).optional();
  }
  return z
    .object(shape)
    .refine((v) => !('from' in v && 'to' in v) || String(v.from) <= String(v.to), { message: 'La fecha desde no puede ser posterior a la fecha hasta.', path: ['from'] });
}

export const REPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** Resultado tabular de cualquier reporte (JSON en pantalla, Excel y PDF salen de acá). */
export interface ReportResult {
  code: string;
  title: string;
  /** Parámetros aplicados en lenguaje natural (ej.: "Del 01/10/2026 al 30/10/2026 · por cliente"). */
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  /** Fila de totales (solo las columnas que suman). */
  totals: Record<string, string | number | null> | null;
  notes: string[];
  generatedAt: string;
}
