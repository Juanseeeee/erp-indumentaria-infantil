'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Compass, X } from 'lucide-react';
import { findTour, tourRouteMatches, type Tour, type TourStep } from '@erp/contracts';
import { cn } from '@/lib/format';

/**
 * Recorridos guiados: llevan al usuario por las pantallas, resaltan el elemento marcado con
 * `data-tour` y explican qué hacer. El resto de la pantalla sigue usable (el oscurecido no bloquea).
 * El estado se guarda en la pestaña para sobrevivir a la navegación.
 */
interface TourState {
  id: string;
  step: number;
}
interface TourApi {
  active: Tour | null;
  start: (id: string) => void;
  stop: () => void;
}

const STORAGE_KEY = 'erp-tour';
const TourContext = createContext<TourApi>({ active: null, start: () => undefined, stop: () => undefined });

export const useTour = () => useContext(TourContext);

/** Pide al menú lateral que abra la sección de un enlace (los pasos pueden resaltar ítems del menú). */
export const NAV_REVEAL_EVENT = 'erp:nav-reveal';

export function TourProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TourState | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setState(JSON.parse(saved) as TourState);
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  const save = useCallback((next: TourState | null) => {
    setState(next);
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignorar */
    }
  }, []);

  const tour = state ? (findTour(state.id) ?? null) : null;
  const api = useMemo<TourApi>(() => ({ active: tour, start: (id) => findTour(id) && save({ id, step: 0 }), stop: () => save(null) }), [tour, save]);

  return (
    <TourContext.Provider value={api}>
      {children}
      {tour && state && <TourRunner tour={tour} step={Math.min(state.step, tour.steps.length - 1)} go={(step) => save({ id: tour.id, step })} stop={() => save(null)} />}
    </TourContext.Provider>
  );
}

const visible = (el: Element) => el.getClientRects().length > 0;

function findTarget(target: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);
  for (const el of all) if (visible(el)) return el;
  return null;
}

function routeWithQueryMatches(route: string, pathname: string, search: URLSearchParams) {
  if (!tourRouteMatches(route, pathname)) return false;
  const query = route.split('?')[1];
  if (!query) return true;
  return [...new URLSearchParams(query)].every(([k, v]) => search.get(k) === v);
}

type Rect = { top: number; left: number; width: number; height: number };

function TourRunner({ tour, step, go, stop }: { tour: Tour; step: number; go: (n: number) => void; stop: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const current: TourStep = tour.steps[step]!;
  const next = tour.steps[step + 1];
  const last = step === tour.steps.length - 1;
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const scrolledFor = useRef<string | null>(null);

  const onRoute = !current.route || routeWithQueryMatches(current.route, pathname, search);
  const wildcard = !!current.route?.includes('*');

  // Ruta exacta: al entrar a un paso, el recorrido lleva solo a su pantalla (una vez: si después el usuario
  // navega, no se lo trae de vuelta; el globo le ofrece volver).
  const navigatedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${tour.id}:${step}`;
    if (navigatedFor.current === key) return;
    navigatedFor.current = key;
    if (current.route && !wildcard && !onRoute) router.push(current.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id, step]);

  // Pasos que esperan navegación: avanzan cuando el usuario llega a la pantalla del paso siguiente.
  useEffect(() => {
    if (current.waitFor === 'route' && next?.route && routeWithQueryMatches(next.route, pathname, search)) go(step + 1);
  }, [current.waitFor, next?.route, pathname, search, step, go]);

  // Busca el elemento y sigue su posición (scroll, cambios de tamaño, contenido que se carga después).
  useLayoutEffect(() => {
    setRect(null);
    setMissing(false);
    if (!current.target || !onRoute) return;
    const target = current.target;
    if (target.startsWith('nav-')) window.dispatchEvent(new CustomEvent(NAV_REVEAL_EVENT, { detail: target.slice(4) }));
    const started = Date.now();
    let raf = 0;
    const tick = () => {
      const el = findTarget(target);
      if (el) {
        const key = `${tour.id}:${step}`;
        if (scrolledFor.current !== key) {
          scrolledFor.current = key;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        const r = el.getBoundingClientRect();
        setRect((prev) => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : { top: r.top, left: r.left, width: r.width, height: r.height }));
        setMissing(false);
      } else {
        setRect(null);
        if (Date.now() - started > 4000) setMissing(true);
      }
      raf = window.setTimeout(tick, 150) as unknown as number;
    };
    tick();
    return () => window.clearTimeout(raf);
  }, [current.target, onRoute, tour.id, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  const pad = 6;
  const hole = rect && { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };

  // Globo: debajo del elemento si entra; si no, arriba; sin elemento, centrado abajo.
  const W = 340;
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  let pos: CSSProperties;
  if (hole) {
    const left = Math.min(Math.max(12, hole.left), vw - W - 12);
    const below = hole.top + hole.height + 12;
    pos = below + 220 < vh ? { top: below, left } : { bottom: Math.max(12, vh - hole.top + 12), left };
  } else {
    pos = { bottom: 24, left: Math.max(12, (vw - W) / 2) };
  }

  let note: string | null = null;
  const canGo = !onRoute && !wildcard && !!current.route;
  if (!onRoute && wildcard) note = 'Este paso es en otra pantalla. Volvé al paso anterior y seguí sus indicaciones para llegar.';
  else if (canGo) note = 'Este paso es en otra pantalla.';
  else if (missing) note = 'No encuentro este elemento en la pantalla. Puede que dependa de tus permisos, de los datos cargados o de que haya que desplegar algo antes. Podés seguir con el paso siguiente.';

  return (
    <>
      {hole && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{ ...hole, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
        />
      )}
      {!hole && <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] bg-black/25" />}
      <div
        role="dialog"
        aria-live="polite"
        aria-label={`Recorrido guiado: ${tour.title}`}
        className="fixed z-[61] w-[340px] max-w-[calc(100vw-24px)] rounded-lg border border-border bg-surface p-4 shadow-2xl"
        style={pos}
      >
        <div className="flex items-start gap-2">
          <Compass className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] tracking-wide text-muted uppercase" title={tour.title}>
              {tour.title}
            </p>
            <p className="text-[11px] text-muted">
              Paso {step + 1} de {tour.steps.length}
            </p>
            <p className="mt-0.5 font-semibold">{current.title}</p>
          </div>
          <button onClick={stop} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text" aria-label="Salir del recorrido" title="Salir (Esc)">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed">{rich(current.body)}</p>
        {note && (
          <p className="mt-2 rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">
            {note}{' '}
            {canGo && (
              <button onClick={() => router.push(current.route!)} className="font-medium underline underline-offset-2">
                Ir a esa pantalla
              </button>
            )}
          </p>
        )}
        {current.waitFor === 'route' && !note && <p className="mt-2 text-xs text-muted">Tocá lo resaltado para seguir.</p>}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {tour.steps.map((_, i) => (
              <span key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-surface-2')} />
            ))}
          </div>
          {step > 0 && (
            <button onClick={() => go(step - 1)} className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-sm hover:bg-surface-2">
              <ChevronLeft className="size-4" aria-hidden /> Anterior
            </button>
          )}
          {last ? (
            <button onClick={stop} className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-text hover:bg-accent-hover">
              Terminar
            </button>
          ) : current.waitFor === 'route' && !note ? (
            <button onClick={() => go(step + 1)} className="h-8 rounded-md px-2 text-sm text-muted hover:bg-surface-2 hover:text-text" title="Pasar al paso siguiente sin tocar">
              Saltar
            </button>
          ) : (
            <button onClick={() => go(step + 1)} className="flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-accent-text hover:bg-accent-hover">
              Siguiente <ChevronRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** **negrita** en el texto de los pasos. */
function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}
