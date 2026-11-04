'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileSpreadsheet, Search } from 'lucide-react';
import { REPORT_CATEGORIES, type ReportDefinition } from '@erp/contracts';
import { api } from '@/lib/api';
import { Card, EmptyState, ErrorBox, Input, PageHeader, Spinner } from '@/components/ui';

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: ['report-catalog'], queryFn: () => api.get<ReportDefinition[]>('/reports/catalog') });
  const term = search.trim().toLowerCase();
  const visible = (data ?? []).filter((r) => !term || `${r.title} ${r.description} ${r.category}`.toLowerCase().includes(term));

  return (
    <div>
      <PageHeader title="Reportes" description="Los reportes que tu rol puede consultar. Cada uno se ve en pantalla y se descarga en Excel o PDF." />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label="Buscar reporte" placeholder="Buscar reporte…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !visible.length ? (
        <Card>
          <EmptyState icon={<FileSpreadsheet className="size-8" aria-hidden />} title="No hay reportes" description={term ? 'Ningún reporte coincide con la búsqueda.' : 'Tu rol no tiene reportes disponibles.'} />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {REPORT_CATEGORIES.map((category) => {
            const reports = visible.filter((r) => r.category === category);
            if (!reports.length) return null;
            return (
              <section key={category} aria-labelledby={`cat-${category}`}>
                <h2 id={`cat-${category}`} className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">{category}</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {reports.map((r) => (
                    <Link key={r.code} href={`/reportes/${r.code}`} className="group rounded-lg border border-border bg-surface p-4 hover:border-accent">
                      <span className="flex items-center justify-between gap-2 font-medium">
                        {r.title}
                        <ChevronRight className="size-4 text-muted group-hover:text-accent" aria-hidden />
                      </span>
                      <span className="mt-1 block text-sm text-muted">{r.description}</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
