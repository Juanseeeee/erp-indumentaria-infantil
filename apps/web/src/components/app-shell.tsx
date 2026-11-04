'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, Menu, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { NAV } from './nav';
import { CommandPalette } from './command-palette';
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
    <nav aria-label="Navegación principal" className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <div className="px-2">
        <p className="text-sm font-semibold">{me.company.tradeName ?? me.company.legalName}</p>
        <p className="text-xs text-muted">ERP Indumentaria</p>
      </div>
      {NAV.map((section, i) => {
        const items = section.items.filter((it) => !it.perm || can(it.perm));
        if (!items.length) return null;
        return (
          <div key={i}>
            {section.title && <p className="mb-1 px-2 text-xs font-medium tracking-wide text-muted uppercase">{section.title}</p>}
            <ul className="flex flex-col gap-0.5">
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
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
    </div>
  );
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
