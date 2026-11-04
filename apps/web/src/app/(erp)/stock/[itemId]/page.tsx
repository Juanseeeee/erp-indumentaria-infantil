'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { cn, fmtDateTime, fmtMoney, fmtQty, MOVEMENT_LABELS } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Card, ErrorBox, PageHeader, Select, Spinner } from '@/components/ui';

interface Balance {
  warehouse?: { id: string; code: string; name: string };
  lot: { id: string; code: string } | null;
  onHand: string;
  reserved: string;
  available: string;
  avgCost: string | null;
}
interface ItemHead {
  id: string;
  sku: string;
  name: string;
  kind: string;
  barcode: string | null;
  uom: string;
  minStock: string | null;
  productId: string | null;
}
interface KardexRow {
  id: string;
  occurredAt: string;
  type: string;
  warehouseId: string;
  qty: string;
  balanceAfter: string;
  unitCost: string | null;
  totalCost: string | null;
  reason: string | null;
  source: { type: string; id: string; number: string | null };
  user: string | null;
}

export default function ItemStockPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const can = useCan();
  const { data: md } = useMasterData();
  const [warehouseId, setWarehouseId] = useState('');
  const detail = useQuery({
    queryKey: ['item-balances', itemId],
    queryFn: () => api.get<{ item: ItemHead; balances: Balance[] }>(`/inventory/stock/${itemId}`),
  });
  const kardex = useQuery({
    queryKey: ['kardex', itemId, warehouseId],
    queryFn: () => api.get<KardexRow[]>(`/inventory/kardex${qs({ itemId, warehouseId })}`),
  });
  const whName = (id: string) => md?.warehouses.find((w) => w.id === id)?.name ?? '—';
  const showCost = can('costs.view');

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorBox error={detail.error} />;
  const { item, balances } = detail.data;

  return (
    <div>
      <PageHeader
        title={item.name}
        description={`${item.sku}${item.barcode ? ` · ${item.barcode}` : ''} · unidad: ${item.uom}${item.minStock ? ` · mínimo ${fmtQty(item.minStock)}` : ''}`}
        actions={
          item.productId ? (
            <Link className="text-sm text-accent hover:underline" href={`/catalogo/${item.productId}`}>Ver modelo</Link>
          ) : (
            <Link className="text-sm text-accent hover:underline" href={`/materiales/${item.id}`}>Ver material</Link>
          )
        }
      />
      <Card className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Depósito</th>
              <th className="px-3 py-2 text-left">Lote / partida</th>
              <th className="px-3 py-2 text-right">Físico</th>
              <th className="px-3 py-2 text-right">Reservado</th>
              <th className="px-3 py-2 text-right">Disponible</th>
              {showCost && <th className="px-3 py-2 text-right">Costo promedio</th>}
            </tr>
          </thead>
          <tbody>
            {balances.length ? (
              balances.map((b, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{b.warehouse?.name}</td>
                  <td className="px-3 py-2">{b.lot?.code ?? '—'}</td>
                  <td className="num px-3 py-2 text-right">{fmtQty(b.onHand)}</td>
                  <td className="num px-3 py-2 text-right">{fmtQty(b.reserved)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{fmtQty(b.available)}</td>
                  {showCost && <td className="num px-3 py-2 text-right">{fmtMoney(b.avgCost)}</td>}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">Sin stock en ningún depósito.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Kardex</h2>
        <Select aria-label="Depósito" className="w-56" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">Todos los depósitos</option>
          {md?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Movimiento</th>
              <th className="px-3 py-2 text-left">Documento</th>
              <th className="px-3 py-2 text-left">Depósito</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              {showCost && <th className="px-3 py-2 text-right">Costo unit.</th>}
              <th className="px-3 py-2 text-left">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {(kardex.data ?? []).map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(m.occurredAt)}</td>
                <td className="px-3 py-2">
                  {MOVEMENT_LABELS[m.type] ?? m.type}
                  {m.reason && <span className="block text-xs text-muted">{m.reason}</span>}
                </td>
                <td className="px-3 py-2">
                  {m.source.number ? (
                    <Link className="text-accent hover:underline" href={`/stock/documentos/${m.source.id}`}>{m.source.number}</Link>
                  ) : m.source.type === 'INVENTORY_COUNT' ? (
                    <Link className="text-accent hover:underline" href={`/stock/inventarios/${m.source.id}`}>Inventario</Link>
                  ) : (
                    m.source.type
                  )}
                </td>
                <td className="px-3 py-2">{whName(m.warehouseId)}</td>
                <td className={cn('num px-3 py-2 text-right', m.qty.startsWith('-') ? 'text-danger' : 'text-success')}>
                  {m.qty.startsWith('-') ? '' : '+'}
                  {fmtQty(m.qty)}
                </td>
                <td className="num px-3 py-2 text-right font-medium">{fmtQty(m.balanceAfter)}</td>
                {showCost && <td className="num px-3 py-2 text-right">{fmtMoney(m.unitCost)}</td>}
                <td className="px-3 py-2 text-muted">{m.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!kardex.data?.length && <p className="p-6 text-center text-sm text-muted">Sin movimientos.</p>}
      </Card>
      {!!warehouseId || <p className="mt-2 text-xs text-muted">Con todos los depósitos, el saldo de cada fila corresponde al depósito de ese movimiento.</p>}
    </div>
  );
}
