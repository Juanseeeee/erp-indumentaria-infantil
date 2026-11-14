'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { Badge, Button, Card, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface RolesResponse {
  catalog: { code: string; description: string; module: string }[];
  roles: { id: string; code: string; name: string; isSystem: boolean; permissions: string[]; userCount: number }[];
}

const MODULE_LABELS: Record<string, string> = {
  settings: 'Configuración',
  users: 'Usuarios',
  roles: 'Roles',
  audit: 'Auditoría',
  parties: 'Terceros',
  catalog: 'Catálogo',
  materials: 'Materiales',
  inventory: 'Inventario',
  costs: 'Costos (sensible)',
  data: 'Datos',
};

/** Matriz de roles × permisos. Edita roles existentes y crea roles personalizados. */
export default function RolesPage() {
  const qc = useQueryClient();
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RolesResponse>('/roles') });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ code: string; name: string; permissions: string[] } | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.put('/roles', body),
    onSuccess: () => {
      toast.success('Rol guardado.');
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      setDraft(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const byModule = useMemo(() => {
    const m = new Map<string, RolesResponse['catalog']>();
    data?.catalog.forEach((p) => m.set(p.module, [...(m.get(p.module) ?? []), p]));
    return [...m.entries()];
  }, [data]);

  if (isLoading || !data) return <Spinner />;
  const editable = can('roles.manage');
  const current = draft ?? (selected ? data.roles.find((r) => r.id === selected) : null);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Roles y permisos"
        description="Los permisos se validan siempre en el servidor. Ocultar un botón no alcanza: si el rol no tiene el permiso, la operación se rechaza."
        actions={editable && <Button onClick={() => setDraft({ code: '', name: '', permissions: [] })} data-tour="roles-nuevo">Nuevo rol</Button>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <Card tour="roles-lista">
          <ul>
            {data.roles.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    setSelected(r.id);
                    setDraft(null);
                  }}
                  className={`flex w-full items-center justify-between border-b border-border px-4 py-2 text-left text-sm last:border-0 hover:bg-surface-2 ${selected === r.id && !draft ? 'bg-accent-soft' : ''}`}
                >
                  <span>{r.name}</span>
                  <span className="text-xs text-muted">{r.userCount} usuarios</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4" tour="roles-editor">
          {!current ? (
            <p className="text-sm text-muted">Elegí un rol para ver sus permisos.</p>
          ) : (
            <RoleEditor
              key={draft ? 'new' : selected}
              role={current}
              isNew={!!draft}
              byModule={byModule}
              editable={editable && current.code !== 'SUPERADMIN'}
              saving={save.isPending}
              onSave={(r) => save.mutate(r)}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function RoleEditor({
  role,
  isNew,
  byModule,
  editable,
  saving,
  onSave,
}: {
  role: { code: string; name: string; permissions: string[]; isSystem?: boolean };
  isNew: boolean;
  byModule: [string, RolesResponse['catalog']][];
  editable: boolean;
  saving: boolean;
  onSave: (r: { code: string; name: string; permissions: string[] }) => void;
}) {
  const [name, setName] = useState(role.name);
  const [code, setCode] = useState(role.code);
  const [perms, setPerms] = useState(new Set(role.permissions));
  const toggle = (p: string) => setPerms((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set([...s, p])));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {isNew && (
          <Field label="Código" htmlFor="rcode" hint="Ej.: CORTE" tour="roles-codigo">
            <Input id="rcode" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-36" />
          </Field>
        )}
        <Field label="Nombre" htmlFor="rname" tour="roles-nombre">
          <Input id="rname" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} />
        </Field>
        {role.isSystem && <Badge tone="accent">Rol inicial</Badge>}
        {!editable && role.code === 'SUPERADMIN' && <Badge>No editable</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-tour="roles-permisos">
        {byModule.map(([module, list]) => (
          <fieldset key={module} className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">{MODULE_LABELS[module] ?? module}</legend>
            {list.map((p) => (
              <label key={p.code} className="flex items-start gap-2 py-1 text-sm">
                <input type="checkbox" className="mt-0.5" checked={perms.has(p.code)} disabled={!editable} onChange={() => toggle(p.code)} />
                <span>
                  {p.description}
                  <span className="block text-xs text-muted">{p.code}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {editable && (
        <Button className="mt-4" data-tour="roles-guardar" loading={saving} disabled={!name || !code} onClick={() => onSave({ code, name, permissions: [...perms] })}>
          Guardar rol
        </Button>
      )}
    </div>
  );
}
