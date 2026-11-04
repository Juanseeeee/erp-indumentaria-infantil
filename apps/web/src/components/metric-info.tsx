import { Info } from 'lucide-react';
import type { MetricDefinition } from '@erp/contracts';

/** ⓘ con la definición, la fórmula y la comparación de un indicador (fuente única: contracts/metrics.ts). */
export function MetricInfo({ def }: { def: MetricDefinition }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded text-muted hover:text-text" aria-label={`Cómo se calcula: ${def.label}`}>
        <Info className="size-4" aria-hidden />
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-72 rounded-md border border-border bg-surface p-3 text-xs font-normal normal-case tracking-normal shadow-lg">
        <p className="text-text">{def.definition}</p>
        <p className="mt-2 font-mono text-muted">{def.formula}</p>
        {def.comparison && <p className="mt-2 text-muted">Compara contra: {def.comparison}.</p>}
      </div>
    </details>
  );
}
