'use client';

import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtQty } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface MaterialLine {
  materialItemId: string | null;
  byGarmentColor: boolean;
  colorMap: Record<string, string>;
  qtyPerUnit: string;
  sizeQty: Record<string, string>;
  wastePct: string;
  notes: string | null;
}
interface Version {
  id: string;
  versionNo: number;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  stageIds: string[];
  instructions: string | null;
  activatedAt: string | null;
  materials: MaterialLine[];
}
interface SheetResponse {
  product: { id: string; code: string; name: string; sizeScaleId: string };
  sheet: { versions: Version[] } | null;
  items: { id: string; sku: string; name: string }[];
  colorIds: string[];
  sizeIds: string[];
  estimate: { missingCostItemIds: string[]; variants: { itemId: string; sku: string; materials: string | null; total: string | null; error: string | null }[] } | null;
}

const empty = (): MaterialLine => ({ materialItemId: null, byGarmentColor: false, colorMap: {}, qtyPerUnit: '', sizeQty: {}, wastePct: '0', notes: null });

export default function TechSheetPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const { data, isLoading, error } = useQuery({ queryKey: ['tech-sheet', productId], queryFn: () => api.get<SheetResponse>(`/production/tech-sheets/${productId}`) });
  const config = useQuery({ queryKey: ['production-config'], queryFn: () => api.get<{ stages: { id: string; name: string }[] }>('/production/config') });
  const materials = useQuery({
    queryKey: ['materials', 'all-for-sheet'],
    queryFn: () => api.get<{ rows: { itemId: string; item: { sku: string; name: string } }[] }>('/materials?pageSize=200'),
  });
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<MaterialLine[]>([]);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const versions = data?.sheet?.versions ?? [];
  const draft = versions.find((v) => v.status === 'DRAFT');
  const active = versions.find((v) => v.status === 'ACTIVE');

  useEffect(() => {
    const base = draft ?? active;
    if (base && !editing) {
      setLines(base.materials.map((m) => ({ ...m, sizeQty: Object.fromEntries(Object.entries(m.sizeQty ?? {}).map(([k, v]) => [k, String(v)])) })));
      setStageIds(base.stageIds);
      setInstructions(base.instructions ?? '');
    }
  }, [draft, active, editing]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['tech-sheet', productId] });
  const save = useMutation({
    mutationFn: () => api.put(`/production/tech-sheets/${productId}/draft`, { stageIds, instructions, materials: lines }),
    onSuccess: () => { toast.success('Borrador guardado.'); setEditing(false); refresh(); },
    onError: (e) => toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => `${f.path}: ${f.message}`).join(' · ') : e.message),
  });
  const activate = useMutation({
    mutationFn: () => api.post<{ versionNo: number }>(`/production/tech-sheets/${productId}/activate`),
    onSuccess: (r) => { toast.success(`Versión ${r.versionNo} activa. Las órdenes ya liberadas conservan su versión.`); refresh(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !md) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const editable = can('techsheets.edit') && editing;
  const sizes = md.sizeScales.find((s) => s.id === data.product.sizeScaleId)?.sizes.filter((s) => data.sizeIds.includes(s.id)) ?? [];
  const colors = md.colors.filter((c) => data.colorIds.includes(c.id));
  const matName = (id: string | null) =>
    materials.data?.rows.find((m) => m.itemId === id)?.item.name ?? data.items.find((i) => i.id === id)?.name ?? '—';
  const update = (i: number, patch: Partial<MaterialLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const shown = editing ? lines : (draft ?? active)?.materials ?? [];
  const stageName = (id: string) => config.data?.stages.find((s) => s.id === id)?.name ?? '?';

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`Ficha técnica · ${data.product.name}`}
        description={active ? `Versión vigente: v${active.versionNo} (activa desde ${fmtDateTime(active.activatedAt)})${draft ? ` · hay un borrador v${draft.versionNo}` : ''}` : 'Sin versión activa: no se pueden liberar órdenes de este modelo.'}
        actions={
          can('techsheets.edit') && !editing && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>{draft ? 'Editar borrador' : active ? 'Nueva versión' : 'Cargar ficha'}</Button>
              {draft && <Button loading={activate.isPending} onClick={() => activate.mutate()}>Activar v{draft.versionNo}</Button>}
            </>
          )
        }
      />
      {versions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {versions.map((v) => (
            <Badge key={v.id} tone={v.status === 'ACTIVE' ? 'success' : v.status === 'DRAFT' ? 'warning' : 'neutral'}>
              v{v.versionNo} · {v.status === 'ACTIVE' ? 'vigente' : v.status === 'DRAFT' ? 'borrador' : 'archivada'}
            </Badge>
          ))}
        </div>
      )}

      <Card className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Material</th>
              <th className="px-3 py-2 text-right">Consumo base</th>
              {sizes.map((s) => <th key={s.id} className="px-2 py-2 text-right">{s.code}</th>)}
              <th className="px-3 py-2 text-right">Merma %</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => (
              <tr key={i} className="border-b border-border align-top last:border-0">
                <td className="px-3 py-2">
                  {editable ? (
                    <div className="flex flex-col gap-2">
                      <Select aria-label="Tipo" value={l.byGarmentColor ? 'color' : 'fixed'} onChange={(e) => update(i, { byGarmentColor: e.target.value === 'color' })}>
                        <option value="fixed">Material fijo</option>
                        <option value="color">Según el color de la prenda</option>
                      </Select>
                      {l.byGarmentColor ? (
                        colors.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-xs">
                            <span className="w-20 shrink-0">{c.name}</span>
                            <Select aria-label={`Material para ${c.name}`} value={l.colorMap[c.id] ?? ''} onChange={(e) => update(i, { colorMap: { ...l.colorMap, [c.id]: e.target.value } })}>
                              <option value="">Elegí…</option>
                              {materials.data?.rows.map((m) => <option key={m.itemId} value={m.itemId}>{m.item.name}</option>)}
                            </Select>
                          </label>
                        ))
                      ) : (
                        <Select aria-label="Material" value={l.materialItemId ?? ''} onChange={(e) => update(i, { materialItemId: e.target.value || null })}>
                          <option value="">Elegí…</option>
                          {materials.data?.rows.map((m) => <option key={m.itemId} value={m.itemId}>{m.item.name}</option>)}
                        </Select>
                      )}
                    </div>
                  ) : l.byGarmentColor ? (
                    <>
                      <span className="font-medium">Según color</span>
                      <ul className="text-xs text-muted">{colors.map((c) => <li key={c.id}>{c.name}: {matName(l.colorMap[c.id] ?? null)}</li>)}</ul>
                    </>
                  ) : (
                    matName(l.materialItemId)
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {editable ? (
                    <Input className="num ml-auto w-20 text-right" aria-label="Consumo base" value={l.qtyPerUnit} onChange={(e) => update(i, { qtyPerUnit: e.target.value.replace(',', '.') })} />
                  ) : (
                    <span className="num">{fmtQty(l.qtyPerUnit)}</span>
                  )}
                </td>
                {sizes.map((s) => (
                  <td key={s.id} className="px-2 py-2 text-right">
                    {editable ? (
                      <Input
                        className="num ml-auto w-16 text-right"
                        aria-label={`Consumo talle ${s.code}`}
                        placeholder={l.qtyPerUnit}
                        value={l.sizeQty[s.id] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.replace(',', '.');
                          const next = { ...l.sizeQty };
                          if (v) next[s.id] = v;
                          else delete next[s.id];
                          update(i, { sizeQty: next });
                        }}
                      />
                    ) : (
                      <span className={`num ${l.sizeQty[s.id] ? '' : 'text-muted'}`}>{fmtQty(l.sizeQty[s.id] ?? l.qtyPerUnit)}</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  {editable ? (
                    <Input className="num ml-auto w-16 text-right" aria-label="Merma" value={l.wastePct} onChange={(e) => update(i, { wastePct: e.target.value.replace(',', '.') })} />
                  ) : (
                    <span className="num">{fmtQty(l.wastePct)}</span>
                  )}
                </td>
                {editable && (
                  <td className="px-2 py-2">
                    <button aria-label="Quitar" className="text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="p-6 text-center text-sm text-muted">La ficha todavía no tiene materiales.</p>}
        {editable && (
          <div className="border-t border-border p-3">
            <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, empty()])}><Plus className="size-4" /> Agregar material</Button>
            <span className="ml-3 text-xs text-muted">Consumo por prenda en la unidad de stock del material. Los casilleros por talle vacíos usan el consumo base.</span>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Recorrido de etapas</h2>
          {editable ? (
            <>
              <ol className="mb-2 flex flex-col gap-1">
                {stageIds.map((sid, i) => (
                  <li key={sid} className="flex items-center justify-between rounded border border-border px-2 py-1 text-sm">
                    {i + 1}. {stageName(sid)}
                    <span className="flex gap-1">
                      <button aria-label="Subir" disabled={!i} onClick={() => setStageIds((s) => { const n = [...s]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; })}><ArrowUp className="size-4" /></button>
                      <button aria-label="Bajar" disabled={i === stageIds.length - 1} onClick={() => setStageIds((s) => { const n = [...s]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; })}><ArrowDown className="size-4" /></button>
                      <button aria-label="Quitar" onClick={() => setStageIds((s) => s.filter((x) => x !== sid))}><Trash2 className="size-4" /></button>
                    </span>
                  </li>
                ))}
              </ol>
              <Select aria-label="Agregar etapa" value="" onChange={(e) => e.target.value && setStageIds((s) => [...s, e.target.value])}>
                <option value="">Agregar etapa…</option>
                {config.data?.stages.filter((s) => !stageIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </>
          ) : (
            <p className="text-sm">{stageIds.length ? stageIds.map(stageName).join(' → ') : 'Todas las etapas activas.'}</p>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Instrucciones</h2>
          {editable ? <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} /> : <p className="text-sm whitespace-pre-wrap text-muted">{instructions || '—'}</p>}
        </Card>
      </div>

      {editing && (
        <div className="mt-4 flex gap-2">
          <Button loading={save.isPending} onClick={() => save.mutate()}>Guardar borrador</Button>
          <Button variant="secondary" onClick={() => setEditing(false)}>Descartar cambios</Button>
        </div>
      )}

      {data.estimate && can('costs.view') && (
        <Card className="mt-6 overflow-x-auto">
          <h2 className="border-b border-border px-4 py-3 font-medium">Costo estimado de materiales por prenda (versión vigente)</h2>
          {data.estimate.missingCostItemIds.length > 0 && (
            <p className="px-4 pt-3 text-xs text-warning">Hay materiales sin costo cargado: el estimado está incompleto.</p>
          )}
          <table className="w-full text-sm">
            <tbody>
              {data.estimate.variants.map((v) => (
                <tr key={v.itemId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{v.sku}</td>
                  <td className="num px-4 py-2 text-right">{v.error ? <span className="text-danger">{v.error}</span> : fmtMoney(v.materials)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-muted">A costo promedio actual. Se le suma la tarifa del taller al recibir. Es una estimación, no un costo contable.</p>
        </Card>
      )}
    </div>
  );
}
