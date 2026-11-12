import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { can, type RequestContext } from '../common/context';
import type { Tx } from '../prisma/prisma.service';
import { globalSearch } from '../search/search.controller';

/**
 * Herramientas del asistente. Todas son de SOLO LECTURA, corren con el contexto del usuario
 * (RLS por empresa) y respetan sus permisos: si no puede ver algo en la pantalla, tampoco lo ve acá.
 * El asistente nunca crea, modifica ni anula documentos.
 */

const Texto = z.object({ texto: z.string().trim().min(2).max(100) });

export const TOOL_SCHEMAS = {
  buscar: Texto,
  consultar_stock: Texto,
  consultar_documento: z.object({ numero: z.string().trim().min(1).max(40) }),
} as const;
export type ToolName = keyof typeof TOOL_SCHEMAS;

const textoSchema = (description: string) => ({
  type: 'object' as const,
  properties: { texto: { type: 'string', description } },
  required: ['texto'],
  additionalProperties: false,
});

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'buscar',
    description:
      'Busca en la plataforma clientes, proveedores, talleres, modelos, artículos (variantes y materiales) y documentos de stock por nombre, código, SKU, CUIT o código de barras. Devuelve un enlace a cada resultado. Usala cuando el usuario mencione algo concreto que quiere encontrar o abrir.',
    input_schema: textoSchema('Texto a buscar (mínimo 2 caracteres), p. ej. "Baby Mundo", "CONJ-PINTITAS" o "30-71234567-9".'),
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: 'consultar_stock',
    description:
      'Consulta el stock actual de artículos (variantes de producto o materiales) cuyo SKU, nombre o código de barras coincida: físico, reservado y disponible, total y por depósito. Usala cuando pregunten cuánto hay, si alcanza o dónde está un artículo.',
    input_schema: textoSchema('SKU, parte del nombre o código de barras, p. ej. "BODY-ML" o "interlock celeste".'),
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: 'consultar_documento',
    description:
      'Busca un documento por su número y devuelve tipo, estado, fecha, tercero, total y enlace: pedidos de venta, remitos, facturas y notas de venta, recibos de cobro, órdenes de compra, recepciones, comprobantes de proveedor, órdenes de producción, órdenes de pago y movimientos de stock. Usala cuando el usuario cite un número (p. ej. "PV-000006", "OP-00005", "00001-00000004") o pregunte en qué estado está un documento.',
    input_schema: {
      type: 'object',
      properties: { numero: { type: 'string', description: 'Número completo o parcial del documento.' } },
      required: ['numero'],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
];

/** Texto que muestra el panel mientras corre cada herramienta. */
export const TOOL_LABELS: Record<ToolName, string> = {
  buscar: 'Buscando en la plataforma',
  consultar_stock: 'Consultando stock',
  consultar_documento: 'Buscando el documento',
};

const STATUS: Record<string, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  APPROVED: 'Aprobada',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  PARTIALLY_DELIVERED: 'Entregado parcialmente',
  DELIVERED: 'Entregado',
  PARTIALLY_RECEIVED: 'Recibida parcialmente',
  RECEIVED: 'Recibida',
  RELEASED: 'Liberada',
  IN_PROGRESS: 'En proceso',
  COMPLETED: 'Completada',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
  ISSUED: 'Emitido',
  POSTED: 'Registrado',
  VOIDED: 'Anulado',
  PENDING_AUTH: 'Esperando autorización de ARCA',
  REJECTED: 'Rechazado por ARCA',
};
const statusLabel = (s: string) => STATUS[s] ?? s;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const pad = (n: number, len: number) => String(n).padStart(len, '0');

export async function runTool(tx: Tx, ctx: RequestContext, name: ToolName, input: Record<string, string>): Promise<unknown> {
  switch (name) {
    case 'buscar': {
      const hits = await globalSearch(tx, ctx, input.texto!);
      return hits.length ? hits.map(({ id: _id, ...h }) => h) : { resultados: 0, nota: 'Sin resultados que el usuario pueda ver con sus permisos.' };
    }
    case 'consultar_stock':
      return consultarStock(tx, ctx, input.texto!);
    case 'consultar_documento':
      return consultarDocumento(tx, ctx, input.numero!);
  }
}

async function consultarStock(tx: Tx, ctx: RequestContext, texto: string) {
  if (!can(ctx, 'inventory.view')) return { error: 'El usuario no tiene el permiso inventory.view (ver stock).' };
  const like = `%${texto}%`;
  const rows = await tx.$queryRaw<
    { item_id: string; sku: string; name: string; kind: string; uom: string; min_stock: string | null; warehouse: string | null; on_hand: string; reserved: string }[]
  >`
    WITH found AS (
      SELECT i.id, i.sku, i.name, i.kind::text AS kind, u.code AS uom, i.min_stock::text AS min_stock
      FROM items i JOIN uoms u ON u.id = i.base_uom_id
      WHERE i.is_active AND (i.sku ILIKE ${like} OR i.name ILIKE ${like} OR i.barcode = ${texto})
      ORDER BY i.sku LIMIT 12
    )
    SELECT f.id AS item_id, f.sku, f.name, f.kind, f.uom, f.min_stock, w.name AS warehouse,
           COALESCE(SUM(b.on_hand), 0)::text AS on_hand, COALESCE(SUM(b.reserved), 0)::text AS reserved
    FROM found f
    LEFT JOIN stock_balances b ON b.item_id = f.id
    LEFT JOIN warehouses w ON w.id = b.warehouse_id
    GROUP BY f.id, f.sku, f.name, f.kind, f.uom, f.min_stock, w.name
    ORDER BY f.sku, w.name`;
  if (!rows.length) return { resultados: 0, nota: 'Ningún artículo activo coincide con ese texto.' };
  const items = new Map<string, { sku: string; nombre: string; tipo: string; unidad: string; stockMinimo: string | null; enlace: string; fisico: number; reservado: number; disponible: number; porDeposito: { deposito: string; fisico: number; reservado: number; disponible: number }[] }>();
  for (const r of rows) {
    const it =
      items.get(r.item_id) ??
      items
        .set(r.item_id, {
          sku: r.sku,
          nombre: r.name,
          tipo: r.kind === 'MATERIAL' ? 'Material' : 'Variante de producto',
          unidad: r.uom,
          stockMinimo: r.min_stock,
          enlace: r.kind === 'MATERIAL' ? `/materiales/${r.item_id}` : `/stock/${r.item_id}`,
          fisico: 0,
          reservado: 0,
          disponible: 0,
          porDeposito: [],
        })
        .get(r.item_id)!;
    const onHand = Number(r.on_hand);
    const reserved = Number(r.reserved);
    if (r.warehouse && (onHand !== 0 || reserved !== 0)) {
      it.porDeposito.push({ deposito: r.warehouse, fisico: onHand, reservado: reserved, disponible: onHand - reserved });
    }
    it.fisico += onHand;
    it.reservado += reserved;
    it.disponible += onHand - reserved;
  }
  return [...items.values()];
}

interface DocHit {
  tipo: string;
  numero: string;
  estado: string;
  fecha: string | null;
  tercero?: string | null;
  detalle?: string;
  total?: string;
  enlace: string;
}

async function consultarDocumento(tx: Tx, ctx: RequestContext, raw: string): Promise<unknown> {
  const numero = raw.trim();
  const contains = { contains: numero, mode: 'insensitive' as const };
  const take = 5;
  const hits: (DocHit & { partyId?: string })[] = [];
  const denied: string[] = [];

  if (can(ctx, 'sales.view')) {
    for (const o of await tx.salesOrder.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } })) {
      hits.push({ tipo: 'Pedido de venta', numero: o.number, estado: statusLabel(o.status), fecha: day(o.orderDate), partyId: o.customerId, total: o.netTotal.toString(), detalle: 'Total neto sin IVA', enlace: `/ventas/pedidos/${o.id}` });
    }
    for (const d of await tx.deliveryNote.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } })) {
      hits.push({ tipo: 'Remito', numero: d.number, estado: statusLabel(d.status), fecha: day(d.issueDate), partyId: d.customerId, detalle: d.invoiceId ? 'Facturado' : 'Sin facturar', enlace: `/ventas/remitos/${d.id}` });
    }
  } else denied.push('ventas (sales.view)');

  // Comprobantes fiscales: "00001-00000004", "1-4" o solo el número.
  const m = /^(\d{1,5})\s*-\s*(\d{1,8})$/.exec(numero);
  const fiscalWhere = m ? { pointOfSale: Number(m[1]), number: Number(m[2]) } : /^\d{1,8}$/.test(numero) ? { number: Number(numero) } : null;
  if (fiscalWhere) {
    const directions = [...(can(ctx, 'sales.view') ? (['SALE'] as const) : []), ...(can(ctx, 'purchasing.view') ? (['PURCHASE'] as const) : [])];
    if (directions.length) {
      for (const f of await tx.fiscalDocument.findMany({ where: { ...fiscalWhere, direction: { in: [...directions] } }, take, orderBy: { createdAt: 'desc' } })) {
        const sale = f.direction === 'SALE';
        hits.push({
          tipo: `${sale ? 'Comprobante de venta' : 'Comprobante de proveedor'} ${f.docType}`,
          numero: `${pad(f.pointOfSale, 5)}-${f.number === null ? '(sin número)' : pad(f.number, 8)}`,
          estado: statusLabel(f.status),
          fecha: day(f.issueDate),
          partyId: f.partyId,
          total: f.total.toString(),
          detalle: sale && f.arcaMode === 'SIMULATED' ? 'Autorización ARCA simulada (sin validez fiscal)' : undefined,
          enlace: sale ? `/ventas/comprobantes/${f.id}` : '/compras/comprobantes',
        });
      }
    }
  }

  if (can(ctx, 'accounts.receivable.view')) {
    for (const r of await tx.customerReceipt.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } })) {
      hits.push({ tipo: 'Recibo de cobro', numero: r.number, estado: statusLabel(r.status), fecha: day(r.date), partyId: r.customerId, total: r.total.toString(), enlace: `/cobros/${r.id}` });
    }
  }
  if (can(ctx, 'purchasing.view')) {
    for (const o of await tx.purchaseOrder.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } })) {
      hits.push({ tipo: 'Orden de compra', numero: o.number, estado: statusLabel(o.status), fecha: day(o.date), partyId: o.supplierId, total: o.netTotal.toString(), detalle: 'Total neto sin IVA', enlace: `/compras/ordenes/${o.id}` });
    }
    for (const g of await tx.goodsReceipt.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } })) {
      hits.push({ tipo: 'Recepción de compra', numero: g.number, estado: statusLabel(g.status), fecha: day(g.receivedAt), partyId: g.supplierId, enlace: `/compras/recepciones/${g.id}` });
    }
  } else denied.push('compras (purchasing.view)');
  if (can(ctx, 'production.view')) {
    const orders = await tx.productionOrder.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } });
    const products = await tx.product.findMany({ where: { id: { in: orders.map((o) => o.productId) } }, select: { id: true, code: true, name: true } });
    for (const o of orders) {
      const p = products.find((x) => x.id === o.productId);
      hits.push({ tipo: 'Orden de producción', numero: o.number, estado: statusLabel(o.status), fecha: day(o.dueDate), detalle: p ? `Modelo ${p.code} · ${p.name}${o.dueDate ? ' · fecha = entrega prevista' : ''}` : undefined, enlace: `/produccion/ordenes/${o.id}` });
    }
  } else denied.push('producción (production.view)');
  if (can(ctx, 'accounts.payable.view')) {
    for (const p of await tx.supplierPayment.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } })) {
      hits.push({ tipo: 'Orden de pago', numero: p.number, estado: statusLabel(p.status), fecha: day(p.date), partyId: p.supplierId, total: p.total.toString(), enlace: `/pagos/${p.id}` });
    }
  }
  if (can(ctx, 'inventory.view')) {
    for (const d of await tx.stockDocument.findMany({ where: { number: contains }, take, orderBy: { createdAt: 'desc' } })) {
      hits.push({ tipo: `Movimiento de stock (${d.type})`, numero: d.number, estado: statusLabel(d.status), fecha: day(d.postedAt ?? d.createdAt), enlace: `/stock/documentos/${d.id}` });
    }
  }

  const partyIds = [...new Set(hits.map((h) => h.partyId).filter((x): x is string => !!x))];
  const parties = partyIds.length ? await tx.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, legalName: true } }) : [];
  const out = hits.slice(0, 15).map(({ partyId, ...h }) => ({ ...h, tercero: partyId ? (parties.find((p) => p.id === partyId)?.legalName ?? null) : undefined }));
  if (!out.length) {
    return { resultados: 0, nota: `No hay documentos con ese número que el usuario pueda ver.${denied.length ? ` No se buscó en: ${denied.join(', ')}, por falta de permiso.` : ''}` };
  }
  return out;
}
