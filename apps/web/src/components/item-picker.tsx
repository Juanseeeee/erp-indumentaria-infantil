'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtQty } from '@/lib/format';
import { useDebounced } from './data-table';
import { Input } from './ui';

export interface PickedItem {
  item_id: string;
  sku: string;
  name: string;
  kind: string;
  uom: string;
  available: string;
  on_hand: string;
}

/**
 * Selector de artículos. Funciona con lector de código de barras (actúa como teclado):
 * si al presionar Enter hay un único resultado, se agrega directamente.
 */
export function ItemPicker({
  onPick,
  warehouseId,
  kind,
  placeholder = 'Buscar por SKU, nombre o escanear código de barras…',
  tour = 'item-picker',
}: {
  onPick: (item: PickedItem) => void;
  warehouseId?: string;
  kind?: 'VARIANT' | 'MATERIAL';
  placeholder?: string;
  /** Ancla de los recorridos guiados (data-tour). */
  tour?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 150);
  const { data } = useQuery({
    queryKey: ['item-picker', dq, warehouseId, kind],
    queryFn: () => api.get<{ rows: PickedItem[] }>(`/inventory/stock${qs({ q: dq, warehouseId, kind, pageSize: 15 })}`),
    enabled: dq.trim().length >= 2,
  });
  const rows = data?.rows ?? [];

  const pick = (it: PickedItem) => {
    onPick(it);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="relative" data-tour={tour}>
      <ScanLine className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
      <Input
        className="pl-8"
        value={q}
        placeholder={placeholder}
        aria-label="Agregar artículo"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          // Escaneo: consulta inmediata sin esperar el debounce.
          const res = await api.get<{ rows: PickedItem[] }>(`/inventory/stock${qs({ q, warehouseId, kind, pageSize: 2 })}`);
          if (res.rows.length === 1) pick(res.rows[0]!);
        }}
      />
      {open && rows.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg" role="listbox">
          {rows.map((r) => (
            <li key={r.item_id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
              >
                <span className="min-w-0 truncate">
                  {r.name} <span className="text-muted">· {r.sku}</span>
                </span>
                <span className="num shrink-0 text-xs text-muted">
                  disp. {fmtQty(r.available)} {r.uom}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
