/**
 * Catálogo de permisos. Formato `modulo.recurso.accion`.
 * Se siembra en la tabla `permissions`; los roles personalizados eligen de esta lista.
 */
export const PERMISSIONS = {
  'settings.company.view': 'Ver datos de la empresa',
  'settings.company.edit': 'Editar datos de la empresa',
  'settings.master.manage': 'Administrar datos maestros (unidades, talles, colores, categorías, depósitos)',
  'users.view': 'Ver usuarios',
  'users.manage': 'Crear, editar y desactivar usuarios',
  'roles.manage': 'Administrar roles y permisos',
  'audit.view': 'Consultar auditoría',
  'alerts.manage': 'Configurar alertas y ver las de todos los usuarios',
  'executive.view': 'Ver el tablero de Dirección (ventas, cobranzas, fondos y deudas)',

  'parties.view': 'Ver clientes, proveedores y talleres',
  'parties.create': 'Crear clientes, proveedores y talleres',
  'parties.edit': 'Editar clientes, proveedores y talleres',
  'parties.credit.view': 'Ver condiciones comerciales y límites de crédito',

  'catalog.view': 'Ver catálogo de productos',
  'catalog.create': 'Crear modelos y variantes',
  'catalog.edit': 'Editar modelos y variantes',

  'materials.view': 'Ver materias primas e insumos',
  'materials.create': 'Crear materias primas',
  'materials.edit': 'Editar materias primas',

  'inventory.view': 'Ver stock y movimientos',
  'inventory.opening': 'Registrar stock inicial',
  'inventory.adjust': 'Registrar ajustes de stock',
  'inventory.adjust.approve': 'Aprobar ajustes de stock sobre el umbral',
  'inventory.transfer': 'Registrar transferencias entre depósitos',
  'inventory.count': 'Realizar inventarios físicos',

  'purchasing.view': 'Ver solicitudes y órdenes de compra',
  'purchasing.order': 'Crear solicitudes y órdenes de compra',
  'purchasing.approve': 'Aprobar órdenes de compra',
  'purchasing.receive': 'Registrar recepciones de mercadería',
  'purchasing.invoice': 'Registrar comprobantes de proveedores',
  'accounts.payable.view': 'Ver cuentas corrientes de proveedores y talleres',

  'production.view': 'Ver órdenes de producción',
  'production.plan': 'Crear, liberar, cerrar y cancelar órdenes de producción',
  'production.materials': 'Entregar y devolver materiales de producción',
  'production.report': 'Informar avances de producción',
  'production.qc': 'Registrar ingresos y control de calidad',
  'production.workshop': 'Enviar y recibir de talleres',
  'production.settle': 'Liquidar servicios de talleres',
  'techsheets.view': 'Ver fichas técnicas',
  'techsheets.edit': 'Crear y activar versiones de fichas técnicas',
  'settings.production': 'Configurar etapas de producción, motivos de falla y tarifas de taller',

  'sales.view': 'Ver pedidos, remitos y comprobantes de venta',
  'sales.order': 'Cargar y confirmar pedidos de venta',
  'sales.credit.override': 'Autorizar pedidos que superan el límite de crédito',
  'sales.deliver': 'Preparar y emitir remitos',
  'sales.invoice': 'Emitir facturas y notas de crédito y débito',
  'sales.prices.manage': 'Administrar listas de precios y cambiar precios en pedidos',
  'sales.commissions.manage': 'Configurar vendedores y liquidar comisiones',
  'accounts.receivable.view': 'Ver cuentas corrientes de clientes',
  'receivables.collect': 'Registrar cobros e imputaciones',
  'treasury.view': 'Consultar cajas, bancos y movimientos de tesorería',
  'treasury.accounts.manage': 'Crear cuentas de tesorería',
  'treasury.move': 'Registrar movimientos de tesorería',
  'payables.pay': 'Registrar órdenes de pago a proveedores y talleres',
  'payables.approve': 'Aprobar órdenes de pago sobre el umbral',
  'periods.close': 'Cerrar períodos (bloquear operaciones con fecha anterior)',
  'periods.reopen': 'Reabrir períodos cerrados',

  'costs.view': 'Ver costos y valorizaciones (información sensible)',
  'data.export': 'Exportar información',
  'data.import': 'Importar información masiva',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

export const PERMISSION_MODULE = (code: string) => code.split('.')[0]!;

const P = (...codes: PermissionCode[]) => codes;

/** Roles iniciales. Son editables por empresa salvo SUPERADMIN. */
export const SYSTEM_ROLES: Record<string, { name: string; permissions: PermissionCode[] }> = {
  SUPERADMIN: { name: 'Superadministrador', permissions: ALL_PERMISSIONS },
  OWNER: {
    name: 'Propietario / Dirección',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'roles.manage' && p !== 'users.manage'),
  },
  ADMIN: {
    name: 'Administración',
    permissions: P(
      'settings.company.view', 'parties.view', 'parties.create', 'parties.edit', 'parties.credit.view',
      'catalog.view', 'materials.view', 'inventory.view', 'costs.view', 'data.export', 'data.import',
      'purchasing.view', 'purchasing.invoice', 'accounts.payable.view', 'production.view', 'production.settle',
      'sales.view', 'sales.order', 'sales.credit.override', 'sales.invoice', 'sales.prices.manage',
      'sales.commissions.manage', 'accounts.receivable.view', 'receivables.collect',
      'treasury.view', 'treasury.accounts.manage', 'treasury.move', 'payables.pay', 'periods.close', 'executive.view', 'alerts.manage',
    ),
  },
  PURCHASING: {
    name: 'Compras',
    permissions: P(
      'parties.view', 'parties.create', 'parties.edit', 'materials.view', 'materials.create', 'materials.edit',
      'inventory.view', 'costs.view', 'data.export', 'purchasing.view', 'purchasing.order', 'purchasing.receive',
      'purchasing.invoice', 'accounts.payable.view', 'production.view', 'techsheets.view',
    ),
  },
  PRODUCTION: {
    name: 'Producción',
    permissions: P(
      'catalog.view', 'materials.view', 'inventory.view', 'parties.view', 'production.view', 'production.plan',
      'production.materials', 'production.report', 'production.qc', 'production.workshop', 'techsheets.view',
      'techsheets.edit', 'purchasing.view', 'purchasing.order', 'settings.production', 'costs.view',
    ),
  },
  WAREHOUSE: {
    name: 'Depósito',
    permissions: P(
      'catalog.view', 'materials.view', 'inventory.view', 'inventory.transfer', 'inventory.count', 'inventory.adjust',
      'purchasing.view', 'purchasing.receive', 'production.view', 'production.materials', 'production.qc',
      'production.workshop', 'sales.view', 'sales.deliver',
    ),
  },
  OPERATOR: {
    name: 'Operario de planta',
    permissions: P('production.view', 'production.report'),
  },
  SALES: {
    name: 'Ventas',
    permissions: P('parties.view', 'parties.create', 'catalog.view', 'inventory.view', 'sales.view', 'sales.order', 'accounts.receivable.view'),
  },
  TREASURY: {
    name: 'Tesorería',
    permissions: P(
      'parties.view', 'parties.credit.view', 'data.export', 'accounts.payable.view', 'accounts.receivable.view',
      'receivables.collect', 'sales.view', 'treasury.view', 'treasury.accounts.manage', 'treasury.move', 'payables.pay',
    ),
  },
  ACCOUNTING: {
    name: 'Contabilidad',
    permissions: P(
      'settings.company.view', 'parties.view', 'parties.credit.view', 'catalog.view', 'materials.view',
      'inventory.view', 'costs.view', 'audit.view', 'data.export', 'purchasing.view', 'accounts.payable.view',
      'production.view', 'techsheets.view', 'sales.view', 'accounts.receivable.view',
      'treasury.view', 'periods.close',
    ),
  },
  AUDITOR: {
    name: 'Auditor / Consulta',
    permissions: ALL_PERMISSIONS.filter(
      (p) => p.endsWith('.view') && p !== 'costs.view',
    ),
  },
};
