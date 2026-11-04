/**
 * Cliente HTTP. Todas las llamadas van a /api (proxy de Next → NestJS, mismo origen).
 * - Envía el token CSRF (cookie erp_csrf) en mutaciones.
 * - Agrega Idempotency-Key a los POST para que un reintento no duplique documentos.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { fields?: { path: string; message: string }[] } & Record<string, unknown>,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)erp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : '';
}

async function request<T>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  if (method === 'POST') headers['Idempotency-Key'] = opts.idempotencyKey ?? crypto.randomUUID();

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? 'Error de comunicación con el servidor.', data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Descarga un archivo generado por la API (Excel, PDF) con el nombre que propone el servidor. */
export async function download(path: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? 'No se pudo generar el archivo.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'reporte';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
