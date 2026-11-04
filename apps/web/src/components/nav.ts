import type { PermissionCode } from '@erp/contracts';
import { BookOpen, HandCoins, Percent, ScrollText, Tags, Truck, ArrowLeftRight, Boxes, ClipboardCheck, ClipboardList, Factory, FileText, Gauge, Hammer, History, Home, Inbox, Landmark, ListChecks, Package, Receipt, Scissors, Settings, Shield, ShoppingCart, Users, UserCog, Wallet, Warehouse, Banknote, ReceiptText, TrendingUp, CalendarCheck, ChartColumn, FileSpreadsheet, Bell, BadgePercent } from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  /** Con varios permisos, exige todos. */
  perm?: PermissionCode | PermissionCode[];
  /** Atajo G + tecla. */
  key?: string;
}
export interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Navegación. Solo incluye módulos implementados: no se muestran pantallas vacías ni botones ficticios.
 */
export const NAV: NavSection[] = [
  {
    items: [
      { label: 'Inicio', href: '/', icon: Home, key: 'i' },
      { label: 'Alertas', href: '/alertas', icon: Bell, key: 'a' },
    ],
  },
  {
    title: 'Ventas',
    items: [
      { label: 'Pedidos', href: '/ventas/pedidos', icon: ClipboardList, perm: 'sales.view', key: 'p' },
      { label: 'Remitos', href: '/ventas/remitos', icon: Truck, perm: 'sales.view' },
      { label: 'Comprobantes', href: '/ventas/comprobantes', icon: ScrollText, perm: 'sales.view', key: 'f' },
      { label: 'Cobros', href: '/cobros', icon: HandCoins, perm: 'accounts.receivable.view' },
      { label: 'Cuentas a cobrar', href: '/cuentas-a-cobrar', icon: BookOpen, perm: 'accounts.receivable.view' },
      { label: 'Listas de precios', href: '/ventas/precios', icon: Tags, perm: 'sales.view' },
      { label: 'Promociones', href: '/ventas/promociones', icon: BadgePercent, perm: 'sales.view' },
      { label: 'Comisiones', href: '/ventas/comisiones', icon: Percent, perm: 'sales.view' },
    ],
  },
  {
    title: 'Producción',
    items: [
      { label: 'Mis tareas', href: '/produccion/tareas', icon: ListChecks, perm: 'production.report', key: 't' },
      { label: 'Tablero', href: '/produccion', icon: Gauge, perm: 'production.view' },
      { label: 'Órdenes', href: '/produccion/ordenes', icon: Hammer, perm: 'production.view', key: 'o' },
      { label: 'Fichas técnicas', href: '/produccion/fichas', icon: ClipboardCheck, perm: 'techsheets.view' },
      { label: 'Liquidación de talleres', href: '/produccion/liquidaciones', icon: Wallet, perm: 'production.settle' },
    ],
  },
  {
    title: 'Compras',
    items: [
      { label: 'Solicitudes', href: '/compras/solicitudes', icon: Inbox, perm: 'purchasing.view' },
      { label: 'Órdenes de compra', href: '/compras/ordenes', icon: ShoppingCart, perm: 'purchasing.view' },
      { label: 'Recepciones', href: '/compras/recepciones', icon: Boxes, perm: 'purchasing.view' },
      { label: 'Comprobantes', href: '/compras/comprobantes', icon: Receipt, perm: 'purchasing.view' },
      { label: 'Cuentas a pagar', href: '/cuentas-a-pagar', icon: Landmark, perm: 'accounts.payable.view' },
    ],
  },
  {
    title: 'Finanzas',
    items: [
      { label: 'Tesorería', href: '/tesoreria', icon: Wallet, perm: 'treasury.view' },
      { label: 'Pagos', href: '/pagos', icon: Banknote, perm: 'accounts.payable.view' },
      { label: 'Gastos', href: '/gastos', icon: ReceiptText, perm: 'treasury.view' },
      { label: 'Flujo de fondos', href: '/flujo-de-fondos', icon: TrendingUp, perm: 'treasury.view' },
      { label: 'Cierre de período', href: '/cierre-de-periodo', icon: CalendarCheck, perm: 'periods.close' },
    ],
  },
  {
    title: 'Análisis',
    items: [
      { label: 'Reportes', href: '/reportes', icon: FileSpreadsheet, key: 'r' },
      { label: 'Rentabilidad', href: '/rentabilidad', icon: ChartColumn, perm: ['sales.view', 'costs.view'] },
    ],
  },
  {
    title: 'Catálogo',
    items: [
      { label: 'Modelos', href: '/catalogo', icon: Package, perm: 'catalog.view', key: 'm' },
      { label: 'Materiales', href: '/materiales', icon: Scissors, perm: 'materials.view' },
    ],
  },
  {
    title: 'Inventario',
    items: [
      { label: 'Stock', href: '/stock', icon: Boxes, perm: 'inventory.view', key: 's' },
      { label: 'Movimientos', href: '/stock/documentos', icon: ArrowLeftRight, perm: 'inventory.view' },
      { label: 'Inventarios físicos', href: '/stock/inventarios', icon: ClipboardList, perm: 'inventory.view' },
    ],
  },
  {
    title: 'Terceros',
    items: [
      { label: 'Clientes', href: '/terceros?rol=CUSTOMER', icon: Users, perm: 'parties.view', key: 'c' },
      { label: 'Proveedores', href: '/terceros?rol=SUPPLIER', icon: Factory, perm: 'parties.view' },
      { label: 'Talleres', href: '/terceros?rol=WORKSHOP', icon: Warehouse, perm: 'parties.view' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { label: 'Configuración', href: '/configuracion', icon: Settings, perm: 'settings.master.manage' },
      { label: 'Config. de producción', href: '/produccion/configuracion', icon: FileText, perm: 'settings.production' },
      { label: 'Usuarios', href: '/configuracion/usuarios', icon: UserCog, perm: 'users.view' },
      { label: 'Roles y permisos', href: '/configuracion/roles', icon: Shield, perm: 'users.view' },
      { label: 'Auditoría', href: '/configuracion/auditoria', icon: History, perm: 'audit.view' },
    ],
  },
];
