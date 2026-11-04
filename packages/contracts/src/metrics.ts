/**
 * Definiciones de los indicadores del tablero de Dirección. Son la fuente única: las muestra el ⓘ de
 * cada número y las repite docs/METRICS.md. Si cambia un cálculo, cambia acá y en el servicio.
 */
export interface MetricDefinition {
  label: string;
  definition: string;
  formula: string;
  /** Contra qué se compara; null si no hay comparación confiable. */
  comparison: string | null;
}

export const EXECUTIVE_METRICS = {
  sales: {
    label: 'Vendido en el mes',
    definition: 'Facturación neta de IVA del mes en curso: facturas y notas de débito menos notas de crédito, solo comprobantes vigentes.',
    formula: 'Σ neto (F + ND − NC) con fecha de emisión del 1 del mes a hoy',
    comparison: 'Mismo tramo del mes anterior (del 1 al mismo día)',
  },
  collected: {
    label: 'Cobrado en el mes',
    definition: 'Total de los recibos de cobro vigentes del mes en curso, con todos sus medios (incluidas retenciones sufridas).',
    formula: 'Σ total de recibos con fecha del 1 del mes a hoy',
    comparison: 'Mismo tramo del mes anterior (del 1 al mismo día)',
  },
  available: {
    label: 'Disponible real',
    definition: 'Dinero disponible hoy en cajas, bancos y billeteras, a fecha de valor. No incluye cheques en cartera ni tarjetas a acreditar.',
    formula: 'Σ ingresos − egresos con fecha de valor ≤ hoy en cajas, bancos y billeteras activas',
    comparison: 'Disponible a la misma fecha del mes anterior',
  },
  chequesDue: {
    label: 'Cheques en cartera a 30 días',
    definition: 'Cheques de terceros en cartera cuya fecha de pago es de hoy a 30 días (incluye los ya vencidos que siguen sin depositar).',
    formula: 'Σ importe de cheques de terceros en cartera con fecha de pago ≤ hoy + 30',
    comparison: null,
  },
  overdueReceivables: {
    label: 'Deuda de clientes vencida',
    definition: 'Saldo pendiente de facturas y débitos a clientes con vencimiento anterior a hoy.',
    formula: 'Σ saldo abierto de débitos a clientes con vencimiento < hoy',
    comparison: null,
  },
  payablesDue: {
    label: 'Deuda con proveedores a 30 días',
    definition: 'Saldo pendiente con proveedores y talleres que vence en los próximos 30 días, incluido lo ya vencido.',
    formula: 'Σ saldo abierto de facturas de proveedores y talleres con vencimiento ≤ hoy + 30',
    comparison: null,
  },
} satisfies Record<string, MetricDefinition>;

export type ExecutiveMetricKey = keyof typeof EXECUTIVE_METRICS;

/** Rentabilidad: siempre "margen bruto estimado", nunca resultado contable (RF-COS-03). */
export const PROFITABILITY_METRICS = {
  net: {
    label: 'Vendido neto',
    definition: 'Facturación neta de IVA del período: facturas y notas de débito menos notas de crédito, solo comprobantes vigentes.',
    formula: 'Σ neto (F + ND − NC) con fecha de emisión en el período',
    comparison: null,
  },
  cost: {
    label: 'Costo de lo vendido',
    definition:
      'Costo de salida de la mercadería facturada, tomado del remito (costo promedio ponderado del depósito al entregar; las prendas producidas entran al costo estimado de su ficha). Las notas de crédito con devolución restan el mismo costo; las de bonificación no tienen costo.',
    formula: 'Σ cantidad facturada × costo de salida del remito − devoluciones al mismo costo',
    comparison: null,
  },
  margin: {
    label: 'Margen bruto estimado',
    definition:
      'Vendido neto menos costo de lo vendido. No descuenta gastos, comisiones, fletes ni impuestos: no es el resultado contable.',
    formula: 'Vendido neto − costo de lo vendido; % = margen ÷ vendido neto',
    comparison: null,
  },
} satisfies Record<string, MetricDefinition>;
