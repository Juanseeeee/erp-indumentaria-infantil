'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, DOC_STATUS_LABELS, fmtQty, statusTone } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Badge, Button, Card, ConfirmPanel, ErrorBox, Input, PageHeader, Spinner } from '@/components/ui';

interface CountDetail {
  id: string;
  number: string;
  warehouseId: string;
  status: string;
  lines: { id: string; itemId: string; expectedQty: string; countedQty: string | null; difference: string | null; item?: { sku: string; name: string; barcode: string | null } }[];
}

export default function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const [filter, setFilter] = useState('');
  const [scan, setScan] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['count', id], queryFn: () => api.get<CountDetail>(`/inventory/counts/${id}`) });

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.lines.map((l) => [l.itemId, l.countedQty ?? ''])));
  }, [data]);

  const save = useMutation({
    mutationFn: (lines: { itemId: string; countedQty: string }[]) => api.patch(`/inventory/counts/${id}/lines`, { lines }),
    onSuccess: () => {
      toast.success('Conteo guardado.');
      qc.invalidateQueries({ queryKey: ['count', id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const post = useMutation({
    mutationFn: () => api.post<{ adjustedLines: number }>(`/inventory/counts/${id}/post`),
    onSuccess: (r) => {
      toast.success(`Inventario confirmado: ${r.adjustedLines} artículos ajustados.`);
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ['count', id] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const lines = useMemo(() => {
    const f = filter.toLowerCase();
    return (data?.lines ?? []).filter((l) => {
      if (f && !`${l.item?.sku} ${l.item?.name}`.toLowerCase().includes(f)) return false;
      if (onlyDiff && (l.difference === null || /^-?0*(\.0*)?$/.test(l.difference))) return false;
      return true;
    });
  }, [data, filter, onlyDiff]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const editable = data.status === 'OPEN' && can('inventory.count');
  const dirty = data.lines.filter((l) => (draft[l.itemId] ?? '') !== (l.countedQty ?? '') && draft[l.itemId] !== '');
  const counted = data.lines.filter((l) => l.countedQty !== null).length;
  const withDiff = data.lines.filter((l) => l.difference && !/^-?0*(\.0*)?$/.test(l.difference)).length;

  // Lector de códigos: cada escaneo suma 1 al artículo.
  const onScan = () => {
    const code = scan.trim();
    if (!code) return;
    const line = data.lines.find((l) => l.item?.barcode === code || l.item?.sku.toUpperCase() === code.toUpperCase());
    if (!line) {
      toast.error(`El código ${code} no está en este inventario.`);
    } else {
      setDraft((d) => {
        const current = d[line.itemId] ? BigInt(d[line.itemId]!.split('.')[0] || '0') : 0n;
        return { ...d, [line.itemId]: (current + 1n).toString() };
      });
      toast.success(`${line.item?.sku}: +1`, { duration: 800 });
    }
    setScan('');
    scanRef.current?.focus();
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Inventario ${data.number}`}
        description={`${md?.warehouses.find((w) => w.id === data.warehouseId)?.name ?? ''} · ${counted} de ${data.lines.length} contados · ${withDiff} con diferencia`}
        actions={<Badge tone={statusTone(data.status)}>{DOC_STATUS_LABELS[data.status]}</Badge>}
      />
      {editable && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-64 flex-1">
            <ScanLine className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
            <Input
              ref={scanRef}
              className="pl-8"
              placeholder="Escaneá un código de barras (suma 1 por lectura)"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onScan())}
              aria-label="Lector de código de barras"
            />
          </div>
          <Button
            variant="secondary"
            disabled={!dirty.length}
            loading={save.isPending}
            onClick={() => save.mutate(dirty.map((l) => ({ itemId: l.itemId, countedQty: draft[l.itemId]! })))}
          >
            Guardar conteo ({dirty.length})
          </Button>
          {can('inventory.adjust') && (
            <Button disabled={!!dirty.length || !counted} onClick={() => setConfirming(true)}>
              Confirmar inventario
            </Button>
          )}
        </Card>
      )}
      {confirming && (
        <div className="mb-4">
          <ConfirmPanel
            title="Confirmar inventario"
            impact={`Se generarán ajustes de stock para ${withDiff} artículos con diferencia. Los artículos sin contar no se modifican. Esta operación no se puede deshacer (solo con un ajuste nuevo).`}
            confirmLabel="Confirmar y ajustar"
            loading={post.isPending}
            onConfirm={() => post.mutate()}
            onCancel={() => setConfirming(false)}
          />
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <Input className="max-w-xs" placeholder="Filtrar por SKU o nombre…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Solo con diferencia
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                <th className="px-3 py-2 text-left">Artículo</th>
                <th className="px-3 py-2 text-right">Esperado</th>
                <th className="px-3 py-2 text-right">Contado</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {lines.slice(0, 500).map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    {l.item?.name} <span className="text-muted">· {l.item?.sku}</span>
                  </td>
                  <td className="num px-3 py-2 text-right">{fmtQty(l.expectedQty)}</td>
                  <td className="px-3 py-2 text-right">
                    {editable ? (
                      <Input
                        className="num ml-auto w-24 text-right"
                        inputMode="decimal"
                        aria-label={`Contado ${l.item?.sku}`}
                        value={draft[l.itemId] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.replace(',', '.');
                          if (/^\d*\.?\d{0,4}$/.test(v)) setDraft((d) => ({ ...d, [l.itemId]: v }));
                        }}
                      />
                    ) : (
                      <span className="num">{fmtQty(l.countedQty)}</span>
                    )}
                  </td>
                  <td className={cn('num px-3 py-2 text-right', l.difference?.startsWith('-') ? 'text-danger' : l.difference && !/^0*(\.0*)?$/.test(l.difference) ? 'text-success' : 'text-muted')}>
                    {l.difference === null ? '—' : fmtQty(l.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lines.length > 500 && <p className="p-3 text-xs text-muted">Mostrando 500 de {lines.length}. Usá el filtro.</p>}
        </div>
      </Card>
    </div>
  );
}
