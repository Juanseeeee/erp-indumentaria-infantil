'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, PageHeader, Spinner } from '@/components/ui';

/** Listado de modelos para entrar a su ficha técnica. */
export default function TechSheetsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['products', 'for-sheets'],
    queryFn: () => api.get<{ rows: { id: string; code: string; name: string; status: string }[] }>('/catalog/products?pageSize=200'),
  });
  if (isLoading) return <Spinner />;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Fichas técnicas" description="Materiales, consumos por talle, merma y recorrido de etapas de cada modelo. Se versionan: activar una versión nueva no cambia las órdenes ya liberadas." />
      <Card>
        <ul>
          {data?.rows.map((p) => (
            <li key={p.id} className="border-b border-border last:border-0">
              <Link href={`/produccion/fichas/${p.id}`} className="flex justify-between px-4 py-3 text-sm hover:bg-surface-2">
                <span><strong>{p.code}</strong> · {p.name}</span>
                <span className="text-accent">Ver ficha →</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
