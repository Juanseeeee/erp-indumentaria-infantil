'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, PageHeader, Select, Spinner } from '@/components/ui';

interface AuditRow {
  id: string;
  at: string;
  user: string | null;
  ip: string | null;
  entity: string;
  entityId: string;
  action: string;
  diff: unknown;
  reason: string | null;
}

const ENTITIES: Record<string, string> = {
  party: 'Terceros',
  product: 'Modelos',
  item: 'Variantes',
  material: 'Materiales',
  stock_document: 'Documentos de stock',
  inventory_count: 'Inventarios',
  user: 'Usuarios',
  role: 'Roles',
  session: 'Sesiones',
  warehouse: 'Depósitos',
  company: 'Empresa',
  approval_rule: 'Reglas de aprobación',
};

export default function AuditPage() {
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['audit', entity, page],
    queryFn: () => api.get<AuditRow[]>(`/settings/audit${qs({ entity, page })}`),
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Auditoría" description="Quién hizo qué y cuándo. El registro es de solo inserción: no se puede modificar ni borrar." />
      <div className="mb-3 flex gap-2">
        <Select aria-label="Entidad" data-tour="auditoria-entidad" className="w-56" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>
          <option value="">Todas las entidades</option>
          {Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto" tour="auditoria-tabla">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Usuario</th>
                <th className="px-3 py-2 text-left">Entidad</th>
                <th className="px-3 py-2 text-left">Acción</th>
                <th className="px-3 py-2 text-left" data-tour="auditoria-col-detalle">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td className="px-3 py-2">{r.user ?? '—'}</td>
                  <td className="px-3 py-2">{ENTITIES[r.entity] ?? r.entity}</td>
                  <td className="px-3 py-2">
                    {r.action}
                    {r.reason && <span className="block text-xs text-muted">Motivo: {r.reason}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.diff ? (
                      <button className="text-accent hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? 'Ocultar' : 'Ver cambios'}
                      </button>
                    ) : (
                      '—'
                    )}
                    {open === r.id && <pre className="mt-2 max-w-md overflow-x-auto rounded bg-surface-2 p-2 text-xs">{JSON.stringify(r.diff, null, 2)}</pre>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 border-t border-border p-2" data-tour="auditoria-paginas">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button size="sm" variant="ghost" disabled={(data?.length ?? 0) < 100} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
