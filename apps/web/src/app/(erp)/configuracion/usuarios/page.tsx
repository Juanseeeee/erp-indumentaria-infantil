'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { Badge, Button, Card, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface UserRow {
  id: string;
  email: string;
  name: string;
  membershipActive: boolean;
  lastLoginAt: string | null;
  roles: { id: string; code: string; name: string }[];
}
interface RoleRow {
  id: string;
  code: string;
  name: string;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const can = useCan();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: RoleRow[] }>('/roles') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: (body: object) => api.post('/users', body),
    onSuccess: () => {
      toast.success('Usuario creado.');
      setCreating(false);
      setRoleIds([]);
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.details?.fields ? e.details.fields.map((f) => f.message).join(' · ') : e.message),
  });
  const setRoles = useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) => api.put(`/users/${id}/roles`, { roleIds }),
    onSuccess: () => {
      toast.success('Roles actualizados.');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (u: UserRow) => api.post(`/users/${u.id}/${u.membershipActive ? 'deactivate' : 'activate'}`),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });

  if (users.isLoading) return <Spinner />;
  const manage = can('users.manage');

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Usuarios"
        description="Al desactivar un usuario se cierran todas sus sesiones."
        actions={manage && !creating && <Button onClick={() => setCreating(true)} data-tour="usuarios-nuevo">Nuevo usuario</Button>}
      />
      {creating && (
        <Card className="mb-4 p-4" tour="usuarios-form">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              create.mutate({ name: f.get('name'), email: f.get('email'), password: f.get('password'), roleIds });
            }}
          >
            <Field label="Nombre" htmlFor="uname"><Input id="uname" name="name" required /></Field>
            <Field label="Email" htmlFor="uemail"><Input id="uemail" name="email" type="email" required /></Field>
            <Field label="Contraseña inicial" htmlFor="upw" tour="usuarios-contrasena" hint="Mínimo 10 caracteres, con letras y números.">
              <Input id="upw" name="password" type="password" autoComplete="new-password" required />
            </Field>
            <fieldset className="sm:col-span-3" data-tour="usuarios-roles">
              <legend className="mb-2 text-sm font-medium">Roles</legend>
              <div className="flex flex-wrap gap-2">
                {roles.data?.roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={roleIds.includes(r.id)}
                      onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" loading={create.isPending} disabled={!roleIds.length} data-tour="usuarios-crear">Crear usuario</Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
            </div>
          </form>
        </Card>
      )}
      <Card className="overflow-x-auto" tour="usuarios-tabla">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
              <th className="px-3 py-2 text-left">Usuario</th>
              <th className="px-3 py-2 text-left" data-tour="usuarios-col-roles">Roles</th>
              <th className="px-3 py-2 text-left" data-tour="usuarios-col-ingreso">Último ingreso</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <p className="font-medium">
                    {u.name} {!u.membershipActive && <Badge>Inactivo</Badge>}
                  </p>
                  <p className="text-xs text-muted">{u.email}</p>
                </td>
                <td className="px-3 py-2">
                  {manage ? (
                    <select
                      multiple
                      aria-label={`Roles de ${u.name}`}
                      className="min-w-48 rounded-md border border-border bg-surface p-1 text-sm"
                      value={u.roles.map((r) => r.id)}
                      onChange={(e) => {
                        const ids = Array.from(e.target.selectedOptions).map((o) => o.value);
                        if (ids.length) setRoles.mutate({ id: u.id, roleIds: ids });
                      }}
                    >
                      {roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  ) : (
                    u.roles.map((r) => r.name).join(', ')
                  )}
                </td>
                <td className="px-3 py-2 text-muted">{fmtDateTime(u.lastLoginAt)}</td>
                <td className="px-3 py-2 text-right">
                  {manage && u.id !== me?.user.id && (
                    <Button size="sm" variant="secondary" onClick={() => toggle.mutate(u)}>
                      {u.membershipActive ? 'Desactivar' : 'Reactivar'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
