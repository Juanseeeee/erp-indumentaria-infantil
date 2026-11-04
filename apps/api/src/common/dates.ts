/**
 * Fechas de negocio. Las columnas DATE (vencimientos, entregas) se guardan como medianoche UTC
 * del día calendario. "Hoy" se define en la zona horaria del negocio, no en la del servidor ni en UTC:
 * a las 21:30 de Buenos Aires ya es mañana en UTC, y una entrega de hoy no está atrasada.
 */
export const BUSINESS_TZ = process.env.BUSINESS_TZ ?? 'America/Argentina/Buenos_Aires';

/** Día calendario de negocio (con desplazamiento en días) como Date a medianoche UTC. */
export function businessDate(offsetDays = 0, now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}
