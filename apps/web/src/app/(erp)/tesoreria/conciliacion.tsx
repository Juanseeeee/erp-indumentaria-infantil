'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { FileSpreadsheet } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Can } from '@/lib/session';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select } from '@/components/ui';

interface Account {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface Statement {
  id: string;
  fileName: string;
  account: string;
  periodFrom: string;
  periodTo: string;
  lineCount: number;
  skippedCount: number;
  pending: number;
  createdAt: string;
}

interface ImportResult {
  id: string;
  lineCount: number;
  skippedCount: number;
  errors: { line: number; message: string }[];
}

/** Importación de extractos del home banking (CSV) y acceso a la conciliación de cada uno. */
export function Reconciliation({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const banks = accounts.filter((a) => a.isActive && (a.type === 'BANK' || a.type === 'WALLET'));
  const [selected, setSelected] = useState('');
  const accountId = banks.some((b) => b.id === selected) ? selected : banks[0]?.id ?? '';
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const list = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api.get<Statement[]>(`/treasury/statements${qs({})}`),
  });
  const upload = useMutation({
    mutationFn: async () => api.post<ImportResult>(`/treasury/accounts/${accountId}/statements`, { fileName: file!.name, content: await file!.text() }),
    onSuccess: async (r) => {
      setResult(r);
      await queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    upload.mutate();
  }

  const columns: ColumnDef<Statement, unknown>[] = [
    { accessorKey: 'fileName', header: 'Archivo', cell: ({ row }) => <span className="font-medium">{row.original.fileName}</span> },
    { accessorKey: 'account', header: 'Cuenta' },
    { id: 'period', header: 'Período', cell: ({ row }) => `${fmtDate(row.original.periodFrom)} al ${fmtDate(row.original.periodTo)}` },
    { accessorKey: 'lineCount', header: 'Líneas', meta: { align: 'right' } },
    {
      accessorKey: 'pending',
      header: 'Estado',
      cell: ({ row }) => (row.original.pending ? <Badge tone="warning">{row.original.pending} sin conciliar</Badge> : <Badge tone="success">Conciliado</Badge>),
    },
    { accessorKey: 'createdAt', header: 'Importado', cell: ({ row }) => fmtDateTime(row.original.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-4">
      {upload.error && <ErrorBox error={upload.error} />}
      <Can perm="treasury.move">
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Importar extracto</h2>
          <p className="mb-3 text-sm text-muted">
            CSV exportado del home banking, con columnas <strong>Fecha</strong> e <strong>Importe</strong> (o <strong>Débito</strong> y <strong>Crédito</strong>), y opcionalmente Concepto y Comprobante. Las líneas que ya se importaron se omiten.
          </p>
          {banks.length ? (
            <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
              <Field label="Cuenta" htmlFor="st-account">
                <Select id="st-account" value={accountId} onChange={(e) => setSelected(e.target.value)}>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Archivo CSV" htmlFor="st-file">
                <Input id="st-file" type="file" accept=".csv,.txt,text/csv,text/plain" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
              <Button type="submit" loading={upload.isPending} disabled={!file}>Importar</Button>
            </form>
          ) : (
            <p className="text-sm text-muted">Creá una cuenta bancaria o billetera en la pestaña Cuentas.</p>
          )}
          {result && (
            <div className="mt-3 text-sm" role="status">
              <p>
                Se importaron {result.lineCount} líneas{result.skippedCount ? ` (${result.skippedCount} ya estaban importadas)` : ''}.{' '}
                <button type="button" className="font-medium text-accent underline" onClick={() => router.push(`/tesoreria/extractos/${result.id}`)}>Conciliar ahora</button>
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-warning">
                  {result.errors.slice(0, 5).map((e) => <li key={e.line}>Línea {e.line}: {e.message}</li>)}
                  {result.errors.length > 5 && <li>y {result.errors.length - 5} más</li>}
                </ul>
              )}
            </div>
          )}
        </Card>
      </Can>
      <DataTable
        id="bank-statements"
        columns={columns}
        data={list.data ?? []}
        loading={list.isLoading}
        onRowClick={(s) => router.push(`/tesoreria/extractos/${s.id}`)}
        empty={<EmptyState icon={<FileSpreadsheet className="size-8" />} title="Sin extractos" description="Importá el extracto del banco para conciliarlo con los movimientos del sistema." />}
      />
    </div>
  );
}
