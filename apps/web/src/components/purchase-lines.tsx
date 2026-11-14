'use client';

import { Trash2 } from 'lucide-react';
import { dec, roundMoney } from '@erp/domain-core';
import { fmtMoney } from '@/lib/format';
import { ItemPicker } from './item-picker';
import { Input, Select } from './ui';

export interface PLine {
  itemId: string;
  sku: string;
  name: string;
  uom: string;
  qty: string;
  unitPrice: string;
  vatRate: string;
}

const norm = (v: string) => v.replace(',', '.');
/** Neto de la línea para mostrar, con decimales exactos (el importe válido lo calcula el servidor). */
const lineNet = (l: PLine) => {
  try {
    return l.qty && l.unitPrice ? roundMoney(dec(l.qty).times(l.unitPrice)).toFixed(2) : '0';
  } catch {
    return '0';
  }
};

/** Editor de líneas de compra: buscar material, cantidad, precio neto e IVA. */
export function PurchaseLines({ lines, setLines, kind = 'MATERIAL' }: { lines: PLine[]; setLines: (fn: (l: PLine[]) => PLine[]) => void; kind?: 'MATERIAL' | 'VARIANT' }) {
  return (
    <>
      <div className="p-3">
        <ItemPicker
          kind={kind}
          onPick={(it) =>
            setLines((ls) => (ls.some((l) => l.itemId === it.item_id) ? ls : [...ls, { itemId: it.item_id, sku: it.sku, name: it.name, uom: it.uom, qty: '', unitPrice: '', vatRate: '21' }]))
          }
        />
      </div>
      <div className="overflow-x-auto" data-tour="compra-lineas-tabla">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Material</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2 text-right">Precio unit. neto</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.itemId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{l.name}<span className="block text-xs text-muted">{l.sku} · {l.uom}</span></td>
                <td className="px-3 py-2 text-right">
                  <Input className="num ml-auto w-24 text-right" inputMode="decimal" aria-label={`Cantidad ${l.sku}`} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: norm(e.target.value) } : x)))} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Input className="num ml-auto w-28 text-right" inputMode="decimal" aria-label={`Precio ${l.sku}`} value={l.unitPrice} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: norm(e.target.value) } : x)))} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Select aria-label={`IVA ${l.sku}`} className="ml-auto w-24" value={l.vatRate} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, vatRate: e.target.value } : x)))}>
                    {['21', '10.5', '27', '0'].map((r) => <option key={r} value={r}>{r.replace('.', ',')} %</option>)}
                  </Select>
                </td>
                <td className="num px-3 py-2 text-right">{fmtMoney(lineNet(l))}</td>
                <td className="px-3 py-2"><button aria-label={`Quitar ${l.sku}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4 text-muted" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lines.length && <p className="p-6 text-center text-sm text-muted">Buscá materiales para agregar.</p>}
      </div>
    </>
  );
}
