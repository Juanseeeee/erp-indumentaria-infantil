'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Columns3, Search } from 'lucide-react';
import { cn } from '@/lib/format';
import { Button, Card, Input } from './ui';

/**
 * Tabla estándar del ERP: búsqueda, paginación server-side y columnas configurables.
 * La visibilidad de columnas se recuerda por usuario en este navegador (preferencia, no dato de negocio).
 */
export function DataTable<T>({
  id,
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Buscar…',
  toolbar,
  empty,
  loading,
  onRowClick,
}: {
  id: string;
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (p: number) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
}) {
  const storageKey = `erp.table.${id}.columns`;
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [showColumns, setShowColumns] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setVisibility(JSON.parse(saved));
    } catch {
      /* sin storage: columnas por defecto */
    }
  }, [storageKey]);

  const table = useReactTable({
    data,
    columns,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: (updater) => {
      setVisibility((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignorar */
        }
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });

  const pages = total && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        {onSearchChange && (
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
            <Input
              aria-label="Buscar"
              data-table-search
              className="pl-8"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        )}
        {toolbar}
        <div className="relative ml-auto">
          <Button variant="ghost" size="sm" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns}>
            <Columns3 className="size-4" aria-hidden /> Columnas
          </Button>
          {showColumns && (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-surface p-2 shadow-lg">
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                    <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                    {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}
                  </label>
                ))}
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-surface-2/60">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className={cn('px-3 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase', (h.column.columnDef.meta as { align?: string })?.align === 'right' && 'text-right')}
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn('border-b border-border last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2')}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn('px-3 py-2', (cell.column.columnDef.meta as { align?: string })?.align === 'right' && 'num text-right')}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data.length === 0 && empty}
        {loading && <p className="p-6 text-sm text-muted">Cargando…</p>}
      </div>
      {onPageChange && total !== undefined && total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted">
          <span className="num">
            {total.toLocaleString('es-AR')} registros · página {page} de {pages}
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" disabled={!page || page <= 1} onClick={() => onPageChange((page ?? 1) - 1)} aria-label="Página anterior">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" disabled={!page || page >= pages} onClick={() => onPageChange((page ?? 1) + 1)} aria-label="Página siguiente">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Debounce simple para búsquedas server-side. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
