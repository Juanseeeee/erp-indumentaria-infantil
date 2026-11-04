'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Clock, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtQty, PROD_STATUS } from '@/lib/format';
import { Card, PageHeader, Spinner, Stat } from '@/components/ui';

interface Dashboard {
  byStatus: Record<string, number>;
  overdue: { id: string; number: string; dueDate: string; product?: string }[];
  shortages: { orderId: string; number: string; shortage: string; item?: { sku: string; name: string } }[];
  atWorkshops: { id: string; number: string; workshop?: string; order?: { id: string; number: string }; pending: string; expectedAt: string | null; late: boolean }[];
}

function Panel({ title, icon, children, empty }: { title: string; icon: React.ReactNode; children: React.ReactNode; empty: boolean }) {
  return (
    <Card>
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 font-medium">{icon} {title}</h2>
      {empty ? <p className="px-4 py-6 text-sm text-muted">Nada pendiente.</p> : <ul>{children}</ul>}
    </Card>
  );
}

export default function ProductionDashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['production-dashboard'], queryFn: () => api.get<Dashboard>('/production/dashboard') });
  if (isLoading || !data) return <Spinner />;
  const n = (s: string) => data.byStatus[s] ?? 0;
  return (
    <div>
      <PageHeader title="Tablero de producción" description="Órdenes en curso, atrasos, faltantes de materiales y trabajo en talleres." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={PROD_STATUS.DRAFT![0]} value={n('DRAFT')} hint="Para planificar" />
        <Stat label={PROD_STATUS.RELEASED![0]} value={n('RELEASED')} hint="Materiales reservados" />
        <Stat label={PROD_STATUS.IN_PROGRESS![0]} value={n('IN_PROGRESS')} />
        <Stat label={PROD_STATUS.COMPLETED![0]} value={n('COMPLETED')} hint="Listas para cerrar" />
        <Stat label="Atrasadas" value={data.overdue.length} tone={data.overdue.length ? 'danger' : undefined} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Órdenes atrasadas" icon={<Clock className="size-4 text-danger" aria-hidden />} empty={!data.overdue.length}>
          {data.overdue.map((o) => (
            <li key={o.id} className="flex justify-between border-b border-border px-4 py-2 text-sm last:border-0">
              <Link className="hover:underline" href={`/produccion/ordenes/${o.id}`}>{o.number} · {o.product}</Link>
              <span className="text-danger">{fmtDate(o.dueDate)}</span>
            </li>
          ))}
        </Panel>
        <Panel title="Materiales faltantes" icon={<AlertTriangle className="size-4 text-warning" aria-hidden />} empty={!data.shortages.length}>
          {data.shortages.map((s, i) => (
            <li key={i} className="flex justify-between gap-2 border-b border-border px-4 py-2 text-sm last:border-0">
              <Link className="min-w-0 truncate hover:underline" href={`/produccion/ordenes/${s.orderId}`}>{s.item?.name} <span className="text-muted">· {s.number}</span></Link>
              <span className="num shrink-0 text-warning">{fmtQty(s.shortage)}</span>
            </li>
          ))}
        </Panel>
        <Panel title="Trabajo en talleres" icon={<Truck className="size-4 text-accent" aria-hidden />} empty={!data.atWorkshops.length}>
          {data.atWorkshops.map((d) => (
            <li key={d.id} className="border-b border-border px-4 py-2 text-sm last:border-0">
              <Link className="flex justify-between hover:underline" href={`/produccion/ordenes/${d.order?.id}`}>
                <span>{d.workshop}</span>
                <span className="num">{fmtQty(d.pending)} prendas</span>
              </Link>
              <span className={`text-xs ${d.late ? 'text-danger' : 'text-muted'}`}>
                {d.number} · {d.order?.number} · esperado {fmtDate(d.expectedAt)}{d.late && ' · demorado'}
              </span>
            </li>
          ))}
        </Panel>
      </div>
      <Link href="/produccion/ordenes" className="mt-4 inline-flex items-center gap-1 text-sm text-accent">Ver todas las órdenes <ArrowRight className="size-3" /></Link>
    </div>
  );
}
