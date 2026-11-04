'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtDate, fmtMoney, isNegative } from '@/lib/format';

/** Semana del flujo de fondos tal como la devuelve la API. */
export interface ChartWeek {
  from: string;
  to: string;
  inflow: string;
  outflow: string;
  balance: string;
}

export const short = (d: string) => fmtDate(d).slice(0, 5);
/** $ 1,2 M / $ 350 k para ejes; los valores exactos van en tooltip y tabla. */
function compact(v: number) {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1_000_000) return `${s}$ ${(a / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `${s}$ ${Math.round(a / 1_000).toLocaleString('es-AR')} k`;
  return `${s}$ ${Math.round(a)}`;
}
/** Escala "linda": 0 y múltiplos redondos que cubren [min, max]. */
function ticks(min: number, max: number, count = 4) {
  const span = Math.max(max - min, 1);
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v));
  return out;
}

const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

/** Ancho real del contenedor: el gráfico se dibuja en píxeles, sin escalar el texto. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Cada cuántas semanas rotular el eje según el espacio disponible. */
const labelEvery = (count: number, width: number) => Math.max(1, Math.ceil(count / Math.max(2, Math.floor((width - PAD.left) / 56))));

export function Legend() {
  return (
    <div className="mb-2 mt-1 flex gap-4 text-xs text-muted" aria-hidden>
      <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--viz-in)' }} />Ingresos</span>
      <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--viz-out)' }} />Egresos</span>
    </div>
  );
}

interface ChartProps {
  weeks: ChartWeek[];
  selected?: number | null;
  onSelect?: (i: number | null) => void;
}

/** Columnas de ingresos (hacia arriba) y egresos (hacia abajo) desde un único cero. */
export function FlowChart({ weeks, selected, onSelect }: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const max = Math.max(...weeks.map((w) => Number(w.inflow)), 1);
  const min = Math.min(...weeks.map((w) => Number(w.outflow)), -1);
  const yt = ticks(min, max);
  const y0 = yt[0]!;
  const y1 = yt[yt.length - 1]!;
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const y = (v: number) => PAD.top + ((y1 - v) / (y1 - y0)) * plotH;
  const band = plotW / weeks.length;
  const barW = Math.min(18, (band - 6) / 2);
  const active = hover ?? selected ?? null;
  return (
    <div className="relative w-full min-w-0 overflow-hidden" ref={ref}>
      <svg width={W} height={H} className="block" role="img" aria-label="Ingresos y egresos esperados por semana; los valores exactos están en la tabla">
        {yt.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={v === 0 ? 1.5 : 1} />
            <text x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="var(--text-muted)">{compact(v)}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = PAD.left + band * i + band / 2;
          const inH = y(0) - y(Number(w.inflow));
          const outH = y(Number(w.outflow)) - y(0);
          return (
            <g key={w.from} opacity={active == null || active === i ? 1 : 0.45}>
              {inH > 0 && <path d={columnPath(cx - barW - 1, y(0), barW, inH, 'up')} fill="var(--viz-in)" />}
              {outH > 0 && <path d={columnPath(cx + 1, y(0), barW, outH, 'down')} fill="var(--viz-out)" />}
              {i % labelEvery(weeks.length, W) === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-muted)">{short(w.from)}</text>
              )}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(selected === i ? null : i)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          );
        })}
      </svg>
      {hover != null && <Tooltip week={weeks[hover]!} x={PAD.left + band * hover + band / 2} width={W} gap={band / 2} />}
    </div>
  );
}

/** Saldo de cierre semanal como línea, con el cero de referencia. */
export function BalanceChart({ weeks, selected, onSelect }: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const values = weeks.map((w) => Number(w.balance));
  const yt = ticks(Math.min(0, ...values), Math.max(0, ...values));
  const y0 = yt[0]!;
  const y1 = yt[yt.length - 1]!;
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const y = (v: number) => PAD.top + ((y1 - v) / (y1 - y0)) * plotH;
  const band = plotW / weeks.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const active = hover ?? selected ?? null;
  return (
    <div className="relative w-full min-w-0 overflow-hidden" ref={ref}>
      <svg width={W} height={H} className="block" role="img" aria-label="Saldo proyectado por semana; los valores exactos están en la tabla">
        {yt.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} strokeDasharray={v === 0 ? '4 4' : undefined} />
            <text x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="var(--text-muted)">{compact(v)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--viz-in)" strokeWidth={2} strokeLinejoin="round" />
        {values.map((v, i) => (
          <g key={weeks[i]!.from}>
            <circle cx={x(i)} cy={y(v)} r={active === i ? 5 : 4} fill={v < 0 ? 'var(--danger)' : 'var(--viz-in)'} stroke="var(--surface)" strokeWidth={2} />
            {i % labelEvery(weeks.length, W) === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-muted)">{short(weeks[i]!.from)}</text>
            )}
            <rect
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(selected === i ? null : i)}
              style={{ cursor: 'pointer' }}
            />
          </g>
        ))}
        {active != null && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text-muted)" strokeWidth={1} opacity={0.4} pointerEvents="none" />}
        <text x={x(values.length - 1)} y={y(values.at(-1)!) - 10} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--text)">{compact(values.at(-1)!)}</text>
      </svg>
      {hover != null && <Tooltip week={weeks[hover]!} x={x(hover)} width={W} gap={band / 2} />}
    </div>
  );
}

/** Al costado de la semana (a la derecha en la mitad izquierda y al revés), para no tapar sus marcas. */
function Tooltip({ week, x, width, gap }: { week: ChartWeek; x: number; width: number; gap: number }) {
  const right = x < width / 2;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 w-56 rounded-md border border-border bg-surface p-2 text-xs shadow-lg"
      style={right ? { left: x + gap } : { right: width - x + gap }}
    >
      <p className="mb-1 font-medium text-text">Semana del {fmtDate(week.from)}</p>
      <p className="flex justify-between text-muted"><span><span className="mr-1 inline-block size-2 rounded-sm" style={{ background: 'var(--viz-in)' }} />Ingresos</span><span className="num text-text">{fmtMoney(week.inflow)}</span></p>
      <p className="flex justify-between text-muted"><span><span className="mr-1 inline-block size-2 rounded-sm" style={{ background: 'var(--viz-out)' }} />Egresos</span><span className="num text-text">{fmtMoney(week.outflow.replace('-', ''))}</span></p>
      <p className="mt-1 flex justify-between border-t border-border pt-1 text-muted"><span>Saldo</span><span className={`num font-medium ${isNegative(week.balance) ? 'text-danger' : 'text-text'}`}>{fmtMoney(week.balance)}</span></p>
    </div>
  );
}

/** Columna con extremo de datos redondeado (4px) y base recta sobre el cero. */
function columnPath(x: number, base: number, w: number, h: number, dir: 'up' | 'down') {
  const r = Math.min(4, h, w / 2);
  if (dir === 'up') {
    const top = base - h;
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
  }
  const bottom = base + h;
  return `M${x},${base} V${bottom - r} Q${x},${bottom} ${x + r},${bottom} H${x + w - r} Q${x + w},${bottom} ${x + w},${bottom - r} V${base} Z`;
}
