'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { Button, Card, PageHeader } from '@/components/ui';

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export default function AccountPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id?: string) => api.del<{ revoked: number }>(id ? `/auth/sessions/${id}` : '/auth/sessions'),
    onSuccess: (r) => {
      toast.success(`${r.revoked} sesión(es) cerrada(s).`);
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Mi cuenta" description={`${me?.user.name} · ${me?.user.email}`} />
      <Card className="mb-4 p-4 text-sm" tour="cuenta-roles">
        <p className="font-medium">Roles</p>
        <p className="text-muted">{me?.roles.map((r) => r.name).join(', ')}</p>
      </Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Sesiones abiertas</h2>
        <Button size="sm" variant="secondary" data-tour="cuenta-cerrar-otras" loading={revoke.isPending} onClick={() => revoke.mutate(undefined)}>
          Cerrar todas las demás
        </Button>
      </div>
      <Card tour="cuenta-sesiones">
        <ul>
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-0">
              <span className="min-w-0">
                <span className="block truncate">{s.userAgent ?? 'Dispositivo desconocido'}</span>
                <span className="text-xs text-muted">
                  IP {s.ip ?? '—'} · iniciada {fmtDateTime(s.createdAt)} · última actividad {fmtDateTime(s.lastSeenAt)}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                Cerrar
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
