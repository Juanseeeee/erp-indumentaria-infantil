'use client';

import { use, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, fmtDate, fmtDateTime, fmtMoney, fmtQty, isZero, PRIORITY, PROD_STATUS } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { VariantGrid, type GridCell } from '@/components/variant-grid';
import { Badge, Button, Card, ConfirmPanel, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui';

interface Requirement {
  id: string;
  materialItemId: string;
  requiredQty: string;
  issuedQty: string;
  atWorkshopQty: string;
  consumedQty: string;
  returnedQty: string;
  reservedPending: string;
  availableFree: string;
  shortage: string;
  deviation: string | null;
  uom?: string;
  item?: { sku: string; name: string };
}
interface Detail {
  id: string;
  number: string;
  status: string;
  priority: number;
  dueDate: string | null;
  plannedStart: string | null;
  notes: string | null;
  techSheetVersionNo: number | null;
  materialsWarehouseId: string;
  outputWarehouseId: string;
  secondsWarehouseId: string | null;
  estimatedUnitCost: string | null;
  product: { id: string; code: string; name: string };
  sizes: { id: string; code: string }[];
  colors: { id: string; name: string; hex: string | null }[];
  cells: (GridCell & { sku: string })[];
  lines: { id: string; variantItemId: string; plannedQty: string; goodQty: string; secondQty: string; scrapQty: string }[];
  requirements: Requirement[];
  /** Consumo según ficha que falta registrar por las prendas ya ingresadas. */
  pendingConsumption: { materialItemId: string; sku?: string; qty: string }[];
  stages: { id: string; stageId: string; status: string; completedQty: string; defectQty: string; stage?: { name: string; isExternal: boolean }; workshop: { legalName: string } | null }[];
  dispatches: { id: string; number: string; status: string; sentAt: string; expectedAt: string | null; workshopId: string; workshop?: { legalName: string }; lines: { id: string; kind: string; itemId: string; qty: string; receivedQty: string }[] }[];
  outputs: { id: string; number: string; createdAt: string; workshopId: string | null; settlementId: string | null; lines: { variantItemId: string; approvedQty: string; secondQty: string; scrapQty: string; unitCost: string | null }[] }[];
  costs: { id: string; kind: string; materials: string; workshop: string; overhead: string; total: string; goodUnits: string; unitCost: string; computedAt: string }[];
}
interface Config {
  defectReasons: { id: string; name: string }[];
  workshops: { id: string; legalName: string }[];
}

const COST_KIND: Record<string, string> = { ESTIMATED: 'Estimado al liberar', ACTUAL: 'Real al cerrar', CANCELLED: 'Consumido (orden cancelada)' };
const STAGE_STATUS: Record<string, [string, 'neutral' | 'warning' | 'success']> = {
  PENDING: ['Pendiente', 'neutral'],
  IN_PROGRESS: ['En curso', 'warning'],
  DONE: ['Terminada', 'success'],
  SKIPPED: ['Salteada', 'neutral'],
};

export default function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const { data: md } = useMasterData();
  const [tab, setTab] = useState('prendas');
  const [cancelling, setCancelling] = useState(false);
  const [closingShort, setClosingShort] = useState(false);
  const [reason, setReason] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const { data: o, isLoading, error } = useQuery({ queryKey: ['production-order', id], queryFn: () => api.get<Detail>(`/production/orders/${id}`) });
  const config = useQuery({ queryKey: ['production-config'], queryFn: () => api.get<Config>('/production/config') });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['production-order', id] });
    qc.invalidateQueries({ queryKey: ['production-orders'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
  };
  const release = useAction(`/production/orders/${id}/release`, refresh, 'Orden liberada: ficha congelada y materiales reservados.');
  const close = useAction(`/production/orders/${id}/close`, refresh, 'Orden cerrada. Se calculó el costo real.');
  const cancel = useAction(`/production/orders/${id}/cancel`, refresh, 'Orden cancelada.');
  const consume = useAction(`/production/orders/${id}/consume-by-sheet`, refresh, 'Consumo de materiales registrado según la ficha.');
  const purchaseReq = useMutation({
    mutationFn: () => api.post<{ number: string }>(`/production/orders/${id}/purchase-request`),
    onSuccess: (r) => toast.success(`Se creó la solicitud de compra ${r.number}.`),
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !o) return <ErrorBox error={error} />;
  const [label, tone] = PROD_STATUS[o.status] ?? [o.status, 'neutral'];
  const active = ['RELEASED', 'IN_PROGRESS', 'COMPLETED'].includes(o.status);
  const shortages = o.requirements.filter((r) => !isZero(r.shortage));
  const wh = (wid: string | null) => md?.warehouses.find((w) => w.id === wid)?.name ?? '—';

  return (
    <div className="max-w-6xl">
      <PageHeader
        tour="op-detalle-encabezado"
        title={`${o.number} · ${o.product.name}`}
        description={`Entrega ${fmtDate(o.dueDate)} · prioridad ${PRIORITY[o.priority]} · materiales de ${wh(o.materialsWarehouseId)} → ${wh(o.outputWarehouseId)}${o.techSheetVersionNo ? ` · ficha v${o.techSheetVersionNo}` : ''}`}
        actions={
          <>
            <Badge tone={tone}>{label}</Badge>
            {o.status === 'DRAFT' && can('production.plan') && (
              <Button data-tour="op-detalle-liberar" loading={release.isPending} onClick={() => release.mutate({})}>Liberar orden</Button>
            )}
            {active && shortages.length > 0 && can('purchasing.order') && (
              <Button data-tour="op-detalle-pedir-faltantes" variant="secondary" loading={purchaseReq.isPending} onClick={() => purchaseReq.mutate()}>Pedir faltantes a Compras</Button>
            )}
            {['IN_PROGRESS', 'COMPLETED'].includes(o.status) && can('production.plan') && (
              <Button
                data-tour="op-detalle-cerrar"
                variant={o.status === 'COMPLETED' ? 'primary' : 'secondary'}
                loading={close.isPending}
                onClick={() => (o.pendingConsumption.length ? setClosingShort(true) : close.mutate({}))}
              >
                Cerrar y calcular costo
              </Button>
            )}
            {['DRAFT', 'RELEASED', 'IN_PROGRESS'].includes(o.status) && can('production.plan') && !cancelling && (
              <Button data-tour="op-detalle-cancelar" variant="ghost" onClick={() => setCancelling(true)}>Cancelar</Button>
            )}
          </>
        }
      />
      {cancelling && (
        <div className="mb-4" data-tour="op-detalle-panel-cancelar">
          <ConfirmPanel
            title={`Cancelar ${o.number}`}
            impact="Se liberan las reservas de materiales. Si hay materiales en poder de talleres, primero hay que registrar su devolución o el faltante. Lo ya consumido queda registrado como costo de la orden cancelada."
            requireReason
            reason={reason}
            setReason={setReason}
            confirmLabel="Cancelar orden"
            loading={cancel.isPending}
            onConfirm={() => cancel.mutate({ reason }, { onSuccess: () => setCancelling(false) })}
            onCancel={() => setCancelling(false)}
          />
        </div>
      )}
      {closingShort && (
        <div className="mb-4" data-tour="op-detalle-panel-cerrar">
          <ConfirmPanel
            title={`Cerrar ${o.number} sin registrar todo el consumo`}
            impact={`Falta consumir según la ficha: ${o.pendingConsumption.map((p) => `${p.sku} ${fmtQty(p.qty)}`).join(', ')}. Si el material se usó, primero registrá la recepción de la compra y «Consumir según ficha»: si cerrás así, el costo real no lo incluye.`}
            requireReason
            reason={closeReason}
            setReason={setCloseReason}
            confirmLabel="Cerrar igual"
            loading={close.isPending}
            onConfirm={() => close.mutate({ acceptPendingConsumption: true, reason: closeReason }, { onSuccess: () => setClosingShort(false) })}
            onCancel={() => setClosingShort(false)}
          />
        </div>
      )}
      {active && o.pendingConsumption.length > 0 && (
        <div data-tour="op-detalle-consumo-pendiente" className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4" aria-hidden />
          <span className="flex-1">
            Consumo de materiales pendiente por las prendas ya ingresadas: {o.pendingConsumption.map((p) => `${p.sku} (${fmtQty(p.qty)})`).join(', ')}. Cuando el material esté en stock (recepción de compra registrada), registralo para que el costo real lo incluya.
          </span>
          {can('production.materials') && (
            <Button data-tour="op-detalle-consumir" size="sm" loading={consume.isPending} onClick={() => consume.mutate({})}>Consumir según ficha</Button>
          )}
        </div>
      )}
      {active && shortages.length > 0 && (
        <p data-tour="op-detalle-faltantes" className="mb-4 flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4" aria-hidden /> Faltan materiales: {shortages.map((s) => `${s.item?.sku} (${fmtQty(s.shortage)} ${s.uom ?? ''})`).join(', ')}. Se reservó lo disponible; lo que falta se reserva y consume cuando registres la recepción de la compra.
        </p>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'prendas', label: 'Prendas', tour: 'op-tab-prendas' },
          { id: 'materiales', label: 'Materiales', tour: 'op-tab-materiales' },
          { id: 'etapas', label: 'Etapas', tour: 'op-tab-etapas' },
          { id: 'talleres', label: `Talleres (${o.dispatches.length})`, tour: 'op-tab-talleres' },
          { id: 'ingresos', label: `Ingresos y calidad (${o.outputs.length})`, tour: 'op-tab-ingresos' },
          ...(can('costs.view') ? [{ id: 'costos', label: 'Costos', tour: 'op-tab-costos' }] : []),
        ]}
      />

      {tab === 'prendas' && <GarmentsTab o={o} />}
      {tab === 'materiales' && <MaterialsTab o={o} active={active} onDone={refresh} />}
      {tab === 'etapas' && <StagesTab o={o} active={active} reasons={config.data?.defectReasons ?? []} onDone={refresh} />}
      {tab === 'talleres' && <WorkshopsTab o={o} active={active} workshops={config.data?.workshops ?? []} onDone={refresh} />}
      {tab === 'ingresos' && <OutputsTab o={o} active={active} reasons={config.data?.defectReasons ?? []} onDone={refresh} />}
      {tab === 'costos' && <CostsTab o={o} />}
    </div>
  );
}

function GarmentsTab({ o }: { o: Detail }) {
  const [view, setView] = useState<'planned' | 'done' | 'pending'>('planned');
  const cells = o.cells
    .filter((c) => o.lines.some((l) => l.variantItemId === c.itemId))
    .map((c) => {
      const l = o.lines.find((x) => x.variantItemId === c.itemId)!;
      const done = Number(l.goodQty) + Number(l.secondQty) + Number(l.scrapQty);
      const v = view === 'planned' ? Number(l.plannedQty) : view === 'done' ? Number(l.goodQty) : Number(l.plannedQty) - done;
      return { ...c, available: String(v) };
    });
  const sizes = o.sizes.filter((s) => cells.some((c) => c.sizeId === s.id));
  const colors = o.colors.filter((col) => cells.some((c) => c.colorId === col.id));
  const totals = o.lines.reduce(
    (a, l) => ({ planned: a.planned + Number(l.plannedQty), good: a.good + Number(l.goodQty), second: a.second + Number(l.secondQty), scrap: a.scrap + Number(l.scrapQty) }),
    { planned: 0, good: 0, second: 0, scrap: 0 },
  );
  return (
    <Card className="p-4" tour="op-prendas-grilla">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <Select data-tour="op-prendas-vista" aria-label="Vista" className="w-48" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="planned">Planificado</option>
          <option value="done">Aprobado (1ra)</option>
          <option value="pending">Pendiente</option>
        </Select>
        <span className="num text-muted">
          Planificadas {totals.planned} · aprobadas {totals.good} · segunda {totals.second} · descarte {totals.scrap}
        </span>
      </div>
      <VariantGrid sizes={sizes} colors={colors} cells={cells} />
      {o.notes && <p className="mt-3 text-sm text-muted">Observaciones: {o.notes}</p>}
    </Card>
  );
}

function useAction(path: string, onDone: () => void, ok: string) {
  const key = useRef(crypto.randomUUID());
  return useMutation({
    mutationFn: (body: object) => api.post<{ warnings?: string[]; number?: string }>(path, body, { idempotencyKey: key.current }),
    onSuccess: (r) => {
      key.current = crypto.randomUUID();
      toast.success(ok);
      r?.warnings?.forEach((w) => toast.warning(w, { duration: 10_000 }));
      onDone();
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => f.message).join(' · ') : e.message);
    },
  });
}

function MaterialsTab({ o, active, onDone }: { o: Detail; active: boolean; onDone: () => void }) {
  const can = useCan();
  const [mode, setMode] = useState<'issue' | 'return' | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const issue = useAction(`/production/orders/${o.id}/issue`, () => { setMode(null); onDone(); }, 'Materiales entregados a planta.');
  const ret = useAction(`/production/orders/${o.id}/return`, () => { setMode(null); onDone(); }, 'Devolución registrada.');
  const start = (m: 'issue' | 'return') => {
    setMode(m);
    setQty(
      Object.fromEntries(
        o.requirements.map((r) => {
          const pend = Number(r.requiredQty) - Number(r.issuedQty);
          return [r.materialItemId, m === 'issue' ? (pend > 0 ? String(Math.round(pend * 10000) / 10000) : '') : ''];
        }),
      ),
    );
  };
  const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([materialItemId, v]) => ({ materialItemId, qty: v }));
  return (
    <Card className="overflow-x-auto" tour="op-materiales-tabla">
      {active && can('production.materials') && (
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Button data-tour="op-materiales-entregar" size="sm" onClick={() => start('issue')}>Entregar a planta (corte propio)</Button>
          <Button data-tour="op-materiales-devolver" size="sm" variant="secondary" onClick={() => start('return')}>Devolver sobrante de planta</Button>
          <span className="w-full text-xs text-muted">
            Corte y planta propia: «Entregar a planta» descuenta del depósito de materiales. Talleres externos: en la pestaña Talleres se arma el envío con las prendas cortadas y los materiales, que pasan al depósito del taller y se consumen al recibir las prendas. Si se ingresan prendas hechas en planta sin haber entregado materiales, se consumen solos según la ficha.
          </span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
            <th className="px-3 py-2 text-left">Material</th>
            <th className="px-3 py-2 text-right">Requerido</th>
            <th className="px-3 py-2 text-right">Reservado</th>
            <th className="px-3 py-2 text-right">Entregado</th>
            <th className="px-3 py-2 text-right">En taller</th>
            <th className="px-3 py-2 text-right">Consumido</th>
            <th className="px-3 py-2 text-right">Devuelto</th>
            <th className="px-3 py-2 text-right">Faltante</th>
            <th className="px-3 py-2 text-right">Desvío</th>
            {mode && <th className="px-3 py-2 text-right">{mode === 'issue' ? 'Entregar' : 'Devolver'}</th>}
          </tr>
        </thead>
        <tbody>
          {o.requirements.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">
                <Link href={`/stock/${r.materialItemId}`} className="hover:underline">{r.item?.name}</Link>
                <span className="block text-xs text-muted">{r.item?.sku} · {r.uom}</span>
              </td>
              <td className="num px-3 py-2 text-right">{fmtQty(r.requiredQty)}</td>
              <td className="num px-3 py-2 text-right">{fmtQty(r.reservedPending)}</td>
              <td className="num px-3 py-2 text-right">{fmtQty(r.issuedQty)}</td>
              <td className={cn('num px-3 py-2 text-right', !isZero(r.atWorkshopQty) && 'font-medium text-accent')}>{fmtQty(r.atWorkshopQty)}</td>
              <td className="num px-3 py-2 text-right">{fmtQty(r.consumedQty)}</td>
              <td className="num px-3 py-2 text-right">{fmtQty(r.returnedQty)}</td>
              <td className={cn('num px-3 py-2 text-right', !isZero(r.shortage) && 'font-medium text-warning')}>{fmtQty(r.shortage)}</td>
              <td
                className={cn('num px-3 py-2 text-right', !r.deviation || isZero(r.deviation) ? 'text-muted' : r.deviation.startsWith('-') ? 'text-success' : 'text-danger')}
                title="Con la orden terminada: consumido − requerido. En curso: solo si se entregó de más."
              >
                {!r.deviation || isZero(r.deviation) ? '—' : `${r.deviation.startsWith('-') ? '' : '+'}${fmtQty(r.deviation)}`}
              </td>
              {mode && (
                <td className="px-3 py-2 text-right">
                  <Input
                    className="num ml-auto w-24 text-right"
                    inputMode="decimal"
                    aria-label={`Cantidad ${r.item?.sku}`}
                    value={qty[r.materialItemId] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.');
                      if (/^\d*\.?\d{0,4}$/.test(v)) setQty((q) => ({ ...q, [r.materialItemId]: v }));
                    }}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!o.requirements.length && <p className="p-6 text-center text-sm text-muted">Los materiales se calculan al liberar la orden, a partir de la ficha técnica.</p>}
      {mode && (
        <div className="flex gap-2 border-t border-border p-3">
          <Button
            data-tour="op-materiales-confirmar"
            disabled={!lines.length}
            loading={issue.isPending || ret.isPending}
            onClick={() => (mode === 'issue' ? issue.mutate({ lines }) : ret.mutate({ lines }))}
          >
            Confirmar {mode === 'issue' ? 'entrega' : 'devolución'}
          </Button>
          <Button variant="secondary" onClick={() => setMode(null)}>Cancelar</Button>
          {mode === 'issue' && <span className="self-center text-xs text-muted">Si se entrega más de lo previsto queda registrado como desvío.</span>}
        </div>
      )}
    </Card>
  );
}

function StagesTab({ o, active, reasons, onDone }: { o: Detail; active: boolean; reasons: { id: string; name: string }[]; onDone: () => void }) {
  const can = useCan();
  const [stageId, setStageId] = useState('');
  const [good, setGood] = useState('');
  const [defect, setDefect] = useState('');
  const [reason, setReason] = useState('');
  const [finish, setFinish] = useState(false);
  const report = useAction(`/production/orders/${o.id}/report`, () => { setGood(''); setDefect(''); setFinish(false); onDone(); }, 'Avance informado.');
  const open = o.stages.filter((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS');
  return (
    <div className="flex flex-col gap-4">
      <Card tour="op-etapas-recorrido">
        <ol>
          {o.stages.map((s, i) => {
            const [l, tone] = STAGE_STATUS[s.status] ?? [s.status, 'neutral'];
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-0">
                <span className="flex items-center gap-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs">{i + 1}</span>
                  <span>
                    {s.stage?.name}
                    {s.workshop && <span className="block text-xs text-muted">Taller: {s.workshop.legalName}</span>}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="num text-xs text-muted">
                    {fmtQty(s.completedQty)} ok{!isZero(s.defectQty) && ` · ${fmtQty(s.defectQty)} con falla`}
                  </span>
                  <Badge tone={tone}>{l}</Badge>
                </span>
              </li>
            );
          })}
        </ol>
        {!o.stages.length && <p className="p-6 text-center text-sm text-muted">El recorrido se define al liberar la orden.</p>}
      </Card>
      {active && can('production.report') && open.length > 0 && (
        <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-5" tour="op-etapas-informe">
          <Field tour="op-etapas-etapa" label="Etapa" htmlFor="st">
            <Select id="st" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">Elegí…</option>
              {open.map((s) => <option key={s.stageId} value={s.stageId}>{s.stage?.name}</option>)}
            </Select>
          </Field>
          <Field tour="op-etapas-ok" label="Prendas OK" htmlFor="good"><Input id="good" inputMode="numeric" value={good} onChange={(e) => setGood(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field tour="op-etapas-falla" label="Con falla" htmlFor="defect"><Input id="defect" inputMode="numeric" value={defect} onChange={(e) => setDefect(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field tour="op-etapas-motivo" label="Motivo de falla" htmlFor="reason">
            <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!defect}>
              <option value="">—</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label data-tour="op-etapas-terminada" className="flex items-center gap-2 text-sm"><input type="checkbox" checked={finish} onChange={(e) => setFinish(e.target.checked)} /> Etapa terminada</label>
            <Button
              data-tour="op-etapas-informar"
              disabled={!stageId || (!good && !defect && !finish)}
              loading={report.isPending}
              onClick={() => report.mutate({ stageId, qtyGood: good || '0', qtyDefect: defect || '0', defectReasonId: reason || null, finishStage: finish })}
            >
              Informar
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function WorkshopsTab({ o, active, workshops, onDone }: { o: Detail; active: boolean; workshops: { id: string; legalName: string }[]; onDone: () => void }) {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const [workshopId, setWorkshopId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const sentByVariant = useMemo(() => {
    const m: Record<string, number> = {};
    o.dispatches.forEach((d) => d.lines.filter((l) => l.kind === 'GARMENT').forEach((l) => (m[l.itemId] = (m[l.itemId] ?? 0) + Number(l.qty))));
    return m;
  }, [o]);
  const [garments, setGarments] = useState<Record<string, string>>({});
  const [materials, setMaterials] = useState<Record<string, string>>({});
  const [wsAction, setWsAction] = useState<{ type: 'return' | 'writeoff'; workshopId: string } | null>(null);
  const [wsQty, setWsQty] = useState<Record<string, string>>({});
  const [wsReason, setWsReason] = useState('');
  const dispatch = useAction(`/production/orders/${o.id}/dispatch`, () => { setCreating(false); onDone(); }, 'Envío al taller registrado (remito generado).');
  const ret = useAction(`/production/orders/${o.id}/return`, () => { setWsAction(null); onDone(); }, 'Devolución del taller registrada.');
  const writeOff = useAction(`/production/orders/${o.id}/workshop-write-off`, () => { setWsAction(null); onDone(); }, 'Faltante registrado.');
  const inWorkshop = o.requirements.filter((r) => !isZero(r.atWorkshopQty));
  const workshopIds = [...new Set(o.dispatches.map((d) => d.workshopId))];

  const startDispatch = () => {
    setCreating(true);
    setGarments(Object.fromEntries(o.lines.map((l) => [l.variantItemId, String(Math.max(0, Number(l.plannedQty) - (sentByVariant[l.variantItemId] ?? 0)))])));
    setMaterials(Object.fromEntries(o.requirements.map((r) => [r.materialItemId, String(Math.max(0, Math.round((Number(r.requiredQty) - Number(r.issuedQty)) * 10000) / 10000))])));
  };
  const cells = o.cells.filter((c) => o.lines.some((l) => l.variantItemId === c.itemId));

  return (
    <div className="flex flex-col gap-4">
      {o.dispatches.map((d) => {
        const g = d.lines.filter((l) => l.kind === 'GARMENT');
        const sent = g.reduce((a, l) => a + Number(l.qty), 0);
        const rec = g.reduce((a, l) => a + Number(l.receivedQty), 0);
        return (
          <Card key={d.id} className="p-4 text-sm" tour="op-talleres-envio">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{d.number} · {d.workshop?.legalName}</p>
              <span className="text-muted">Enviado {fmtDateTime(d.sentAt)} · esperado {fmtDate(d.expectedAt)}</span>
            </div>
            <p className="num mt-1">Prendas: {rec} recibidas de {sent} enviadas{sent - rec > 0 && d.status !== 'CLOSED' ? ` · ${sent - rec} pendientes` : ''}{d.status === 'CLOSED' && sent - rec > 0 ? ` · ${sent - rec} faltantes al cierre` : ''}</p>
            {d.lines.some((l) => l.kind === 'MATERIAL') && (
              <p className="mt-1 text-muted">
                Materiales: {d.lines.filter((l) => l.kind === 'MATERIAL').map((l) => `${o.requirements.find((r) => r.materialItemId === l.itemId)?.item?.sku ?? ''} ${fmtQty(l.qty)}`).join(' · ')}
              </p>
            )}
          </Card>
        );
      })}

      {inWorkshop.length > 0 && (
        <Card className="p-4" tour="op-talleres-en-poder">
          <p className="mb-2 text-sm font-medium">Materiales de esta orden en poder de talleres</p>
          <ul className="mb-3 text-sm">
            {inWorkshop.map((r) => <li key={r.id} className="num">{r.item?.name}: {fmtQty(r.atWorkshopQty)} {r.uom}</li>)}
          </ul>
          {can('production.materials') &&
            workshopIds.map((w) => (
              <div key={w} className="flex flex-wrap gap-2">
                <Button data-tour="op-talleres-devolucion" size="sm" variant="secondary" onClick={() => { setWsAction({ type: 'return', workshopId: w }); setWsQty({}); }}>
                  Registrar devolución de {workshops.find((x) => x.id === w)?.legalName}
                </Button>
                {can('production.workshop') && (
                  <Button data-tour="op-talleres-faltante" size="sm" variant="ghost" onClick={() => { setWsAction({ type: 'writeoff', workshopId: w }); setWsQty({}); }}>Registrar faltante</Button>
                )}
              </div>
            ))}
          {wsAction && (
            <div data-tour="op-talleres-cantidades" className="mt-3 flex flex-col gap-2 rounded-md border border-border p-3">
              {inWorkshop.map((r) => (
                <label key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  {r.item?.name} (en taller {fmtQty(r.atWorkshopQty)})
                  <Input className="num w-24 text-right" inputMode="decimal" value={wsQty[r.materialItemId] ?? ''} onChange={(e) => setWsQty((q) => ({ ...q, [r.materialItemId]: e.target.value.replace(',', '.') }))} />
                </label>
              ))}
              {wsAction.type === 'writeoff' && (
                <Field tour="op-talleres-motivo-faltante" label="Motivo del faltante" htmlFor="wsr"><Input id="wsr" value={wsReason} onChange={(e) => setWsReason(e.target.value)} /></Field>
              )}
              <div className="flex gap-2">
                <Button
                  data-tour="op-talleres-confirmar"
                  size="sm"
                  loading={ret.isPending || writeOff.isPending}
                  onClick={() => {
                    const lines = Object.entries(wsQty).filter(([, v]) => Number(v) > 0).map(([materialItemId, qty]) => ({ materialItemId, qty }));
                    if (wsAction.type === 'return') ret.mutate({ workshopId: wsAction.workshopId, lines });
                    else writeOff.mutate({ workshopId: wsAction.workshopId, lines, reason: wsReason });
                  }}
                >
                  Confirmar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setWsAction(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {active && can('production.workshop') && !creating && (
        <div><Button data-tour="op-talleres-nuevo-envio" onClick={startDispatch}>Nuevo envío a taller</Button></div>
      )}
      {creating && (
        <Card className="flex flex-col gap-4 p-4" tour="op-envio-form">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field tour="op-envio-taller" label="Taller" htmlFor="ws">
              <Select id="ws" value={workshopId} onChange={(e) => setWorkshopId(e.target.value)}>
                <option value="">Elegí…</option>
                {workshops.map((w) => <option key={w.id} value={w.id}>{w.legalName}</option>)}
              </Select>
            </Field>
            <Field tour="op-envio-fecha" label="Fecha esperada de entrega" htmlFor="exp"><Input id="exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
          </div>
          <div data-tour="op-envio-prendas">
            <p className="mb-2 text-sm font-medium">Prendas a confeccionar (precargado: lo pendiente de enviar)</p>
            <VariantGrid sizes={o.sizes.filter((s) => cells.some((c) => c.sizeId === s.id))} colors={o.colors.filter((c) => cells.some((x) => x.colorId === c.id))} cells={cells} values={garments} onChange={(k, v) => setGarments((g) => ({ ...g, [k]: v }))} />
          </div>
          <div data-tour="op-envio-materiales">
            <p className="mb-2 text-sm font-medium">Materiales que viajan con el envío (pasan al depósito del taller)</p>
            {o.requirements.map((r) => (
              <label key={r.id} className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
                <span>{r.item?.name} <span className="text-muted">· reservado {fmtQty(r.reservedPending)} {r.uom}</span></span>
                <Input className="num w-28 text-right" inputMode="decimal" value={materials[r.materialItemId] ?? ''} onChange={(e) => setMaterials((m) => ({ ...m, [r.materialItemId]: e.target.value.replace(',', '.') }))} />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              data-tour="op-envio-confirmar"
              disabled={!workshopId}
              loading={dispatch.isPending}
              onClick={() =>
                dispatch.mutate({
                  workshopId,
                  expectedAt: expectedAt || null,
                  garments: Object.entries(garments).filter(([, v]) => Number(v) > 0).map(([variantItemId, qty]) => ({ variantItemId, qty })),
                  materials: Object.entries(materials).filter(([, v]) => Number(v) > 0).map(([materialItemId, qty]) => ({ materialItemId, qty })),
                })
              }
            >
              Confirmar envío
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function OutputsTab({ o, active, reasons, onDone }: { o: Detail; active: boolean; reasons: { id: string; name: string }[]; onDone: () => void }) {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const [dispatchId, setDispatchId] = useState('');
  const [rows, setRows] = useState<Record<string, { approved: string; second: string; scrap: string; reason: string }>>({});
  const output = useAction(`/production/orders/${o.id}/output`, () => { setCreating(false); onDone(); }, 'Ingreso registrado: lo aprobado ya está en stock.');
  const openDispatches = o.dispatches.filter((d) => d.status === 'SENT' || d.status === 'PARTIALLY_RECEIVED');
  const sku = (vid: string) => o.cells.find((c) => c.itemId === vid)?.sku;
  const pendingFor = (vid: string) => {
    if (dispatchId) {
      const l = o.dispatches.find((d) => d.id === dispatchId)?.lines.find((x) => x.kind === 'GARMENT' && x.itemId === vid);
      return l ? Number(l.qty) - Number(l.receivedQty) : 0;
    }
    const l = o.lines.find((x) => x.variantItemId === vid)!;
    return Number(l.plannedQty) - Number(l.goodQty) - Number(l.secondQty) - Number(l.scrapQty);
  };
  const set = (vid: string, k: 'approved' | 'second' | 'scrap' | 'reason', v: string) =>
    setRows((r) => ({ ...r, [vid]: { ...(r[vid] ?? { approved: '', second: '', scrap: '', reason: '' }), [k]: k === 'reason' ? v : v.replace(/\D/g, '') } }));
  const lines = Object.entries(rows)
    .filter(([, r]) => Number(r.approved) + Number(r.second) + Number(r.scrap) > 0)
    .map(([variantItemId, r]) => ({ variantItemId, approvedQty: r.approved || '0', secondQty: r.second || '0', scrapQty: r.scrap || '0', defectReasonId: r.reason || null }));

  return (
    <div className="flex flex-col gap-4">
      {o.outputs.map((out) => (
        <Card key={out.id} className="p-4 text-sm" tour="op-ingresos-registro">
          <p className="font-medium">
            {out.number} · {fmtDateTime(out.createdAt)} {out.workshopId ? '· recepción de taller' : '· producción interna'}{' '}
            {out.settlementId && <Badge tone="success">Liquidado</Badge>}
          </p>
          <ul className="num mt-1 text-muted">
            {out.lines.map((l, i) => (
              <li key={i}>{sku(l.variantItemId)}: {fmtQty(l.approvedQty)} aprobadas{!isZero(l.secondQty) && ` · ${fmtQty(l.secondQty)} segunda`}{!isZero(l.scrapQty) && ` · ${fmtQty(l.scrapQty)} descarte`}{l.unitCost && ` · costo est. ${fmtMoney(l.unitCost)}`}</li>
            ))}
          </ul>
        </Card>
      ))}
      {active && can('production.qc') && !creating && (
        <div><Button data-tour="op-ingresos-nuevo" onClick={() => { setCreating(true); setRows({}); setDispatchId(openDispatches[0]?.id ?? ''); }}>Registrar ingreso con control de calidad</Button></div>
      )}
      {creating && (
        <Card className="p-4">
          <Field tour="op-ingresos-origen" label="Origen" htmlFor="src" className="mb-3 max-w-md">
            <Select id="src" value={dispatchId} onChange={(e) => { setDispatchId(e.target.value); setRows({}); }}>
              <option value="">Producción interna</option>
              {openDispatches.map((d) => <option key={d.id} value={d.id}>Recepción de {d.workshop?.legalName} ({d.number})</option>)}
            </Select>
          </Field>
          <div className="overflow-x-auto" data-tour="op-ingresos-tabla">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase">
                  <th className="px-2 py-2 text-left">Variante</th>
                  <th className="px-2 py-2 text-right">Pendiente</th>
                  <th className="px-2 py-2 text-right">Aprobadas</th>
                  <th className="px-2 py-2 text-right">Segunda</th>
                  <th className="px-2 py-2 text-right">Descarte</th>
                  <th className="px-2 py-2 text-left">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.filter((l) => pendingFor(l.variantItemId) > 0).map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">{sku(l.variantItemId)}</td>
                    <td className="num px-2 py-1.5 text-right text-muted">{pendingFor(l.variantItemId)}</td>
                    {(['approved', 'second', 'scrap'] as const).map((k) => (
                      <td key={k} className="px-2 py-1.5 text-right">
                        <Input
                          className="num ml-auto w-20 text-right"
                          inputMode="numeric"
                          aria-label={`${k} ${sku(l.variantItemId)}`}
                          disabled={k === 'second' && !o.secondsWarehouseId}
                          value={rows[l.variantItemId]?.[k] ?? ''}
                          onChange={(e) => set(l.variantItemId, k, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <Select aria-label="Motivo" value={rows[l.variantItemId]?.reason ?? ''} onChange={(e) => set(l.variantItemId, 'reason', e.target.value)}>
                        <option value="">—</option>
                        {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Solo las aprobadas ingresan a producto terminado. {dispatchId ? 'Al confirmar se consume del depósito del taller el material que indica la ficha para estas prendas.' : ''}
          </p>
          <div className="mt-3 flex gap-2">
            <Button data-tour="op-ingresos-confirmar" disabled={!lines.length} loading={output.isPending} onClick={() => output.mutate({ dispatchId: dispatchId || null, lines })}>Confirmar ingreso</Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
          </div>
        </Card>
      )}
      {!o.outputs.length && !creating && <p className="text-sm text-muted">Todavía no ingresaron prendas terminadas.</p>}
    </div>
  );
}

function CostsTab({ o }: { o: Detail }) {
  return (
    <Card className="overflow-x-auto" tour="op-costos-tabla">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
            <th className="px-3 py-2 text-left">Cálculo</th>
            <th className="px-3 py-2 text-right">Materiales</th>
            <th className="px-3 py-2 text-right">Talleres</th>
            <th className="px-3 py-2 text-right">Indirectos</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Unidades</th>
            <th className="px-3 py-2 text-right">Costo unitario</th>
          </tr>
        </thead>
        <tbody>
          {o.costs.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">{COST_KIND[c.kind] ?? c.kind}<span className="block text-xs text-muted">{fmtDateTime(c.computedAt)}</span></td>
              <td className="num px-3 py-2 text-right">{fmtMoney(c.materials)}</td>
              <td className="num px-3 py-2 text-right">{fmtMoney(c.workshop)}</td>
              <td className="num px-3 py-2 text-right">{fmtMoney(c.overhead)}</td>
              <td className="num px-3 py-2 text-right font-medium">{fmtMoney(c.total)}</td>
              <td className="num px-3 py-2 text-right">{fmtQty(c.goodUnits)}</td>
              <td className="num px-3 py-2 text-right font-medium">{fmtMoney(c.unitCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-3 text-xs text-muted">
        El estimado usa la ficha y el costo promedio de los materiales al liberar (sin taller). El real suma lo efectivamente consumido, la tarifa del taller por
        prenda aprobada o de segunda y los indirectos configurados, repartido sobre las unidades buenas. No es un resultado contable.
      </p>
    </Card>
  );
}
