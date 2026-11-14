'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { netUnitPrice, salesTotals } from '@erp/domain-sales';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, fmtQty } from '@/lib/format';
import { useMasterData } from '@/lib/session';
import { VariantGrid, type GridCell } from '@/components/variant-grid';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

interface Matrix {
  product: { id: string; name: string; code: string };
  sizes: { id: string; code: string }[];
  colors: { id: string; name: string; hex: string | null }[];
  cells: (GridCell & { sku: string; available: string })[];
}
interface CustomerCtx {
  id: string;
  legalName: string;
  discountPct: string;
  priceList: { id: string; name: string; includesVat: boolean } | null;
  seller: { id: string; name: string } | null;
  paymentTerm: { id: string; name: string } | null;
  deliveryAddress: string | null;
  defaultWarehouseId: string | null;
  credit: { limit: string | null; balance: string; openOrders: string; available: string | null };
}
interface Preview {
  netTotal: string;
  total: string;
  lines: { itemId: string; qty: string; unitPrice: string; discountPct: string; vatRate: string; promotionName: string | null }[];
}
interface Line {
  itemId: string;
  sku: string;
  product: string;
  qty: string;
  price: string | null;
  includesVat: boolean;
  available: string;
}

const VAT = '21';

export default function NewSalesOrderPage() {
  const router = useRouter();
  const { data: md } = useMasterData();
  const [customerId, setCustomerId] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [discount, setDiscount] = useState('');
  const [form, setForm] = useState({ promisedAt: '', deliveryAddress: '', notes: '' });
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [curve, setCurve] = useState('');
  const key = useRef(crypto.randomUUID());

  const customers = useQuery({ queryKey: ['parties', 'customers-select'], queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=CUSTOMER&pageSize=200') });
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => api.get<{ id: string; name: string; isActive: boolean }[]>('/sales/price-lists') });
  const products = useQuery({ queryKey: ['products', 'active-all'], queryFn: () => api.get<{ rows: { id: string; code: string; name: string }[] }>('/catalog/products?pageSize=200&status=ACTIVE') });
  const ctx = useQuery({
    queryKey: ['customer-context', customerId],
    queryFn: () => api.get<CustomerCtx>(`/sales/customers/${customerId}/context`),
    enabled: !!customerId,
  });
  const own = md?.warehouses.filter((w) => w.isActive && w.type === 'OWN') ?? [];
  const wh = warehouseId || ctx.data?.defaultWarehouseId || own[0]?.id || '';
  const pl = priceListId || ctx.data?.priceList?.id || '';
  const matrix = useQuery({
    queryKey: ['matrix', productId, wh],
    queryFn: () => api.get<Matrix>(`/catalog/products/${productId}/matrix?warehouseId=${wh}`),
    enabled: !!productId && !!wh,
  });
  const prices = useQuery({
    queryKey: ['product-prices', pl, productId],
    queryFn: () => api.get<Record<string, { price: string; includesVat: boolean }>>(`/sales/price-lists/${pl}/products/${productId}`),
    enabled: !!productId && !!pl,
  });

  const setQty = (cell: Matrix['cells'][number], qty: string) => {
    if (!matrix.data) return;
    const p = prices.data?.[cell.itemId];
    setLines((ls) => {
      const next = { ...ls };
      if (!qty || Number(qty) === 0) delete next[cell.itemId];
      else next[cell.itemId] = { itemId: cell.itemId, sku: cell.sku, product: matrix.data!.product.name, qty, price: p?.price ?? null, includesVat: p?.includesVat ?? false, available: cell.available };
      return next;
    });
  };
  const gridValues = useMemo(() => Object.fromEntries(Object.values(lines).map((l) => [l.itemId, l.qty])), [lines]);
  const list = Object.values(lines);
  const missingPrice = list.filter((l) => !l.price);
  const overStock = list.filter((l) => Number(l.qty) > Number(l.available));
  // Vista previa del servidor: descuento de cada línea (cliente, promoción o manual) y totales reales.
  const payload = useMemo(
    () => (customerId && wh && list.length && !missingPrice.length ? { customerId, warehouseId: wh, priceListId: pl || null, lines: list.map((l) => ({ itemId: l.itemId, qty: l.qty, discountPct: discount || null })) } : null),
    [customerId, wh, pl, discount, list, missingPrice.length],
  );
  const [debounced, setDebounced] = useState(payload);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(payload), 300);
    return () => clearTimeout(t);
  }, [payload]);
  const preview = useQuery({
    queryKey: ['order-preview', debounced],
    queryFn: () => api.post<Preview>('/sales/orders/preview', debounced),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const previewLine = (itemId: string) => preview.data?.lines.find((l) => l.itemId === itemId);
  const totals = useMemo(() => {
    try {
      if (preview.data && debounced) return salesTotals(preview.data.lines);
      const fallback = discount || ctx.data?.discountPct || '0';
      return salesTotals(list.filter((l) => l.price).map((l) => ({ qty: l.qty, unitPrice: netUnitPrice(l.price!, l.includesVat, VAT), discountPct: fallback, vatRate: VAT })));
    } catch {
      return null;
    }
  }, [preview.data, debounced, list, discount, ctx.data?.discountPct]);
  const promos = [...new Set((preview.data?.lines ?? []).map((l) => l.promotionName).filter((x): x is string => !!x))];

  const save = useMutation({
    mutationFn: async (confirm: boolean) => {
      const o = await api.post<{ id: string }>(
        '/sales/orders',
        {
          customerId,
          warehouseId: wh,
          priceListId: pl || null,
          promisedAt: form.promisedAt || null,
          deliveryAddress: form.deliveryAddress || ctx.data?.deliveryAddress || null,
          notes: form.notes || null,
          lines: list.map((l) => ({ itemId: l.itemId, qty: l.qty, discountPct: discount || null })),
        },
        { idempotencyKey: key.current },
      );
      if (!confirm) return { id: o.id, confirmed: false, error: null as string | null };
      try {
        await api.post(`/sales/orders/${o.id}/confirm`, {});
        return { id: o.id, confirmed: true, error: null };
      } catch (e) {
        return { id: o.id, confirmed: false, error: e instanceof Error ? e.message : 'No se pudo confirmar.' };
      }
    },
    onSuccess: (r) => {
      if (r.error) toast.warning(`Pedido guardado en borrador. ${r.error}`);
      else toast.success(r.confirmed ? 'Pedido confirmado: el stock disponible quedó reservado.' : 'Pedido guardado en borrador.');
      router.push(`/ventas/pedidos/${r.id}`);
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => f.message).join(' · ') : e.message);
    },
  });

  if (!md) return <Spinner />;
  const applyCurve = () => {
    if (!matrix.data || !curve) return;
    for (const c of matrix.data.cells.filter((x) => x.isActive)) setQty(c, curve);
  };
  const canSave = !!customerId && !!wh && list.length > 0 && missingPrice.length === 0;

  return (
    <div className="max-w-6xl">
      <PageHeader title="Nuevo pedido" description="Elegí el cliente, buscá cada modelo y cargá las cantidades en la grilla (también podés pegar desde Excel)." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3" tour="pedido-nuevo-datos">
            <Field label="Cliente" htmlFor="customer" className="sm:col-span-2" tour="pedido-nuevo-cliente">
              <Select id="customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPriceListId(''); setDiscount(''); setLines({}); }}>
                <option value="">Elegí un cliente…</option>
                {customers.data?.rows.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
              </Select>
            </Field>
            <Field label="Despachar desde" htmlFor="wh" tour="pedido-nuevo-deposito">
              <Select id="wh" value={wh} onChange={(e) => { setWarehouseId(e.target.value); setLines({}); }}>
                {own.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            <Field label="Lista de precios" htmlFor="pl" tour="pedido-nuevo-lista">
              <Select id="pl" value={pl} onChange={(e) => { setPriceListId(e.target.value); setLines({}); }}>
                <option value="">Elegí…</option>
                {lists.data?.filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field tour="pedido-nuevo-descuento" label="Descuento manual %" htmlFor="disc" hint={`Vacío: automático (cliente ${ctx.data ? `${ctx.data.discountPct} %` : '—'} o promoción vigente, el mejor)`}>
              <Input id="disc" inputMode="decimal" placeholder="Automático" value={discount} onChange={(e) => setDiscount(e.target.value.replace(',', '.'))} />
            </Field>
            <Field label="Entrega comprometida" htmlFor="promised" tour="pedido-nuevo-entrega">
              <Input id="promised" type="date" value={form.promisedAt} onChange={(e) => setForm({ ...form, promisedAt: e.target.value })} />
            </Field>
            <Field label="Domicilio de entrega" htmlFor="addr" className="sm:col-span-3">
              <Input id="addr" placeholder={ctx.data?.deliveryAddress ?? ''} value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} />
            </Field>
          </Card>

          {customerId && pl && (
            <Card className="p-4" tour="pedido-nuevo-articulos">
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <Field label="Modelo" htmlFor="product" className="min-w-64 flex-1" tour="pedido-nuevo-modelo">
                  <Select id="product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">Buscá un modelo…</option>
                    {products.data?.rows.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                  </Select>
                </Field>
                {matrix.data && (
                  <div className="flex items-end gap-2" data-tour="pedido-nuevo-curva">
                    <Field label="Curva: unidades por celda" htmlFor="curve">
                      <Input id="curve" className="w-24" inputMode="numeric" value={curve} onChange={(e) => setCurve(e.target.value.replace(/\D/g, ''))} />
                    </Field>
                    <Button variant="secondary" disabled={!curve} onClick={applyCurve}>Aplicar a todo el modelo</Button>
                  </div>
                )}
              </div>
              {productId && (matrix.data && prices.data ? (
                <>
                  <p className="mb-2 text-sm text-muted">
                    En gris, el disponible en el depósito. Precio de lista: {(() => {
                      const ps = [...new Set(Object.values(prices.data).map((p) => p.price))];
                      return ps.length ? ps.map((p) => fmtMoney(p)).join(' / ') : 'sin precio en esta lista';
                    })()}
                    {Object.values(prices.data)[0]?.includesVat ? ' (IVA incluido)' : ' + IVA'}
                  </p>
                  <VariantGrid
                    sizes={matrix.data.sizes}
                    colors={matrix.data.colors}
                    cells={matrix.data.cells}
                    values={gridValues}
                    hint={(c) => (c as Matrix['cells'][number]).available}
                    onChange={(id, v) => setQty(matrix.data!.cells.find((c) => c.itemId === id)!, v)}
                  />
                </>
              ) : (
                <Spinner />
              ))}
            </Card>
          )}

          {list.length > 0 && (
            <Card className="overflow-x-auto" tour="pedido-nuevo-lineas">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                    <th className="px-3 py-2 text-left">Artículo</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2 text-right">Disponible</th>
                    <th className="px-3 py-2 text-right">Precio neto</th>
                    <th className="px-3 py-2 text-right">Descuento</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((l) => (
                    <tr key={l.itemId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2"><span className="font-medium">{l.sku}</span> <span className="text-muted">{l.product}</span></td>
                      <td className="num px-3 py-2 text-right">{fmtQty(l.qty)}</td>
                      <td className={`num px-3 py-2 text-right ${Number(l.qty) > Number(l.available) ? 'text-warning' : 'text-muted'}`}>{fmtQty(l.available)}</td>
                      <td className="num px-3 py-2 text-right">{l.price ? fmtMoney(netUnitPrice(l.price, l.includesVat, VAT).toString()) : <Badge tone="danger">Sin precio</Badge>}</td>
                      <td className="px-3 py-2 text-right">
                        {previewLine(l.itemId) ? (
                          <span className="num">
                            {fmtQty(previewLine(l.itemId)!.discountPct)} %
                            {previewLine(l.itemId)!.promotionName && <span className="block text-xs text-success">{previewLine(l.itemId)!.promotionName}</span>}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button aria-label={`Quitar ${l.sku}`} className="text-muted hover:text-danger" onClick={() => setLines((ls) => { const n = { ...ls }; delete n[l.itemId]; return n; })}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Field label="Observaciones" htmlFor="notes" tour="pedido-nuevo-observaciones"><Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          {ctx.data && (
            <Card className="p-4 text-sm" tour="pedido-nuevo-cliente-panel">
              <p className="font-medium">{ctx.data.legalName}</p>
              <dl className="mt-2 grid grid-cols-2 gap-y-1">
                <dt className="text-muted">Vendedor</dt><dd>{ctx.data.seller?.name ?? '—'}</dd>
                <dt className="text-muted">Condición</dt><dd>{ctx.data.paymentTerm?.name ?? 'Contado'}</dd>
                <dt className="text-muted">Saldo</dt><dd className="num">{fmtMoney(ctx.data.credit.balance)}</dd>
                <dt className="text-muted">Pedidos abiertos</dt><dd className="num">{fmtMoney(ctx.data.credit.openOrders)}</dd>
                <dt className="text-muted">Límite</dt><dd className="num">{ctx.data.credit.limit ? fmtMoney(ctx.data.credit.limit) : 'Sin límite'}</dd>
                {ctx.data.credit.available !== null && (
                  <>
                    <dt className="text-muted">Crédito disponible</dt>
                    <dd className={`num font-medium ${totals && Number(ctx.data.credit.available) < Number(totals.total.toString()) ? 'text-danger' : ''}`}>{fmtMoney(ctx.data.credit.available)}</dd>
                  </>
                )}
              </dl>
            </Card>
          )}
          <Card className="p-4 text-sm" tour="pedido-nuevo-totales">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-muted">Prendas</dt><dd className="num text-right">{list.reduce((a, l) => a + Number(l.qty), 0).toLocaleString('es-AR')}</dd>
              <dt className="text-muted">Neto</dt><dd className="num text-right">{fmtMoney(totals?.netTotal.toString() ?? '0')}</dd>
              <dt className="text-muted">IVA</dt><dd className="num text-right">{fmtMoney(totals?.vatTotal.toString() ?? '0')}</dd>
              <dt className="font-medium">Total</dt><dd className="num text-right text-base font-semibold">{fmtMoney(totals?.total.toString() ?? '0')}</dd>
            </dl>
            {overStock.length > 0 && (
              <p className="mt-3 flex gap-2 text-warning"><AlertTriangle className="size-4 shrink-0" /> {overStock.length} artículo(s) superan el disponible: lo que falte queda pendiente de entrega.</p>
            )}
            {promos.length > 0 && <p className="mt-3 text-success">Promociones aplicadas: {promos.join(', ')}.</p>}
            {preview.error && <p className="mt-3 text-danger" role="alert">{(preview.error as Error).message}</p>}
            {missingPrice.length > 0 && <p className="mt-3 text-danger">Hay artículos sin precio en la lista: quitalos o pedí que carguen el precio.</p>}
            <div className="mt-4 flex flex-col gap-2">
              <Button data-tour="pedido-nuevo-confirmar" loading={save.isPending} disabled={!canSave} onClick={() => save.mutate(true)}>Guardar y confirmar</Button>
              <Button data-tour="pedido-nuevo-borrador" variant="secondary" disabled={!canSave || save.isPending} onClick={() => save.mutate(false)}>Guardar borrador</Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
