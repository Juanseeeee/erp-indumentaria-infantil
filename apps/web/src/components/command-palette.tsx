'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Boxes, FileText, Package, Search, Sparkles, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounced } from './data-table';
import { NAV, type NavItem } from './nav';
import { useCan } from '@/lib/session';

interface Hit {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const ICONS: Record<string, typeof Users> = { party: Users, product: Package, item: Boxes, stock_document: FileText };

/** Paleta de comandos (Ctrl+K): busca entidades y ejecuta acciones de navegación. */
export function CommandPalette({ open, setOpen, onAskAssistant }: { open: boolean; setOpen: (v: boolean) => void; onAskAssistant?: () => void }) {
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const { data: hits = [] } = useQuery({
    queryKey: ['search', dq],
    queryFn: () => api.get<Hit[]>(`/search?q=${encodeURIComponent(dq)}`),
    enabled: open && dq.trim().length >= 2,
  });

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const actions: NavItem[] = NAV.flatMap((s) => s.items).filter((i) => !i.perm || can(i.perm));
  const quick = [
    { label: 'Nuevo modelo', href: '/catalogo/nuevo', perm: 'catalog.create' as const },
    { label: 'Nuevo material', href: '/materiales/nuevo', perm: 'materials.create' as const },
    { label: 'Nuevo cliente / proveedor / taller', href: '/terceros/nuevo', perm: 'parties.create' as const },
    { label: 'Nuevo ajuste de stock', href: '/stock/documentos/nuevo?tipo=ADJUSTMENT', perm: 'inventory.adjust' as const },
    { label: 'Nueva transferencia', href: '/stock/documentos/nuevo?tipo=TRANSFER', perm: 'inventory.transfer' as const },
    { label: 'Cargar stock inicial', href: '/stock/documentos/nuevo?tipo=OPENING', perm: 'inventory.opening' as const },
  ].filter((a) => can(a.perm));

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <Command
        label="Buscador global"
        shouldFilter={false}
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted" aria-hidden />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder="Buscar clientes, modelos, SKU, CUIT, documentos o acciones…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border px-1.5 text-xs text-muted">Esc</kbd>
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="p-4 text-sm text-muted">Sin resultados para “{q}”.</Command.Empty>
          {hits.length > 0 && (
            <Command.Group heading="Resultados" className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
              {hits.map((h) => {
                const Icon = ICONS[h.type] ?? FileText;
                return (
                  <Command.Item
                    key={`${h.type}-${h.id}`}
                    value={`${h.type}-${h.id}`}
                    onSelect={() => go(h.href)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-text data-[selected=true]:bg-accent-soft"
                  >
                    <Icon className="size-4 text-muted" aria-hidden />
                    <span className="flex-1 truncate">{h.title}</span>
                    <span className="truncate text-xs text-muted">{h.subtitle}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}
          {onAskAssistant && (
            <Command.Group heading="Ayuda" className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
              <Command.Item
                value="asistente"
                onSelect={() => {
                  setOpen(false);
                  onAskAssistant();
                }}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-text data-[selected=true]:bg-accent-soft"
              >
                <Sparkles className="size-4 text-accent" aria-hidden />
                Preguntarle al asistente
                <kbd className="ml-auto rounded border border-border px-1.5 text-xs text-muted">Ctrl J</kbd>
              </Command.Item>
            </Command.Group>
          )}
          <Command.Group heading="Acciones" className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
            {[...quick, ...actions.map((a) => ({ label: `Ir a ${a.label}`, href: a.href }))]
              .filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase()))
              .slice(0, q ? 20 : 8)
              .map((a) => (
                <Command.Item
                  key={a.href + a.label}
                  value={a.label}
                  onSelect={() => go(a.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-text data-[selected=true]:bg-accent-soft"
                >
                  <ArrowRight className="size-4 text-muted" aria-hidden />
                  {a.label}
                </Command.Item>
              ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
