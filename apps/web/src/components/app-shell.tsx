'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronRight, LogOut, Menu, Search, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { NAV } from './nav';
import { CommandPalette } from './command-palette';
import { AssistantPanel } from './assistant';
import { Spinner } from './ui';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, isLoading } = useMe();
  const can = useCan();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const nav = useOpenSections();
  const gPressed = useRef(false);

  // Atajos: Ctrl+K paleta, "/" foco en búsqueda de la tabla, G + tecla navegación.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setAssistantOpen((v) => !v);
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        const el = document.querySelector<HTMLInputElement>('[data-table-search]');
        if (el) {
          e.preventDefault();
          el.focus();
        }
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        gPressed.current = true;
        setTimeout(() => (gPressed.current = false), 800);
        return;
      }
      if (gPressed.current) {
        const item = NAV.flatMap((s) => s.items).find((i) => i.key === e.key.toLowerCase());
        if (item && (!item.perm || can(item.perm))) router.push(item.href);
        gPressed.current = false;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [can, router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  // Al entrar a una pantalla, su sección del menú se abre (las demás quedan como el usuario las dejó).
  useEffect(() => {
    if (!nav.loaded) return;
    const section = NAV.find((s) => s.title && s.items.some((it) => pathname === it.href.split('?')[0] || pathname.startsWith(it.href.split('?')[0] + '/')));
    if (section?.title) nav.ensure(section.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, nav.loaded]);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };

  if (isLoading || !me) return <Spinner label="Cargando sesión…" />;

  const current = pathname + (search.toString() ? `?${search.toString()}` : '');
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href.includes('?')) return current === href;
    const exact = NAV.flatMap((s) => s.items).some((i) => i.href !== href && i.href.startsWith(href + '/') && pathname.startsWith(i.href));
    return !exact && (pathname === href || pathname.startsWith(href + '/'));
  };

  const sidebar = (
    <nav aria-label="Navegación principal" className="flex h-full flex-col gap-1.5 overflow-y-auto px-3 py-4">
      <div className="mb-2 px-2">
        <p className="text-sm font-semibold">{me.company.tradeName ?? me.company.legalName}</p>
        <p className="text-xs text-muted">ERP Indumentaria</p>
      </div>
      {NAV.map((section, i) => {
        const items = section.items.filter((it) => !it.perm || can(it.perm));
        if (!items.length) return null;
        const title = section.title;
        const expanded = !title || nav.open.includes(title);
        const listId = `nav-${i}`;
        return (
          <div key={i}>
            {title && (
              <button
                type="button"
                onClick={() => nav.toggle(title)}
                aria-expanded={expanded}
                aria-controls={listId}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium tracking-wide text-muted uppercase hover:bg-surface-2 hover:text-text"
              >
                <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} aria-hidden />
                <span className="flex-1 text-left">{title}</span>
                {!expanded && items.some((it) => isActive(it.href)) && <span className="size-1.5 rounded-full bg-accent" aria-label="Sección actual" />}
              </button>
            )}
            <ul id={listId} hidden={!expanded} className="mt-0.5 flex flex-col gap-0.5">
              {items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    aria-current={isActive(it.href) ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm',
                      isActive(it.href) ? 'bg-accent-soft font-medium text-accent' : 'text-text hover:bg-surface-2',
                    )}
                  >
                    <it.icon className="size-4" aria-hidden />
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-surface lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64 bg-surface" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setMobileOpen((v) => !v)} aria-label="Abrir menú">
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm text-muted hover:bg-surface-2"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 truncate text-left">Buscar o ejecutar una acción…</span>
            <kbd className="hidden rounded border border-border px-1.5 text-xs sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setAssistantOpen((v) => !v)}
              aria-pressed={assistantOpen}
              title="Asistente (Ctrl J)"
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm',
                assistantOpen ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text hover:bg-surface-2',
              )}
            >
              <Sparkles className="size-4 text-accent" aria-hidden />
              <span className="hidden sm:inline">Asistente</span>
            </button>
            <AlertsBell />
            <Link href="/cuenta" className="hidden text-right sm:block">
              <p className="text-sm font-medium">{me.user.name}</p>
              <p className="text-xs text-muted">{me.roles.map((r) => r.name).join(', ')}</p>
            </Link>
            <button onClick={logout} className="rounded-md p-2 text-muted hover:bg-surface-2" aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className={cn('mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6', assistantOpen && 'xl:pr-[436px]')}>{children}</main>
      </div>
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} onAskAssistant={() => setAssistantOpen(true)} />
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}

const NAV_STORAGE_KEY = 'erp-nav-open-sections';

/** Secciones del menú que el usuario dejó abiertas (se recuerdan en este navegador). */
function useOpenSections() {
  const [open, setOpen] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAV_STORAGE_KEY);
      if (saved) setOpen(JSON.parse(saved) as string[]);
    } catch {
      /* sin almacenamiento: se abre solo la sección actual */
    }
    setLoaded(true);
  }, []);
  const change = (fn: (prev: string[]) => string[]) =>
    setOpen((prev) => {
      const next = fn(prev);
      if (next === prev) return prev;
      try {
        localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignorar */
      }
      return next;
    });
  return {
    open,
    loaded,
    toggle: (title: string) => change((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title])),
    ensure: (title: string) => change((prev) => (prev.includes(title) ? prev : [...prev, title])),
  };
}

/** Campana: alertas nuevas del usuario. Se refresca cada minuto y al volver a la pestaña. */
function AlertsBell() {
  const { data } = useQuery({
    queryKey: ['alerts-summary'],
    queryFn: () => api.get<{ new: number; open: number; critical: number }>('/alerts/summary'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const count = data?.new ?? 0;
  const label = count ? `Alertas: ${count} ${count === 1 ? 'nueva' : 'nuevas'}` : `Alertas${data?.open ? `: ${data.open} abiertas` : ''}`;
  return (
    <Link href="/alertas" className="relative rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label={label} title={label}>
      <Bell className="size-4" aria-hidden />
      {count > 0 && (
        <span className={cn('absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white', data?.critical ? 'bg-danger' : 'bg-accent')} aria-hidden>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
