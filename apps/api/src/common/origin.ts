/**
 * URL pública de la web (enlaces de los correos y CORS). WEB_ORIGIN si está configurada; en Vercel,
 * el dominio de producción del proyecto (variable de sistema VERCEL_PROJECT_PRODUCTION_URL).
 */
export function webOrigin(): string {
  const configured = process.env.WEB_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

/** Cookies solo por HTTPS: COOKIE_SECURE=true, o siempre en Vercel salvo COOKIE_SECURE=false. */
export function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return !!process.env.VERCEL;
}
