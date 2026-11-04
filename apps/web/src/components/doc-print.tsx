'use client';

import type { ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { Button } from './ui';

/** Encabezado de documento imprimible: emisor a la izquierda, tipo y número a la derecha. */
export function DocHeader({
  company,
  title,
  number,
  letter,
  meta,
}: {
  company: { legalName: string; cuit: string; address: string | null; taxCondition?: string } | null;
  title: string;
  number: string;
  letter?: string;
  meta?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4 border-b border-border pb-4">
      <div className="text-sm">
        <p className="text-base font-semibold">{company?.legalName}</p>
        <p className="text-muted">{company?.address}</p>
        <p className="text-muted">CUIT {company?.cuit}</p>
      </div>
      <div className="flex size-14 items-center justify-center rounded border-2 border-text text-3xl font-bold">{letter ?? 'X'}</div>
      <div className="text-right text-sm">
        <p className="text-base font-semibold">{title}</p>
        <p className="num font-medium">{number}</p>
        {meta}
      </div>
    </div>
  );
}

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="size-4" /> Imprimir
    </Button>
  );
}
