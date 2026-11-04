'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn, fmtQty } from '@/lib/format';

export interface GridSize {
  id: string;
  code: string;
}
export interface GridColor {
  id: string;
  name: string;
  hex: string | null;
}
export interface GridCell {
  itemId: string;
  sizeId: string;
  colorId: string;
  isActive: boolean;
  available?: string;
  onHand?: string;
  reserved?: string;
  sku?: string;
}

/**
 * Grilla talle × color: componente central del ERP (catálogo, pedidos, OP, conteos).
 *  - Modo lectura: muestra el dato contextual de cada celda (stock disponible).
 *  - Modo edición: cantidades por celda, navegación con flechas/Enter, totales por fila y columna,
 *    y pegado desde Excel (filas = colores, columnas = talles).
 */
export function VariantGrid({
  sizes,
  colors,
  cells,
  values,
  onChange,
  renderCell,
  hint,
}: {
  sizes: GridSize[];
  colors: GridColor[];
  cells: GridCell[];
  values?: Record<string, string>;
  onChange?: (itemId: string, value: string) => void;
  renderCell?: (cell: GridCell) => ReactNode;
  hint?: (cell: GridCell) => string | undefined;
}) {
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const cellAt = (colorId: string, sizeId: string) => cells.find((c) => c.colorId === colorId && c.sizeId === sizeId);
  const editable = !!onChange;

  const focus = (r: number, c: number) => {
    const color = colors[r];
    const size = sizes[c];
    if (!color || !size) return;
    refs.current[`${color.id}|${size.id}`]?.focus();
    refs.current[`${color.id}|${size.id}`]?.select();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    if (!m) return;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.currentTarget.selectionStart !== e.currentTarget.selectionEnd || e.currentTarget.value)) {
      if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart !== 0) return;
      if (e.key === 'ArrowRight' && e.currentTarget.selectionEnd !== e.currentTarget.value.length) return;
    }
    e.preventDefault();
    focus(r + m[0], c + m[1]);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, r0: number, c0: number) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    text
      .trim()
      .split(/\r?\n/)
      .forEach((line, dr) =>
        line.split('\t').forEach((raw, dc) => {
          const color = colors[r0 + dr];
          const size = sizes[c0 + dc];
          const cell = color && size ? cellAt(color.id, size.id) : undefined;
          const v = raw.trim().replace(',', '.');
          if (cell?.isActive && /^\d*\.?\d*$/.test(v)) onChange?.(cell.itemId, v);
        }),
      );
  };

  const num = (v?: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0); // solo para totales de unidades en pantalla
  const rowTotal = (colorId: string) =>
    sizes.reduce((acc, s) => {
      const cell = cellAt(colorId, s.id);
      return acc + (cell ? num(editable ? values?.[cell.itemId] : cell.available) : 0);
    }, 0);
  const colTotal = (sizeId: string) =>
    colors.reduce((acc, c) => {
      const cell = cellAt(c.id, sizeId);
      return acc + (cell ? num(editable ? values?.[cell.itemId] : cell.available) : 0);
    }, 0);
  const grand = colors.reduce((acc, c) => acc + rowTotal(c.id), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm" role="grid">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-medium text-muted uppercase">Color \ Talle</th>
            {sizes.map((s) => (
              <th key={s.id} className="px-2 py-2 text-center text-xs font-semibold">
                {s.code}
              </th>
            ))}
            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase">Total</th>
          </tr>
        </thead>
        <tbody>
          {colors.map((color, r) => (
            <tr key={color.id}>
              <th scope="row" className="sticky left-0 z-10 border-t border-border bg-surface px-3 py-1.5 text-left font-medium whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-full border border-border" style={{ background: color.hex ?? 'transparent' }} aria-hidden />
                  {color.name}
                </span>
              </th>
              {sizes.map((size, c) => {
                const cell = cellAt(color.id, size.id);
                if (!cell) {
                  return (
                    <td key={size.id} className="border-t border-border px-1 py-1 text-center text-muted" aria-label="Combinación inexistente">
                      ·
                    </td>
                  );
                }
                if (!editable) {
                  return (
                    <td key={size.id} className={cn('num border-t border-border px-2 py-1.5 text-center', !cell.isActive && 'text-muted line-through')} title={cell.sku}>
                      {renderCell ? renderCell(cell) : fmtQty(cell.available)}
                    </td>
                  );
                }
                const h = hint?.(cell);
                return (
                  <td key={size.id} className="border-t border-border p-1">
                    <input
                      ref={(el) => {
                        refs.current[`${color.id}|${size.id}`] = el;
                      }}
                      inputMode="decimal"
                      disabled={!cell.isActive}
                      aria-label={`${color.name} talle ${size.code}`}
                      className="num h-8 w-16 rounded border border-border bg-surface px-1 text-center disabled:bg-surface-2 disabled:opacity-50"
                      value={values?.[cell.itemId] ?? ''}
                      placeholder={h}
                      onChange={(e) => {
                        const v = e.target.value.replace(',', '.');
                        if (/^-?\d*\.?\d{0,4}$/.test(v)) onChange?.(cell.itemId, v);
                      }}
                      onKeyDown={(e) => onKey(e, r, c)}
                      onPaste={(e) => onPaste(e, r, c)}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </td>
                );
              })}
              <td className="num border-t border-border px-3 py-1.5 text-right font-medium">{rowTotal(color.id).toLocaleString('es-AR')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th className="sticky left-0 border-t-2 border-border bg-surface px-3 py-2 text-left text-xs font-medium text-muted uppercase">Total</th>
            {sizes.map((s) => (
              <td key={s.id} className="num border-t-2 border-border px-2 py-2 text-center font-medium">
                {colTotal(s.id).toLocaleString('es-AR')}
              </td>
            ))}
            <td className="num border-t-2 border-border px-3 py-2 text-right font-semibold">{grand.toLocaleString('es-AR')}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
