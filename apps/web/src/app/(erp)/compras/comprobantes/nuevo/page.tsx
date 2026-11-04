'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { computeInvoiceTotals, dec } from '@erp/domain-core';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtQty, todayISO } from '@/lib/format';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';

interface Receipt {
  id: string;
  number: string;
  receivedAt: string;
  lines: { id: string; itemId: string; qty: string; invoicedQty: string; unitCost: string }[];
  items: { id: string; sku: string; name: string }[];
}
interface Line {
  receiptLineId: string | null;
  itemId: string | null;
  description: string;
  qty: string;
  unitPrice: string;
  vatRate: string;
}

function NewSupplierInvoice() {
  const router = useRouter();
  const params = useSearchParams();
  const [supplierId, setSupplierId] = useState(params.get('proveedor') ?? '');
  const [head, setHead] = useState({ docType: 'FA', pointOfSale: '', number: '', issueDate: todayISO(), dueDate: '', otherTaxes: '0' });
  const [lines, setLines] = useState<Line[]>([]);
  const key = useRef(crypto.randomUUID());
  const suppliers = useQuery({ queryKey: ['parties', 'suppliers-select'], queryFn: () => api.get<{ rows: { id: string; legalName: string }[] }>('/parties?role=SUPPLIER&pageSize=200') });
  const receipts = useQuery({
    queryKey: ['receipts', 'pending-invoice', supplierId],
    queryFn: () => api.get<Receipt[]>(`/purchasing/receipts?supplierId=${supplierId}&pendingInvoice=true`),
    enabled: !!supplierId,
  });
  const totals = useMemo(() => {
    try {
      const valid = lines.filter((l) => Number(l.qty) > 0 && l.unitPrice !== '');
      return computeInvoiceTotals(valid, head.otherTaxes || '0');
    } catch {
      return null;
    }
  }, [lines, head.otherTaxes]);

  const addReceipt = (r: Receipt) =>
    setLines((ls) => [
      ...ls,
      ...r.lines
        .filter((l) => Number(l.invoicedQty) < Number(l.qty) && !ls.some((x) => x.receiptLineId === l.id))
        .map((l) => ({
          receiptLineId: l.id,
          itemId: l.itemId,
          description: r.items.find((i) => i.id === l.itemId)?.name ?? '',
          qty: dec(l.qty).minus(l.invoicedQty).toString(),
          unitPrice: l.unitCost,
          vatRate: '21',
        })),
    ]);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; warnings: string[] }>(
        '/purchasing/invoices',
        { supplierId, ...head, pointOfSale: Number(head.pointOfSale), number: Number(head.number), dueDate: head.dueDate || null, lines },
        { idempotencyKey: key.current },
      ),
    onSuccess: (d) => {
      toast.success('Comprobante registrado en la cuenta corriente del proveedor.');
      d.warnings.forEach((w) => toast.warning(w, { duration: 12_000 }));
      router.push('/compras/comprobantes');
    },
    onError: (e) => {
      key.current = crypto.randomUUID();
      toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => f.message).join(' · ') : e.message);
    },
  });
  const set = (k: keyof typeof head) => (e: { target: { value: string } }) => setHead((h) => ({ ...h, [k]: e.target.value }));

  return (
    <div className="max-w-5xl">
      <PageHeader title="Cargar comprobante de proveedor" description="Elegí las recepciones que factura: se precargan cantidades y precios. Si el precio difiere de lo recibido, queda marcado." />
      <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-6">
        <Field label="Proveedor" htmlFor="sup" className="col-span-2 sm:col-span-3">
          <Select id="sup" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setLines([]); }}>
            <option value="">Elegí…</option>
            {suppliers.data?.rows.map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
          </Select>
        </Field>
        <Field label="Tipo" htmlFor="dt">
          <Select id="dt" value={head.docType} onChange={set('docType')}>
            {['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Punto de venta" htmlFor="pv"><Input id="pv" inputMode="numeric" value={head.pointOfSale} onChange={(e) => setHead((h) => ({ ...h, pointOfSale: e.target.value.replace(/\D/g, '') }))} /></Field>
        <Field label="Número" htmlFor="nro"><Input id="nro" inputMode="numeric" value={head.number} onChange={(e) => setHead((h) => ({ ...h, number: e.target.value.replace(/\D/g, '') }))} /></Field>
        <Field label="Fecha" htmlFor="fd" className="col-span-2"><Input id="fd" type="date" value={head.issueDate} onChange={set('issueDate')} /></Field>
        <Field label="Vencimiento" htmlFor="vd" className="col-span-2" hint="Vacío: según condición de pago"><Input id="vd" type="date" value={head.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Percepciones / otros ($)" htmlFor="ot" className="col-span-2"><Input id="ot" inputMode="decimal" value={head.otherTaxes} onChange={(e) => setHead((h) => ({ ...h, otherTaxes: e.target.value.replace(',', '.') }))} /></Field>
      </Card>
      {supplierId && (
        <Card className="mb-4 p-4">
          <p className="mb-2 text-sm font-medium">Recepciones pendientes de facturar</p>
          {receipts.data?.length ? (
            <div className="flex flex-wrap gap-2">
              {receipts.data.map((r) => (
                <Button key={r.id} size="sm" variant="secondary" onClick={() => addReceipt(r)}>+ {r.number} ({fmtDate(r.receivedAt)})</Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No hay recepciones pendientes. Podés cargar líneas libres (servicios, fletes).</p>
          )}
        </Card>
      )}
      <Card className="mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Descripción</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2 text-right">Precio neto</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-3 py-2"><Input aria-label="Descripción" value={l.description} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                <td className="px-3 py-2 text-right"><Input className="num ml-auto w-24 text-right" aria-label="Cantidad" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(',', '.') } : x)))} /></td>
                <td className="px-3 py-2 text-right"><Input className="num ml-auto w-28 text-right" aria-label="Precio" value={l.unitPrice} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value.replace(',', '.') } : x)))} /></td>
                <td className="px-3 py-2 text-right">
                  <Select aria-label="IVA" className="ml-auto w-24" value={l.vatRate} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, vatRate: e.target.value } : x)))}>
                    {['21', '10.5', '27', '0'].map((r) => <option key={r} value={r}>{r.replace('.', ',')} %</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2"><button aria-label="Quitar" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4 text-muted" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-border p-3">
          <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, { receiptLineId: null, itemId: null, description: '', qty: '1', unitPrice: '', vatRate: '21' }])}>Agregar línea libre</Button>
          {totals && (
            <p className="num text-sm">
              Neto {fmtMoney(totals.netTotal.toFixed(2))} · IVA {fmtMoney(totals.vatTotal.toFixed(2))} · otros {fmtMoney(totals.otherTaxes.toFixed(2))} · <strong>Total {fmtMoney(totals.total.toFixed(2))}</strong>
            </p>
          )}
        </div>
      </Card>
      <Button
        disabled={!supplierId || !head.pointOfSale || !head.number || !lines.length}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        Registrar comprobante
      </Button>
      <p className="mt-2 text-xs text-muted">Las líneas vinculadas a recepciones descuentan lo pendiente de facturar ({fmtQty(String(lines.filter((l) => l.receiptLineId).length))} vinculadas).</p>
    </div>
  );
}

export default function NewSupplierInvoicePage() {
  return (
    <Suspense>
      <NewSupplierInvoice />
    </Suspense>
  );
}
