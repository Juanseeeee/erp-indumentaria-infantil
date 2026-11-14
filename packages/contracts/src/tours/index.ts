import type { Tour } from './types';
import { TOURS_INICIO } from './inicio';
import { TOURS_VENTAS } from './ventas';
import { TOURS_COMPRAS_FINANZAS } from './compras-finanzas';
import { TOURS_PRODUCCION_CATALOGO } from './produccion-catalogo';
import { TOURS_STOCK_TERCEROS_REPORTES } from './stock-terceros-reportes';
import { TOURS_ADMINISTRACION } from './administracion';

export * from './types';

/** Catálogo de recorridos guiados, por área. Cada archivo exporta un arreglo `Tour[]`. */
export const TOURS: Tour[] = [
  ...TOURS_INICIO,
  ...TOURS_VENTAS,
  ...TOURS_COMPRAS_FINANZAS,
  ...TOURS_PRODUCCION_CATALOGO,
  ...TOURS_STOCK_TERCEROS_REPORTES,
  ...TOURS_ADMINISTRACION,
];

export function findTour(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}

/** ¿Puede el usuario hacer el recorrido? (tiene todos los permisos que pide). */
export function canTakeTour(tour: Tour, permissions: Iterable<string>): boolean {
  const set = new Set(permissions);
  return tour.permissions.every((p) => set.has(p));
}

/**
 * Segmentos fijos que conviven con un segmento variable en la misma carpeta (`/terceros/nuevo` junto a
 * `/terceros/[id]`, `/stock/documentos` junto a `/stock/[itemId]`): un `*` no los toma como un id.
 */
const STATIC_SEGMENTS = new Set(['nuevo', 'nueva', 'documentos', 'inventarios', 'extractos', 'configuracion', 'tareas', 'fichas', 'liquidaciones', 'ordenes', 'comprobantes', 'recepciones', 'solicitudes', 'remitos', 'pedidos', 'precios', 'promociones', 'comisiones', 'usuarios', 'roles', 'auditoria']);

/** Coincidencia de una ruta concreta con la de un paso (`*` = un id cualquiera; la query se ignora). */
export function tourRouteMatches(pattern: string, pathname: string): boolean {
  const clean = (r: string) => r.split('?')[0]!.replace(/\/+$/, '') || '/';
  const p = clean(pattern).split('/');
  const a = clean(pathname).split('/');
  return p.length === a.length && p.every((seg, i) => (seg === '*' ? !STATIC_SEGMENTS.has(a[i]!) : seg === a[i]));
}
