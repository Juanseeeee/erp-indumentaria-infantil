'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtQty, DOC_STATUS_LABELS, DOC_TYPE_LABELS } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { ExecutiveDashboard } from '@/components/executive-dashboard';

interface StockRow {
  item_id: string;
  sku: string;
  name: string;
  uom: string;
  available: string;
  min_stock: string | null;
}
interface Summary {
  itemsWithStock: number;
  critical: number;
  finishedUnits: string;
  pendingApproval: number;
  valueFinished: string | null;
  valueMaterials: string | null;
}

/**
 * Inicio: el tablero de Dirección (para quien tiene permiso) y el estado del catálogo y el inventario.
 * Todos los números son reales y se calculan al momento; no se muestran datos inventados.
 */
export default function HomePage() {
  const { data: me } = useMe();
  const can = useCan();
  const inv = can('inventory.view');
  const summary = useQuery({ queryKey: ['inventory-summary'], queryFn: () => api.get<Summary>('/inventory/summary'), enabled: inv });
  const critical = useQuery({
    queryKey: ['stock', 'critical', 'home'],
    queryFn: () => api.get<{ total: number; rows: StockRow[] }>('/inventory/stock?onlyCritical=true&pageSize=8'),
    enabled: inv,
  });
  const products = useQuery({
    queryKey: ['products', 'count'],
    queryFn: () => api.get<{ total: number }>('/catalog/products?pageSize=1&status=ACTIVE'),
    enabled: can('catalog.view'),
  });
  const recent = useQuery({
    queryKey: ['stock-docs', 'recent'],
    queryFn: () =>
      api.get<{ rows: { id: string; number: string; type: string; status: string; createdAt: string }[] }>('/inventory/documents?pageSize=8'),
    enabled: inv,
  });
  const s = summary.data;

  return (
    <div>
      <PageHeader
        title={`Hola, ${me?.user.name.split(' ')[0] ?? ''}`}
        description={can('executive.view') ? 'El negocio de un vistazo: cada número lleva a su detalle y el ⓘ explica cómo se calcula.' : 'Estado del catálogo y del inventario.'}
      />
      {can('executive.view') && (
        <section data-tour="inicio-tablero-direccion" aria-labelledby="executive-title" className="mb-8">
          <h2 id="executive-title" className="sr-only">Tablero de Dirección</h2>
          <ExecutiveDashboard />
        </section>
      )}
      {can('executive.view') && inv && <h2 className="mb-3 font-medium">Catálogo e inventario</h2>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-tour="inicio-indicadores">
        {can('catalog.view') && <Stat label="Modelos activos" value={products.data?.total ?? '—'} />}
        {inv && <Stat label="Prendas terminadas en stock" value={s ? fmtQty(s.finishedUnits) : '—'} hint={`${s?.itemsWithStock ?? '—'} artículos con stock`} />}
        {inv && (
          <Stat
            tour="inicio-stat-stock-critico"
            label="Stock crítico"
            value={s?.critical ?? '—'}
            tone={s?.critical ? 'warning' : undefined}
            hint="Disponible por debajo del mínimo"
          />
        )}
        {inv && <Stat tour="inicio-stat-ajustes" label="Ajustes por aprobar" value={s?.pendingApproval ?? '—'} tone={s?.pendingApproval ? 'warning' : undefined} />}
        {s?.valueFinished != null && <Stat label="Valor producto terminado" value={fmtMoney(s.valueFinished)} hint="Costo promedio · estimado, no contable" />}
        {s?.valueMaterials != null && <Stat label="Valor materias primas" value={fmtMoney(s.valueMaterials)} hint="Costo promedio · estimado, no contable" />}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {inv && (
          <Card tour="inicio-stock-critico">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4 text-warning" aria-hidden /> Stock crítico
              </h2>
              <Link href="/stock?critico=1" className="flex items-center gap-1 text-sm text-accent">
                Ver todo <ArrowRight className="size-3" />
              </Link>
            </div>
            {critical.data?.rows.length ? (
              <ul>
                {critical.data.rows.map((r) => (
                  <li key={r.item_id} className="flex items-center justify-between border-b border-border px-4 py-2 text-sm last:border-0">
                    <Link href={`/stock/${r.item_id}`} className="min-w-0 truncate hover:underline">
                      {r.name} <span className="text-muted">· {r.sku}</span>
                    </Link>
                    <span className="num shrink-0 pl-3 text-warning">
                      {fmtQty(r.available)} / mín. {fmtQty(r.min_stock)} {r.uom}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Ningún artículo está por debajo de su stock mínimo.</p>
            )}
          </Card>
        )}
        {inv && (
          <Card tour="inicio-ultimos-movimientos">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-medium">Últimos movimientos de stock</h2>
              <Link href="/stock/documentos" className="flex items-center gap-1 text-sm text-accent">
                Ver todo <ArrowRight className="size-3" />
              </Link>
            </div>
            {recent.data?.rows.length ? (
              <ul>
                {recent.data.rows.map((d) => (
                  <li key={d.id} className="flex items-center justify-between border-b border-border px-4 py-2 text-sm last:border-0">
                    <Link href={`/stock/documentos/${d.id}`} className="hover:underline">
                      {d.number} · {DOC_TYPE_LABELS[d.type]}
                    </Link>
                    <span className="flex items-center gap-2">
                      <Badge tone={d.status === 'POSTED' ? 'success' : d.status === 'PENDING_APPROVAL' ? 'warning' : 'neutral'}>
                        {DOC_STATUS_LABELS[d.status]}
                      </Badge>
                      <span className="hidden text-xs text-muted sm:inline">{fmtDateTime(d.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Todavía no hay movimientos.</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
