/**
 * Generación de SKU de variantes. Patrón configurable con tokens {MODEL}, {COLOR}, {SIZE}.
 * Ejemplo: "{MODEL}-{COLOR}-{SIZE}" → "BODY-ML-ROS-3-6".
 */
export const DEFAULT_SKU_PATTERN = '{MODEL}-{COLOR}-{SIZE}';

export function normalizeCodePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildSku(pattern: string, parts: { model: string; color: string; size: string }): string {
  return pattern
    .replace('{MODEL}', normalizeCodePart(parts.model))
    .replace('{COLOR}', normalizeCodePart(parts.color))
    .replace('{SIZE}', normalizeCodePart(parts.size));
}

/** Dígito verificador EAN-13 para códigos internos (prefijo 2xx = uso interno). */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('Se esperan 12 dígitos');
  const total = first12
    .split('')
    .map(Number)
    .reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (total % 10)) % 10;
}

export function buildInternalEan13(sequence: number, prefix = '200'): string {
  const body = `${prefix}${String(sequence).padStart(12 - prefix.length, '0')}`;
  if (body.length !== 12) throw new RangeError('Secuencia demasiado grande para EAN-13');
  return `${body}${ean13CheckDigit(body)}`;
}
