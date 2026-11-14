'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtMoney, WAREHOUSE_TYPE_LABELS } from '@/lib/format';
import { useCan, useMasterData } from '@/lib/session';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui';

const TABS = [
  { id: 'empresa', label: 'Empresa y aprobaciones', tour: 'config-tab-empresa' },
  { id: 'depositos', label: 'Depósitos', tour: 'config-tab-depositos' },
  { id: 'talles', label: 'Talles', tour: 'config-tab-talles' },
  { id: 'colores', label: 'Colores', tour: 'config-tab-colores' },
  { id: 'categorias', label: 'Categorías', tour: 'config-tab-categorias' },
  { id: 'centros', label: 'Centros de costo', tour: 'config-tab-centros' },
  { id: 'temporadas', label: 'Temporadas y colecciones', tour: 'config-tab-temporadas' },
  { id: 'unidades', label: 'Unidades', tour: 'config-tab-unidades' },
  { id: 'comercial', label: 'Condiciones de pago y zonas', tour: 'config-tab-comercial' },
];

/** Formulario inline: una fila de campos + botón Agregar. Evita modales y pantallas extra. */
function InlineForm({ children, onSubmit, loading, tour }: { children: ReactNode; onSubmit: (f: FormData) => void; loading?: boolean; tour?: string }) {
  return (
    <form
      data-tour={tour}
      className="flex flex-wrap items-end gap-3 border-b border-border p-4"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
        e.currentTarget.reset();
      }}
    >
      {children}
      <Button type="submit" loading={loading}>
        Agregar
      </Button>
    </form>
  );
}

function List({ items }: { items: { key: string; main: ReactNode; side?: ReactNode }[] }) {
  if (!items.length) return <p className="p-4 text-sm text-muted">Todavía no hay registros.</p>;
  return (
    <ul>
      {items.map((i) => (
        <li key={i.key} className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm last:border-0">
          <span>{i.main}</span>
          <span className="text-muted">{i.side}</span>
        </li>
      ))}
    </ul>
  );
}

function useSave(path: string, method: 'post' | 'put' = 'post') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => (method === 'post' ? api.post(path, body) : api.put(path, body)),
    onSuccess: () => {
      toast.success('Guardado.');
      qc.invalidateQueries({ queryKey: ['master-data'] });
      qc.invalidateQueries({ queryKey: ['company'] });
    },
    onError: (e) => toast.error(e.message),
  });
}

export default function SettingsPage() {
  const [tab, setTab] = useState('empresa');
  const can = useCan();
  const { data: md } = useMasterData();
  const company = useQuery({
    queryKey: ['company'],
    queryFn: () =>
      api.get<{
        company: { legalName: string; tradeName: string | null; cuit: string; address: string | null };
        approvalRules: { actionCode: string; threshold: string; isActive: boolean }[];
        purchasingPointsOfSale: number[];
      }>('/settings/company'),
    enabled: can('settings.company.view'),
  });

  const mWarehouse = useSave('/settings/warehouses');
  const mScale = useSave('/settings/size-scales');
  const mColor = useSave('/settings/colors');
  const mCategory = useSave('/settings/categories');
  const mCostCenter = useSave('/settings/cost-centers');
  const mSeason = useSave('/settings/seasons');
  const mCollection = useSave('/settings/collections');
  const mUom = useSave('/settings/uoms');
  const mConv = useSave('/settings/uom-conversions');
  const mTerm = useSave('/settings/payment-terms');
  const mZone = useSave('/settings/zones');
  const mCompany = useSave('/settings/company', 'put');
  const mRule = useSave('/settings/approval-rules', 'put');
  const mPos = useSave('/settings/purchasing-points-of-sale', 'put');

  if (!md) return <Spinner />;
  const uomCode = (id: string) => md.uoms.find((u) => u.id === id)?.code;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Configuración" description="Parámetros del negocio. Todo se ajusta sin cambios de código y queda auditado." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'empresa' && company.data && (
        <div className="flex flex-col gap-4">
          <Card className="p-4" tour="config-empresa-datos">
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                mCompany.mutate({ legalName: f.get('legalName'), tradeName: f.get('tradeName') || null, address: f.get('address') || null });
              }}
            >
              <Field label="Razón social" htmlFor="legalName">
                <Input id="legalName" name="legalName" defaultValue={company.data.company.legalName} disabled={!can('settings.company.edit')} />
              </Field>
              <Field label="Nombre de fantasía" htmlFor="tradeName">
                <Input id="tradeName" name="tradeName" defaultValue={company.data.company.tradeName ?? ''} disabled={!can('settings.company.edit')} />
              </Field>
              <Field label="CUIT" htmlFor="cuit" tour="config-empresa-cuit" hint="Para modificarlo, contactá al administrador del sistema.">
                <Input id="cuit" value={company.data.company.cuit} disabled readOnly />
              </Field>
              <Field label="Domicilio" htmlFor="address">
                <Input id="address" name="address" defaultValue={company.data.company.address ?? ''} disabled={!can('settings.company.edit')} />
              </Field>
              {can('settings.company.edit') && (
                <div>
                  <Button type="submit" loading={mCompany.isPending} data-tour="config-empresa-guardar">Guardar</Button>
                </div>
              )}
            </form>
          </Card>
          <PointsOfSaleCard values={company.data.purchasingPointsOfSale} canEdit={can('settings.company.edit')} mutation={mPos} />
          <RuleCard
            tour="config-regla-ajustes"
            title="Aprobación de ajustes de stock"
            description="Los ajustes valorizados por encima de este monto quedan pendientes hasta que los apruebe otra persona con permiso."
            actionCode="inventory.adjust"
            rule={company.data.approvalRules.find((r) => r.actionCode === 'inventory.adjust')}
            canEdit={can('settings.company.edit')}
            mutation={mRule}
          />
          <RuleCard
            tour="config-regla-pagos"
            title="Aprobación de órdenes de pago"
            description="Las órdenes de pago por encima de este monto quedan pendientes: no se mueve dinero ni se entregan cheques hasta que las apruebe Dirección (otra persona que quien la cargó)."
            actionCode="payables.payment"
            rule={company.data.approvalRules.find((r) => r.actionCode === 'payables.payment')}
            canEdit={can('settings.company.edit')}
            mutation={mRule}
          />
        </div>
      )}

      {tab === 'depositos' && (
        <Card tour="config-depositos">
          <InlineForm tour="config-depositos-form" loading={mWarehouse.isPending} onSubmit={(f) => mWarehouse.mutate({ code: f.get('code'), name: f.get('name'), type: f.get('type') })}>
            <Field label="Código" htmlFor="wcode"><Input id="wcode" name="code" className="w-28" required /></Field>
            <Field label="Nombre" htmlFor="wname"><Input id="wname" name="name" required /></Field>
            <Field label="Tipo" htmlFor="wtype" tour="config-deposito-tipo">
              <Select id="wtype" name="type">
                <option value="OWN">Propio</option>
                <option value="QUARANTINE">Cuarentena</option>
                <option value="TRANSIT">En tránsito</option>
              </Select>
            </Field>
          </InlineForm>
          <List
            items={md.warehouses.map((w) => ({
              key: w.id,
              main: (
                <>
                  <strong>{w.code}</strong> · {w.name} {!w.isActive && <Badge>Inactivo</Badge>}
                </>
              ),
              side: WAREHOUSE_TYPE_LABELS[w.type],
            }))}
          />
          <p className="p-4 text-xs text-muted">Los depósitos de taller se crean solos al dar de alta un taller.</p>
        </Card>
      )}

      {tab === 'talles' && (
        <Card>
          <InlineForm
            tour="config-talles-form"
            loading={mScale.isPending}
            onSubmit={(f) =>
              mScale.mutate({ name: f.get('name'), sizes: String(f.get('sizes')).split(',').map((s) => s.trim()).filter(Boolean) })
            }
          >
            <Field label="Nombre de la escala" htmlFor="sname"><Input id="sname" name="name" required /></Field>
            <Field label="Talles (en orden, separados por coma)" htmlFor="ssizes" tour="config-talles-lista" className="min-w-72 flex-1">
              <Input id="ssizes" name="sizes" placeholder="RN, 0-3, 3-6, 6-9, 9-12" required />
            </Field>
          </InlineForm>
          <List items={md.sizeScales.map((s) => ({ key: s.id, main: <strong>{s.name}</strong>, side: s.sizes.map((x) => x.code).join(' · ') }))} />
        </Card>
      )}

      {tab === 'colores' && (
        <Card>
          <InlineForm tour="config-colores-form" loading={mColor.isPending} onSubmit={(f) => mColor.mutate({ code: f.get('code'), name: f.get('name'), hex: f.get('hex') })}>
            <Field label="Código" htmlFor="ccode" hint="Se usa en el SKU" tour="config-color-codigo"><Input id="ccode" name="code" className="w-24" required /></Field>
            <Field label="Nombre" htmlFor="cname"><Input id="cname" name="name" required /></Field>
            <Field label="Muestra" htmlFor="chex" tour="config-color-muestra"><Input id="chex" name="hex" type="color" className="w-16 p-1" defaultValue="#ffffff" /></Field>
          </InlineForm>
          <List
            items={md.colors.map((c) => ({
              key: c.id,
              main: (
                <span className="flex items-center gap-2">
                  <span className="size-4 rounded-full border border-border" style={{ background: c.hex ?? undefined }} aria-hidden />
                  {c.name}
                </span>
              ),
              side: c.code,
            }))}
          />
        </Card>
      )}

      {tab === 'categorias' && (
        <Card>
          <InlineForm tour="config-categorias-form" loading={mCategory.isPending} onSubmit={(f) => mCategory.mutate({ name: f.get('name'), kind: f.get('kind') })}>
            <Field label="Nombre" htmlFor="catname"><Input id="catname" name="name" required /></Field>
            <Field label="Para" htmlFor="catkind" tour="config-categoria-para">
              <Select id="catkind" name="kind">
                <option value="PRODUCT">Productos</option>
                <option value="MATERIAL">Materiales</option>
                <option value="EXPENSE">Gastos</option>
              </Select>
            </Field>
          </InlineForm>
          <List
            items={md.categories.map((c) => ({
              key: c.id,
              main: c.name,
              side: { PRODUCT: 'Productos', MATERIAL: 'Materiales', EXPENSE: 'Gastos' }[c.kind],
            }))}
          />
        </Card>
      )}

      {tab === 'centros' && (
        <Card>
          <InlineForm tour="config-centros-form" loading={mCostCenter.isPending} onSubmit={(f) => mCostCenter.mutate({ code: f.get('code'), name: f.get('name') })}>
            <Field label="Código" htmlFor="cccode" hint="Corto, p. ej. PRO"><Input id="cccode" name="code" className="w-24" maxLength={20} required /></Field>
            <Field label="Nombre" htmlFor="ccname"><Input id="ccname" name="name" maxLength={80} required /></Field>
          </InlineForm>
          <List items={md.costCenters.map((c) => ({ key: c.id, main: c.name, side: c.code }))} />
        </Card>
      )}

      {tab === 'temporadas' && (
        <div className="flex flex-col gap-4">
          <Card>
            <InlineForm tour="config-temporadas-form" loading={mSeason.isPending} onSubmit={(f) => mSeason.mutate({ name: f.get('name'), year: Number(f.get('year')) })}>
              <Field label="Temporada" htmlFor="sea"><Input id="sea" name="name" placeholder="Primavera-Verano 2027" required /></Field>
              <Field label="Año" htmlFor="year"><Input id="year" name="year" type="number" className="w-24" defaultValue={new Date().getFullYear() + 1} /></Field>
            </InlineForm>
            <List items={md.seasons.map((s) => ({ key: s.id, main: s.name, side: s.year }))} />
          </Card>
          <Card>
            <InlineForm tour="config-colecciones-form" loading={mCollection.isPending} onSubmit={(f) => mCollection.mutate({ name: f.get('name'), seasonId: f.get('seasonId') })}>
              <Field label="Colección" htmlFor="coll"><Input id="coll" name="name" required /></Field>
              <Field label="Temporada" htmlFor="collsea">
                <Select id="collsea" name="seasonId" required>
                  {md.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            </InlineForm>
            <List items={md.collections.map((c) => ({ key: c.id, main: c.name, side: md.seasons.find((s) => s.id === c.seasonId)?.name }))} />
          </Card>
        </div>
      )}

      {tab === 'unidades' && (
        <div className="flex flex-col gap-4">
          <Card>
            <InlineForm tour="config-unidades-form" loading={mUom.isPending} onSubmit={(f) => mUom.mutate({ code: f.get('code'), name: f.get('name'), dimension: f.get('dimension') })}>
              <Field label="Código" htmlFor="ucode"><Input id="ucode" name="code" className="w-24" required /></Field>
              <Field label="Nombre" htmlFor="uname"><Input id="uname" name="name" required /></Field>
              <Field label="Mide" htmlFor="udim">
                <Select id="udim" name="dimension">
                  <option value="UNIT">Unidades</option>
                  <option value="LENGTH">Longitud</option>
                  <option value="MASS">Peso</option>
                  <option value="AREA">Superficie</option>
                </Select>
              </Field>
            </InlineForm>
            <List items={md.uoms.map((u) => ({ key: u.id, main: `${u.name} (${u.code})`, side: { UNIT: 'Unidades', LENGTH: 'Longitud', MASS: 'Peso', AREA: 'Superficie' }[u.dimension] }))} />
          </Card>
          <Card>
            <InlineForm
              tour="config-conversiones-form"
              loading={mConv.isPending}
              onSubmit={(f) => mConv.mutate({ fromUomId: f.get('from'), toUomId: f.get('to'), factor: String(f.get('factor')).replace(',', '.') })}
            >
              <Field label="1" htmlFor="cfrom">
                <Select id="cfrom" name="from">{md.uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</Select>
              </Field>
              <Field label="equivale a" htmlFor="cfactor"><Input id="cfactor" name="factor" inputMode="decimal" className="w-28" required /></Field>
              <Field label="de" htmlFor="cto">
                <Select id="cto" name="to">{md.uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</Select>
              </Field>
            </InlineForm>
            <List
              items={md.conversions.map((c) => ({
                key: c.id,
                main: `1 ${uomCode(c.fromUomId)} = ${c.factor} ${uomCode(c.toUomId)}`,
                side: c.itemId ? 'Específica de un artículo' : 'Universal',
              }))}
            />
            <p className="p-4 text-xs text-muted">Solo se convierten unidades que miden lo mismo (m ↔ cm). Rollo → metros se define por tela, porque cada rollo rinde distinto.</p>
          </Card>
        </div>
      )}

      {tab === 'comercial' && (
        <div className="flex flex-col gap-4">
          <Card>
            <InlineForm
              tour="config-condiciones-form"
              loading={mTerm.isPending}
              onSubmit={(f) => mTerm.mutate({ name: f.get('name'), days: String(f.get('days')).split(/[,/ ]+/).filter(Boolean).map(Number) })}
            >
              <Field label="Condición" htmlFor="tname"><Input id="tname" name="name" placeholder="30/60" required /></Field>
              <Field label="Días de cada cuota" htmlFor="tdays" tour="config-condicion-dias"><Input id="tdays" name="days" placeholder="30, 60" required /></Field>
            </InlineForm>
            <List items={md.paymentTerms.map((t) => ({ key: t.id, main: t.name, side: `${t.days.join(' / ')} días` }))} />
          </Card>
          <Card>
            <InlineForm tour="config-zonas-form" loading={mZone.isPending} onSubmit={(f) => mZone.mutate({ name: f.get('name') })}>
              <Field label="Zona" htmlFor="zname"><Input id="zname" name="name" required /></Field>
            </InlineForm>
            <List items={md.zones.map((z) => ({ key: z.id, main: z.name }))} />
          </Card>
        </div>
      )}
    </div>
  );
}

/** Puntos de venta con los que facturan los proveedores: se ofrecen al cargar sus comprobantes. */
function PointsOfSaleCard({
  values,
  canEdit,
  mutation,
}: {
  values: number[];
  canEdit: boolean;
  mutation: { mutate: (body: Record<string, unknown>) => void; isPending: boolean };
}) {
  const save = (pointsOfSale: number[]) => mutation.mutate({ pointsOfSale });
  return (
    <Card className="p-4" tour="config-puntos-venta">
      <h2 className="font-medium">Puntos de venta de proveedores</h2>
      <p className="mt-1 mb-3 text-sm text-muted">
        Se ofrecen al cargar facturas de proveedores. El primero es el predeterminado; el número se sugiere como el siguiente al último cargado de ese proveedor.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {values.map((p, i) => (
          <span key={p} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm">
            <span className="num">{String(p).padStart(5, '0')}</span>
            {i === 0 ? (
              <Badge tone="accent">Predeterminado</Badge>
            ) : (
              canEdit && (
                <>
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => save([p, ...values.filter((x) => x !== p)])}>Hacer predeterminado</button>
                  <button type="button" className="text-xs text-muted hover:underline" aria-label={`Quitar ${p}`} onClick={() => save(values.filter((x) => x !== p))}>Quitar</button>
                </>
              )
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const n = Number(new FormData(form).get('pos'));
            if (Number.isInteger(n) && n >= 0 && !values.includes(n)) save([...values, n]);
            form.reset();
          }}
        >
          <Field label="Punto de venta" htmlFor="newpos">
            <Input id="newpos" name="pos" inputMode="numeric" className="w-28" required pattern="\d{1,5}" />
          </Field>
          <Button type="submit" loading={mutation.isPending}>Agregar</Button>
        </form>
      )}
    </Card>
  );
}

function RuleCard({
  tour,
  title,
  description,
  actionCode,
  rule,
  canEdit,
  mutation,
}: {
  tour?: string;
  title: string;
  description: string;
  actionCode: string;
  rule?: { threshold: string; isActive: boolean };
  canEdit: boolean;
  mutation: { mutate: (body: Record<string, unknown>) => void; isPending: boolean };
}) {
  const id = `threshold-${actionCode}`;
  return (
    <Card className="p-4" tour={tour}>
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 mb-3 text-sm text-muted">
        {description} Actual: {rule?.isActive ? fmtMoney(rule.threshold) : 'sin regla (no se piden aprobaciones)'}.
      </p>
      {canEdit && (
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            mutation.mutate({ actionCode, threshold: String(f.get('threshold')).replace(',', '.'), isActive: true });
          }}
        >
          <Field label="Umbral ($)" htmlFor={id}>
            <Input id={id} name="threshold" inputMode="decimal" defaultValue={rule?.threshold ?? ''} />
          </Field>
          <Button type="submit" loading={mutation.isPending}>Guardar regla</Button>
        </form>
      )}
    </Card>
  );
}
