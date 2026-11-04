'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { dec, roundMoney } from '@erp/domain-core';
import { api } from '@/lib/api';
import { ENTRY_TYPES, FD_STATUS, fmtDate, fmtFiscal, fmtMoney, fmtQty, isZero, TAX_CONDITION_LABELS } from '@/lib/format';
import { Can, useMasterData } from '@/lib/session';
import { DocHeader, PrintButton } from '@/components/doc-print';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Spinner } from '@/components/ui';

interface Doc {
  id: string;
  docType: string;
  label: string;
  pointOfSale: number;
  number: number | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  netTotal: string;
  vatTotal: string;
  total: string;
  cae: string | null;
  caeDueDate: string | null;
  arcaMode: string | null;
  arcaResult: { messages?: string[] } | null;
  notes: string | null;
  seller: string | null;
  commissionPct: string | null;
  openAmount: string | null;
  party: { id: string; legalName: string; taxId: string; taxCondition: string; addresses: { street: string; city: string | null; province: string | null }[] } | null;
  company: { legalName: string; cuit: string; address: string | null; taxCondition: string } | null;
  deliveries: { id: string; number: string }[];
  related: { id: string; docType: string; pointOfSale: number; number: number | null } | null;
  children: { id: string; docType: string; pointOfSale: number; number: number | null; status: string; total: string; label: string }[];
  allocations: { id: string; amount: string; counterpart: string; counterpartType?: string; createdAt: string }[];
  lines: { id: string; sku: string | null; description: string; qty: string; unitPrice: string; discountPct: string; vatRate: string; net: string; vat: string; itemId: string | null; creditedQty: string }[];
}

export default function SalesDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { data: md } = useMasterData();
  const { data: d, isLoading, error } = useQuery({ queryKey: ['sales-document', id], queryFn: () => api.get<Doc>(`/sales/documents/${id}`) });
  const [panel, setPanel] = useState<'NC' | 'ND' | null>(null);
  const [ncQty, setNcQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState('');
  const [concept, setConcept] = useState({ description: '', net: '', vatRate: '21' });
  const [reason, setReason] = useState('');

  const after = (r: { id: string; status: string }, what: string) => {
    if (r.status === 'POSTED') toast.success(`${what} autorizada.`);
    else if (r.status === 'REJECTED') toast.error(`ARCA rechazó la ${what.toLowerCase()}.`);
    else toast.warning(`La ${what.toLowerCase()} quedó esperando el CAE.`);
    setPanel(null);
    qc.invalidateQueries({ queryKey: ['sales-document', id] });
    qc.invalidateQueries({ queryKey: ['sales-documents'] });
  };
  const nc = useMutation({
    mutationFn: () =>
      api.post<{ id: string; status: string }>('/sales/credit-notes', {
        invoiceId: id,
        reason,
        returnWarehouseId: restock || null,
        lines: Object.entries(ncQty).filter(([, q]) => Number(q) > 0).map(([invoiceLineId, qty]) => ({ invoiceLineId, qty })),
        concepts: concept.description && concept.net ? [concept] : [],
      }),
    onSuccess: (r) => after(r, 'Nota de crédito'),
    onError: (e) => toast.error(e.message),
  });
  const nd = useMutation({
    mutationFn: () => api.post<{ id: string; status: string }>('/sales/debit-notes', { invoiceId: id, reason, concepts: [concept] }),
    onSuccess: (r) => after(r, 'Nota de débito'),
    onError: (e) => toast.error(e.message),
  });
  const retry = useMutation({
    mutationFn: () => api.post<Doc>(`/sales/documents/${id}/authorize`),
    onSuccess: (r) => { qc.setQueryData(['sales-document', id], r); after(r, 'Factura'); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (error || !d) return <ErrorBox error={error} />;
  const [stLabel, stTone] = FD_STATUS[d.status] ?? [d.status, 'neutral'];
  const isInvoice = d.docType.startsWith('F');
  const letter = d.docType.slice(-1);
  const discriminates = letter === 'A';
  const addr = d.party?.addresses.map((a) => [a.street, a.city, a.province].filter(Boolean).join(', '))[0];

  return (
    <div className="max-w-4xl">
      <div className="print-hide mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={stTone}>{stLabel}</Badge>
        {d.openAmount !== null && isInvoice && <Badge tone={isZero(d.openAmount) ? 'success' : 'warning'}>{isZero(d.openAmount) ? 'Cancelada' : `Pendiente ${fmtMoney(d.openAmount)}`}</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          {d.status === 'PENDING_AUTH' && <Can perm="sales.invoice"><Button loading={retry.isPending} onClick={() => retry.mutate()}>Reintentar autorización</Button></Can>}
          {isInvoice && d.status === 'POSTED' && (
            <Can perm="sales.invoice">
              <Button variant="secondary" onClick={() => { setPanel('NC'); setReason(''); }}>Nota de crédito</Button>
              <Button variant="secondary" onClick={() => { setPanel('ND'); setReason(''); }}>Nota de débito</Button>
            </Can>
          )}
          {isInvoice && d.status === 'POSTED' && d.openAmount && !isZero(d.openAmount) && (
            <Can perm="receivables.collect"><Button variant="secondary" onClick={() => (window.location.href = `/cobros/nuevo?cliente=${d.party?.id}`)}>Cobrar</Button></Can>
          )}
          <PrintButton />
        </div>
      </div>

      {d.status === 'REJECTED' && (
        <Card className="print-hide mb-4 border-danger/40 p-4 text-sm">
          <p className="font-medium">ARCA rechazó el comprobante. No tiene número ni efectos; los remitos quedaron libres para volver a facturar.</p>
          <ul className="mt-1 list-disc pl-5 text-muted">{d.arcaResult?.messages?.map((m) => <li key={m}>{m}</li>)}</ul>
        </Card>
      )}

      {panel && (
        <Card className="print-hide mb-4 p-4">
          <p className="mb-3 font-medium">{panel === 'NC' ? 'Nota de crédito sobre esta factura' : 'Nota de débito sobre esta factura'}</p>
          {panel === 'NC' && (
            <>
              <p className="mb-2 text-sm text-muted">Indicá las cantidades que se acreditan (devolución o anulación parcial) y/o una bonificación sin mercadería.</p>
              <table className="mb-3 w-full text-sm">
                <tbody>
                  {d.lines.filter((l) => l.itemId).map((l) => {
                    const left = dec(l.qty).minus(l.creditedQty);
                    return (
                      <tr key={l.id} className="border-b border-border">
                        <td className="py-1">{l.description}</td>
                        <td className="num py-1 text-right text-muted">quedan {fmtQty(left.toString())}</td>
                        <td className="w-24 py-1 pl-2">
                          <Input aria-label={`Acreditar ${l.description}`} className="num h-8 text-right" inputMode="decimal" disabled={left.lte(0)} value={ncQty[l.id] ?? ''} onChange={(e) => setNcQty({ ...ncQty, [l.id]: e.target.value.replace(',', '.') })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Field label="Reingresar la mercadería devuelta a" htmlFor="restock" className="mb-3 max-w-sm" hint="Vacío = sin devolución física (solo ajuste de precio o cantidad)">
                <Select id="restock" value={restock} onChange={(e) => setRestock(e.target.value)}>
                  <option value="">No reingresa</option>
                  {md?.warehouses.filter((w) => w.isActive && w.type !== 'WORKSHOP').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </Field>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_100px]">
            <Field label={panel === 'NC' ? 'Bonificación (concepto)' : 'Concepto'} htmlFor="cdesc"><Input id="cdesc" value={concept.description} onChange={(e) => setConcept({ ...concept, description: e.target.value })} /></Field>
            <Field label="Neto" htmlFor="cnet"><Input id="cnet" className="num text-right" inputMode="decimal" value={concept.net} onChange={(e) => setConcept({ ...concept, net: e.target.value.replace(',', '.') })} /></Field>
            <Field label="IVA %" htmlFor="cvat">
              <Select id="cvat" value={concept.vatRate} onChange={(e) => setConcept({ ...concept, vatRate: e.target.value })}>
                {['21', '10.5', '27', '0'].map((r) => <option key={r} value={r}>{r.replace('.', ',')}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Motivo" htmlFor="ncreason" className="mt-3"><Input id="ncreason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="mt-3 flex gap-2">
            <Button loading={nc.isPending || nd.isPending} disabled={reason.trim().length < 3} onClick={() => (panel === 'NC' ? nc.mutate() : nd.mutate())}>Emitir</Button>
            <Button variant="secondary" onClick={() => setPanel(null)}>Cancelar</Button>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <DocHeader
          company={d.company}
          title={d.label}
          letter={letter}
          number={fmtFiscal(d).split(' ')[1] ?? ''}
          meta={<><p className="text-muted">Fecha {fmtDate(d.issueDate)}</p>{d.dueDate && <p className="text-muted">Vence {fmtDate(d.dueDate)}</p>}</>}
        />
        <div className="my-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium">{d.party?.legalName}</p>
            <p className="text-muted">CUIT {d.party?.taxId} · {TAX_CONDITION_LABELS[d.party?.taxCondition ?? '']}</p>
            <p className="text-muted">{addr}</p>
          </div>
          <div className="text-sm sm:text-right">
            {d.deliveries.length > 0 && (
              <p>Remitos: {d.deliveries.map((r, i) => <span key={r.id}>{i > 0 && ', '}<Link className="hover:underline" href={`/ventas/remitos/${r.id}`}>{r.number}</Link></span>)}</p>
            )}
            {d.related && <p>Sobre <Link className="hover:underline" href={`/ventas/comprobantes/${d.related.id}`}>{fmtFiscal(d.related)}</Link></p>}
            {d.seller && <p className="print-hide text-muted">Vendedor: {d.seller}{d.commissionPct ? ` (${fmtQty(d.commissionPct)} %)` : ''}</p>}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border text-xs text-muted uppercase">
              <th className="px-2 py-2 text-left">Descripción</th>
              <th className="px-2 py-2 text-right">Cant.</th>
              <th className="px-2 py-2 text-right">Precio</th>
              <th className="px-2 py-2 text-right">Bonif.</th>
              {discriminates && <th className="px-2 py-2 text-right">IVA</th>}
              <th className="px-2 py-2 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => {
              // En B y C el precio se muestra con IVA incluido.
              const gross = (v: string) => roundMoney(dec(v).times(dec(1).plus(dec(l.vatRate).div(100)))).toFixed(2);
              return (
                <tr key={l.id} className="border-b border-border">
                  <td className="px-2 py-1.5">{l.description}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtQty(l.qty)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(discriminates ? l.unitPrice : gross(l.unitPrice))}</td>
                  <td className="num px-2 py-1.5 text-right">{isZero(l.discountPct) ? '' : `${fmtQty(l.discountPct)} %`}</td>
                  {discriminates && <td className="num px-2 py-1.5 text-right">{fmtQty(l.vatRate)} %</td>}
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(discriminates ? l.net : roundMoney(dec(l.net).plus(l.vat)).toFixed(2))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="mt-4 ml-auto grid w-64 grid-cols-2 gap-y-1 text-sm">
          {discriminates && (
            <>
              <dt className="text-muted">Neto gravado</dt><dd className="num text-right">{fmtMoney(d.netTotal)}</dd>
              <dt className="text-muted">IVA</dt><dd className="num text-right">{fmtMoney(d.vatTotal)}</dd>
            </>
          )}
          <dt className="font-medium">Total</dt><dd className="num text-right text-base font-semibold">{fmtMoney(d.total)}</dd>
        </dl>
        {letter === 'B' && <p className="mt-2 text-xs text-muted">IVA contenido: {fmtMoney(d.vatTotal)} (Ley 27.743, régimen de transparencia fiscal).</p>}
        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-sm">
          <p>CAE: <span className="num font-medium">{d.cae ?? '—'}</span> · Vto. CAE: {fmtDate(d.caeDueDate)}</p>
          {d.arcaMode === 'SIMULATED' && <p className="font-semibold text-danger">COMPROBANTE DE PRUEBA · CAE SIMULADO · SIN VALIDEZ FISCAL</p>}
        </div>
        {d.notes && <p className="mt-2 text-sm text-muted">{d.notes}</p>}
      </Card>

      {(d.children.length > 0 || d.allocations.length > 0) && (
        <Card className="print-hide mt-4 p-4 text-sm">
          {d.children.length > 0 && (
            <>
              <p className="mb-1 font-medium">Notas asociadas</p>
              <ul className="mb-3">
                {d.children.map((c) => (
                  <li key={c.id} className="flex gap-3 py-0.5">
                    <Link className="hover:underline" href={`/ventas/comprobantes/${c.id}`}>{fmtFiscal(c)}</Link>
                    <span className="num">{fmtMoney(c.total)}</span>
                    <Badge tone={(FD_STATUS[c.status] ?? ['', 'neutral'])[1]}>{(FD_STATUS[c.status] ?? [c.status])[0]}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
          {d.allocations.length > 0 && (
            <>
              <p className="mb-1 font-medium">Imputaciones</p>
              <ul>
                {d.allocations.map((a) => (
                  <li key={a.id} className="flex gap-3 py-0.5">
                    <span>{fmtDate(a.createdAt)}</span>
                    <span>{ENTRY_TYPES[a.counterpartType ?? ''] ?? ''} · {a.counterpart}</span>
                    <span className="num ml-auto">{fmtMoney(a.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
