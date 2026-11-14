import type { PermissionCode } from '../permissions';

/**
 * Recorridos guiados: la plataforma lleva al usuario por las pantallas y resalta dónde tocar.
 *
 * Reglas para escribirlos:
 *  - Solo se describen pantallas, botones y campos que existen. Cada `target` es el valor de un
 *    atributo `data-tour` (o prop `tour`) presente en la pantalla de `route`.
 *  - Los nombres de los botones y campos se citan tal cual aparecen, entre comillas latinas («»).
 *  - Un paso que lleva a otra pantalla tocando algo (abrir un documento de la lista, guardar y pasar
 *    al detalle) usa `waitFor: 'route'`: avanza solo cuando el usuario llega a la ruta del paso siguiente.
 */
export interface TourStep {
  /**
   * Pantalla del paso. Exacta (`/ventas/pedidos/nuevo`, con query si hace falta: `/terceros?rol=CUSTOMER`)
   * o con `*` para un segmento variable (`/ventas/pedidos/*`, el detalle de un pedido). A una ruta exacta
   * el recorrido navega solo; a una con `*` llega el usuario desde el paso anterior.
   */
  route?: string;
  /** Valor de data-tour del elemento a resaltar. Sin target, el globo aparece centrado. */
  target?: string;
  title: string;
  /** Texto breve (1-3 oraciones). Admite **negrita**. */
  body: string;
  /** 'route': sin «Siguiente»; avanza cuando el usuario navega a la ruta del paso siguiente. */
  waitFor?: 'route';
}

export type TourArea =
  | 'Primeros pasos'
  | 'Ventas'
  | 'Cobranzas'
  | 'Compras'
  | 'Pagos y tesorería'
  | 'Producción'
  | 'Stock'
  | 'Catálogo'
  | 'Terceros'
  | 'Reportes y análisis'
  | 'Administración';

export interface Tour {
  /** Identificador estable, en kebab-case (p. ej. `venta-pedido`). */
  id: string;
  area: TourArea;
  /** Título como pregunta o tarea: «Cargar un pedido de venta». */
  title: string;
  /** Una oración: qué se aprende. */
  description: string;
  /** El recorrido se ofrece a quien tenga TODOS estos permisos. Vacío: a todos. */
  permissions: PermissionCode[];
  /** Palabras y frases con las que un usuario preguntaría por esto (sinónimos, coloquialismos). */
  keywords: string[];
  steps: TourStep[];
}
