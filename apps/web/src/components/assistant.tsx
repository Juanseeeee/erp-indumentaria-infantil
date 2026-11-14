'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, Compass, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { TOURS, canTakeTour, type Tour } from '@erp/contracts';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { useMe } from '@/lib/session';
import { useTour } from './tour';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  /** Recorridos guiados relacionados con la pregunta (los elige el servidor). */
  tours?: { id: string; title: string }[];
}
type ServerEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; label: string }
  | { type: 'tours'; tours: { id: string; title: string }[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

const STORAGE_KEY = 'erp-assistant-chat';

/** Sugerencias según la sección donde está el usuario. */
function suggestionsFor(path: string): string[] {
  if (path.startsWith('/ventas') || path.startsWith('/cobros') || path.startsWith('/cuentas-a-cobrar'))
    return ['¿Cómo cargo un pedido de un cliente mayorista?', '¿Cómo facturo un remito?', '¿Cómo registro un cobro con cheque?'];
  if (path.startsWith('/compras') || path.startsWith('/cuentas-a-pagar') || path.startsWith('/pagos'))
    return ['¿Cómo recibo una compra que llegó incompleta?', '¿Cómo cargo la factura del proveedor?', '¿Cómo pago con un cheque de cartera?'];
  if (path.startsWith('/produccion'))
    return ['¿Cómo creo y libero una orden de producción?', '¿Cómo envío trabajo a un taller?', '¿Qué hago si falta material para una orden?'];
  if (path.startsWith('/stock') || path.startsWith('/materiales'))
    return ['¿Cómo hago un ajuste de stock?', '¿Por qué el disponible es menor que el físico?', '¿Cómo hago un inventario físico?'];
  if (path.startsWith('/catalogo'))
    return ['¿Cómo creo una colección nueva?', '¿Cómo cargo la ficha técnica de un modelo?', '¿Cómo se arma el SKU de cada variante?'];
  if (path.startsWith('/tesoreria') || path.startsWith('/gastos') || path.startsWith('/flujo-de-fondos'))
    return ['¿Cómo concilio un extracto bancario?', '¿Cómo cargo un gasto recurrente?', '¿Cómo leo el flujo de fondos?'];
  if (path.startsWith('/configuracion')) return ['¿Cómo creo un usuario y le asigno un rol?', '¿Qué permisos tiene cada rol?', '¿Dónde veo quién modificó algo?'];
  return ['¿Qué puedo hacer con mi usuario?', '¿Cuál es el circuito de una venta de punta a punta?', '¿Cómo busco rápido un cliente o un documento?'];
}

/** Panel lateral del asistente de IA. */
export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { data: status } = useQuery({ queryKey: ['assistant-status'], queryFn: () => api.get<{ enabled: boolean; mode?: 'claude' | 'gemini' | 'guide' }>('/assistant/status'), staleTime: 5 * 60_000, enabled: open });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<'chat' | 'tours'>('chat');
  const tour = useTour();
  const startTour = (id: string) => {
    tour.start(id);
    onClose();
  };

  // La conversación dura lo que la pestaña (no se guarda en el servidor).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved) as Msg[]);
    } catch {
      /* sin almacenamiento: conversación solo en memoria */
    }
  }, []);
  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignorar */
    }
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
  // Con cada pregunta nueva, la pregunta queda arriba y la respuesta se lee desde el principio.
  const lastQuestionRef = useRef<HTMLLIElement>(null);
  const questions = messages.filter((m) => m.role === 'user').length;
  const answerStarted = !!messages.at(-1)?.content && messages.at(-1)?.role === 'assistant';
  useEffect(() => {
    lastQuestionRef.current?.scrollIntoView({ block: 'start' });
  }, [questions, answerStarted, open]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history: Msg[] = [...messages.filter((m) => !m.error), { role: 'user', content: question }];
    setMessages([...messages, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    setActivity('Pensando');
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const append = (patch: (m: Msg) => Msg) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = patch(next[next.length - 1]!);
        return next;
      });

    try {
      const csrf = /(?:^|;\s*)erp_csrf=([^;]+)/.exec(document.cookie)?.[1];
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-csrf-token': csrf ? decodeURIComponent(csrf) : '' },
        credentials: 'same-origin',
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), page: window.location.pathname + window.location.search }),
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? 'No se pudo consultar al asistente.');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6)) as ServerEvent;
          if (ev.type === 'text') {
            setActivity(null);
            append((m) => ({ ...m, content: m.content + ev.text }));
          } else if (ev.type === 'tool') {
            setActivity(ev.label);
            append((m) => (m.content && !m.content.endsWith('\n') ? { ...m, content: m.content + '\n\n' } : m));
          } else if (ev.type === 'tours') {
            append((m) => ({ ...m, tours: ev.tours }));
          } else if (ev.type === 'error') {
            append((m) => ({ ...m, content: (m.content ? m.content + '\n\n' : '') + ev.message, error: true }));
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) {
        append((m) => ({ ...m, content: m.content ? m.content + ' …' : '(Respuesta detenida.)', error: !m.content }));
      } else {
        append((m) => ({ ...m, content: err instanceof Error ? err.message : 'No se pudo consultar al asistente.', error: true }));
      }
    } finally {
      setBusy(false);
      setActivity(null);
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    inputRef.current?.focus();
  };

  if (!open) return null;
  const disabled = status && !status.enabled;

  return (
    <aside
      role="dialog"
      aria-label="Asistente"
      className="fixed inset-0 z-40 flex flex-col border-l border-border bg-surface shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px]"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <header className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Sparkles className="size-4 text-accent" aria-hidden />
        <p className="text-sm font-semibold">Asistente</p>
        <span className="flex-1">
          {status?.mode && (
            <span
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
              title={status.mode === 'guide' ? 'Responde buscando en la guía de la plataforma, sin inteligencia artificial.' : 'Responde con inteligencia artificial.'}
            >
              {status.mode === 'guide' ? 'Modo guía' : status.mode === 'gemini' ? 'IA · Gemini' : 'IA · Claude'}
            </span>
          )}
        </span>
        <button
          onClick={() => setView((v) => (v === 'tours' ? 'chat' : 'tours'))}
          aria-pressed={view === 'tours'}
          className={cn('rounded-md p-2 hover:bg-surface-2 hover:text-text', view === 'tours' ? 'text-accent' : 'text-muted')}
          title="Recorridos guiados"
          aria-label="Recorridos guiados"
        >
          <Compass className="size-4" />
        </button>
        {messages.length > 0 && view === 'chat' && (
          <button onClick={reset} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text" title="Nueva conversación" aria-label="Nueva conversación">
            <RotateCcw className="size-4" />
          </button>
        )}
        <button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text" title="Cerrar (Esc)" aria-label="Cerrar asistente">
          <X className="size-4" />
        </button>
      </header>

      {view === 'tours' ? (
        <TourList onBack={() => setView('chat')} onStart={startTour} />
      ) : (
      <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium">¿En qué te ayudo?</p>
              <p className="mt-1 text-sm text-muted">
                Preguntame cómo hacer cualquier tarea en la plataforma, dónde está una pantalla o por qué algo no te deja avanzar. También puedo consultar stock y
                el estado de un documento por su número.
                {status?.mode === 'guide' && ' Ahora respondo buscando en la guía de la plataforma: usá palabras concretas, como «facturar un remito» o «ajuste de stock».'}
              </p>
            </div>
            {disabled ? (
              <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
                El asistente no está configurado en este servidor. Un administrador tiene que cargar la clave de la API de Anthropic (ANTHROPIC_API_KEY).
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {suggestionsFor(pathname).map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setView('tours')}
              className="flex items-center gap-3 rounded-md border border-accent/40 bg-accent-soft px-3 py-2.5 text-left text-sm hover:border-accent"
            >
              <Compass className="size-5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block font-medium">Recorridos guiados</span>
                <span className="block text-xs text-muted">Te llevo por las pantallas y te marco dónde tocar, paso a paso.</span>
              </span>
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <li
                key={i}
                ref={m.role === 'user' && i === messages.findLastIndex((x) => x.role === 'user') ? lastQuestionRef : undefined}
                className={cn('flex scroll-mt-2', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {m.role === 'user' ? (
                  <p className="max-w-[85%] rounded-lg bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <div className={cn('w-full text-sm leading-relaxed', m.error && 'text-danger')}>
                    {m.content ? <Markdown text={m.content} onNavigate={() => window.innerWidth < 640 && onClose()} onAsk={(q) => void send(q)} /> : null}
                    {m.tours?.length && !(busy && i === messages.length - 1) ? (
                      <div className="mt-3 flex flex-col gap-1.5">
                        {m.tours.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => startTour(t.id)}
                            className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-left text-sm font-medium text-accent hover:border-accent"
                          >
                            <Compass className="size-4 shrink-0" aria-hidden />
                            Guiame paso a paso: {t.title}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {busy && i === messages.length - 1 && activity && (
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <span className="inline-block size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
                        {activity}…
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-border bg-bg px-3 py-2 focus-within:border-accent">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={Math.min(5, Math.max(1, input.split('\n').length))}
            maxLength={4000}
            disabled={disabled}
            placeholder={disabled ? 'Asistente no disponible' : 'Escribí tu pregunta…'}
            aria-label="Pregunta para el asistente"
            className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted focus-visible:outline-none"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-md bg-surface-2 p-1.5 text-text" title="Detener" aria-label="Detener respuesta">
              <Square className="size-4" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || disabled} className="rounded-md bg-accent p-1.5 text-accent-text disabled:opacity-40" title="Enviar (Enter)" aria-label="Enviar pregunta">
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {status?.mode === 'guide'
            ? 'Respuestas tomadas de la guía de la plataforma. El asistente no realiza cambios.'
            : 'Respuestas generadas por IA: revisá los datos antes de confirmar una operación. El asistente no realiza cambios.'}
        </p>
      </form>
      </>
      )}
    </aside>
  );
}

/** Listado de recorridos guiados que el usuario puede hacer, por área, con búsqueda. */
function TourList({ onBack, onStart }: { onBack: () => void; onStart: (id: string) => void }) {
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = norm(q).split(/\s+/).filter(Boolean);
  const available = TOURS.filter((t) => canTakeTour(t, me?.permissions ?? []));
  const shown = available.filter((t) => {
    const hay = norm([t.title, t.description, t.area, ...t.keywords].join(' '));
    return words.every((w) => hay.includes(w));
  });
  const areas = [...new Set(shown.map((t) => t.area))];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border p-3">
        <button onClick={onBack} className="mb-2 flex items-center gap-1 text-xs text-muted hover:text-text">
          <ArrowLeft className="size-3.5" aria-hidden /> Volver al chat
        </button>
        <p className="text-sm font-medium">Recorridos guiados</p>
        <p className="mt-0.5 text-xs text-muted">Elegí una tarea: te llevo a cada pantalla y te marco dónde tocar. Podés salir cuando quieras con Esc.</p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder="Buscar: venta, factura, stock, taller…"
          aria-label="Buscar recorrido"
          className="mt-2 h-9 w-full rounded-md border border-border bg-bg px-3 text-sm outline-none focus:border-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!shown.length && <p className="px-1 text-sm text-muted">{available.length ? 'No hay recorridos con esas palabras.' : 'Todavía no hay recorridos disponibles para tu usuario.'}</p>}
        {areas.map((area) => (
          <section key={area} className="mb-4">
            <p className="mb-1 px-1 text-[11px] font-medium tracking-wide text-muted uppercase">{area}</p>
            <ul className="flex flex-col gap-1">
              {shown
                .filter((t) => t.area === area)
                .map((t: Tour) => (
                  <li key={t.id}>
                    <button onClick={() => onStart(t.id)} className="w-full rounded-md px-2 py-2 text-left hover:bg-surface-2">
                      <span className="block text-sm font-medium">{t.title}</span>
                      <span className="block text-xs text-muted">
                        {t.description} · {t.steps.length} pasos
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Markdown mínimo y seguro: párrafos, listas, negrita, código y enlaces internos (rutas que empiezan con «/»). */
interface Handlers {
  onNavigate: () => void;
  /** Enlaces «#ask:…»: preguntas sugeridas que se envían al tocarlas. */
  onAsk: (question: string) => void;
}

function Markdown({ text, ...h }: { text: string } & Handlers) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && (re.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length))) {
        if (re.test(lines[i]!)) items.push(lines[i]!.replace(re, ''));
        else items[items.length - 1] += ' ' + lines[i]!.trim();
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={blocks.length} className={cn('my-2 flex flex-col gap-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
          {items.map((it, k) => (
            <li key={k}>{inline(it, h)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={blocks.length} className="mt-3 mb-1 font-semibold">
          {inline(heading[1]!, h)}
        </p>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !bullet.test(lines[i]!) && !numbered.test(lines[i]!) && !/^#{1,6}\s/.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={blocks.length} className="my-2 first:mt-0">
        {para.map((p, k) => (
          <Fragment key={k}>
            {k > 0 && <br />}
            {inline(p, h)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}

function inline(text: string, { onNavigate, onAsk }: Handlers): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = m[2]!;
      if (href.startsWith('#ask:')) {
        const q = decodeURIComponent(href.slice(5));
        out.push(
          <button key={m.index} type="button" onClick={() => onAsk(q)} className="text-left font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
            {m[1]}
          </button>,
        );
        last = re.lastIndex;
        continue;
      }
      out.push(
        href.startsWith('/') && !href.startsWith('//') ? (
          <Link key={m.index} href={href} onClick={onNavigate} className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
            {m[1]}
          </Link>
        ) : (
          m[1]
        ),
      );
    } else if (m[3] !== undefined) {
      out.push(<strong key={m.index}>{m[3]}</strong>);
    } else {
      out.push(
        <code key={m.index} className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">
          {m[4]}
        </code>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
