import { Dec, DecimalLike, DomainError, ErrorCodes, dec, roundMoney } from '@erp/domain-core';

/**
 * Reglas de tesorería sin infraestructura: ciclo de vida de cheques, arqueo, lectura de extractos
 * bancarios, sugerencias de conciliación, selección de cheques para pagar y flujo de fondos proyectado.
 */

// ─── Cheques ───

export type ChequeOwnership = 'THIRD' | 'OWN';
export type ChequeStatus = 'IN_PORTFOLIO' | 'DELIVERED' | 'DEPOSITED' | 'CREDITED' | 'REJECTED' | 'RETURNED' | 'ISSUED' | 'DEBITED' | 'VOIDED';
export type ChequeEvent = 'ENDORSE' | 'RECOVER' | 'DEPOSIT' | 'CREDIT' | 'REJECT' | 'RETURN' | 'DEBIT' | 'VOID';

/**
 * Terceros: cartera → endosado a un proveedor | depositado → acreditado; cualquiera de esos puede volver rechazado.
 * Devolver al cliente solo desde cartera; un endoso se recupera a cartera si se anula el pago. Propios: emitido → debitado | anulado (si lo devuelven sin cobrar).
 * Un cheque no cuenta como disponible hasta que está ACREDITADO.
 */
const TRANSITIONS: Record<ChequeOwnership, Partial<Record<ChequeStatus, Partial<Record<ChequeEvent, ChequeStatus>>>>> = {
  THIRD: {
    IN_PORTFOLIO: { ENDORSE: 'DELIVERED', DEPOSIT: 'DEPOSITED', REJECT: 'REJECTED', RETURN: 'RETURNED' },
    DEPOSITED: { CREDIT: 'CREDITED', REJECT: 'REJECTED' },
    DELIVERED: { REJECT: 'REJECTED', RECOVER: 'IN_PORTFOLIO' },
  },
  OWN: {
    ISSUED: { DEBIT: 'DEBITED', VOID: 'VOIDED' },
  },
};

export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  IN_PORTFOLIO: 'En cartera',
  DELIVERED: 'Endosado',
  DEPOSITED: 'Depositado',
  CREDITED: 'Acreditado',
  REJECTED: 'Rechazado',
  RETURNED: 'Devuelto al cliente',
  ISSUED: 'Emitido',
  DEBITED: 'Debitado',
  VOIDED: 'Anulado',
};

export function chequeTransition(ownership: ChequeOwnership, from: ChequeStatus, event: ChequeEvent): ChequeStatus {
  const to = TRANSITIONS[ownership][from]?.[event];
  if (!to) {
    throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `Un cheque ${ownership === 'OWN' ? 'propio' : 'de tercero'} ${CHEQUE_STATUS_LABELS[from].toLowerCase()} no admite esa operación.`);
  }
  return to;
}

export const allowedChequeEvents = (ownership: ChequeOwnership, from: ChequeStatus) => Object.keys(TRANSITIONS[ownership][from] ?? {}) as ChequeEvent[];

/** Validaciones de alta: plazo máximo de pago diferido (360 días) y CUIT del librador. */
export function assertChequeData(c: { issueDate?: Date | null; paymentDate: Date; amount: DecimalLike }) {
  if (dec(c.amount).lte(0)) throw new DomainError(ErrorCodes.VALIDACION, 'El importe del cheque debe ser mayor a cero.');
  if (c.issueDate) {
    const days = (c.paymentDate.getTime() - c.issueDate.getTime()) / 86_400_000;
    if (days < 0) throw new DomainError(ErrorCodes.VALIDACION, 'La fecha de pago no puede ser anterior a la de emisión.');
    if (days > 360) throw new DomainError(ErrorCodes.VALIDACION, 'Un cheque de pago diferido no puede superar los 360 días.');
  }
}

/** Plazo de presentación: 30 días corridos desde la fecha de pago (Ley 24.452, art. 25). */
export const CHEQUE_PRESENTATION_DAYS = 30;

/** Un cheque se deposita desde su fecha de pago y dentro del plazo de presentación. */
export function assertCanDeposit(paymentDate: Date, date: Date) {
  const days = Math.round((date.getTime() - paymentDate.getTime()) / 86_400_000);
  const ddmmyyyy = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
  if (days < 0) throw new DomainError(ErrorCodes.VALIDACION, `El cheque es de pago diferido: se puede depositar desde el ${ddmmyyyy(paymentDate)}.`);
  if (days > CHEQUE_PRESENTATION_DAYS) throw new DomainError(ErrorCodes.VALIDACION, `Venció el plazo de presentación (${CHEQUE_PRESENTATION_DAYS} días desde el ${ddmmyyyy(paymentDate)}).`);
}

/**
 * Sugerencia de cheques de cartera para pagar un importe: los que vencen primero, sin pasarse.
 * Si ninguno entra, propone el más chico (el excedente queda a favor con el proveedor).
 */
export function suggestCheques<T extends { id: string; amount: DecimalLike; paymentDate: Date | string }>(cheques: T[], target: DecimalLike): T[] {
  let pending = dec(target);
  const sorted = [...cheques].sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());
  const out: T[] = [];
  for (const c of sorted) {
    if (pending.lte(0)) break;
    if (dec(c.amount).lte(pending)) {
      out.push(c);
      pending = pending.minus(c.amount);
    }
  }
  if (!out.length && sorted.length && pending.gt(0)) out.push([...sorted].sort((a, b) => dec(a.amount).cmp(b.amount))[0]!);
  return out;
}

// ─── Medios de cobro y pago ───

export type CashAccountType = 'CASH_BOX' | 'BANK' | 'WALLET' | 'CARD_CLEARING' | 'CHEQUE_PORTFOLIO';

/**
 * En qué tipo de cuenta entra cada medio. Los cheques van siempre a la cartera; las retenciones son
 * crédito fiscal y no mueven fondos (lista vacía).
 */
const ACCOUNT_TYPES_BY_METHOD: Record<string, CashAccountType[]> = {
  CASH: ['CASH_BOX'],
  TRANSFER: ['BANK', 'WALLET'],
  CARD: ['CARD_CLEARING', 'BANK'],
  MERCADO_PAGO: ['WALLET'],
  CHEQUE: ['CHEQUE_PORTFOLIO'],
  ECHEQ: ['CHEQUE_PORTFOLIO'],
  RETENTION: [],
  // Pagos: endoso de cartera y cheques propios contra una cuenta bancaria.
  THIRD_CHEQUE: ['CHEQUE_PORTFOLIO'],
  OWN_CHEQUE: ['BANK'],
  OWN_ECHEQ: ['BANK'],
};

export function accountTypesFor(method: string): CashAccountType[] {
  const types = ACCOUNT_TYPES_BY_METHOD[method];
  if (!types) throw new DomainError(ErrorCodes.VALIDACION, `Medio de pago desconocido: ${method}.`);
  return types;
}

export function assertAccountForMethod(method: string, accountType: CashAccountType) {
  const types = accountTypesFor(method);
  if (!types.includes(accountType)) {
    throw new DomainError(ErrorCodes.VALIDACION, types.length ? `Ese medio no puede ingresar en una cuenta de ese tipo.` : 'Las retenciones no ingresan en una cuenta de tesorería.');
  }
}

// ─── Caja ───

export function cashClosing(expected: DecimalLike, counted: DecimalLike): { expected: Dec; counted: Dec; difference: Dec } {
  const e = roundMoney(expected);
  const c = roundMoney(counted);
  if (c.isNegative()) throw new DomainError(ErrorCodes.VALIDACION, 'El conteo no puede ser negativo.');
  return { expected: e, counted: c, difference: c.minus(e) };
}

/** Una caja arqueada no admite movimientos con fecha anterior al último arqueo. */
export function assertCashBoxOpen(operationDate: Date, lastClosingDate: Date | null, accountName: string) {
  if (lastClosingDate && operationDate.getTime() < lastClosingDate.getTime()) {
    const [y, m, d] = lastClosingDate.toISOString().slice(0, 10).split('-');
    throw new DomainError(ErrorCodes.VALIDACION, `La caja ${accountName} tiene un arqueo al ${d}/${m}/${y}: no admite movimientos con fecha anterior.`);
  }
}

/** El efectivo no puede quedar negativo: lo que sale de una caja tiene que estar en ella. */
export function assertCashAvailable(balance: DecimalLike, amount: DecimalLike, accountName: string) {
  const available = roundMoney(balance);
  const wanted = roundMoney(amount);
  if (available.lt(wanted)) {
    throw new DomainError(ErrorCodes.VALIDACION, `La caja ${accountName} tiene $ ${available.toFixed(2)} y se quieren sacar $ ${wanted.toFixed(2)}.`);
  }
}

// ─── Transferencias entre cuentas ───

/**
 * Entre cuentas de la misma moneda. La cartera de cheques solo se mueve depositando o endosando
 * cheques, y a "tarjetas a acreditar" solo entra lo cobrado con tarjeta (sale al acreditarse).
 * La comisión se descuenta de lo que llega al destino.
 */
export function assertTransfer(
  from: { id: string; type: CashAccountType; currency: string },
  to: { id: string; type: CashAccountType; currency: string },
  amount: DecimalLike,
  fee: DecimalLike = 0,
): { amount: Dec; fee: Dec; received: Dec } {
  if (from.id === to.id) throw new DomainError(ErrorCodes.VALIDACION, 'La cuenta de origen y la de destino son la misma.');
  if (from.type === 'CHEQUE_PORTFOLIO' || to.type === 'CHEQUE_PORTFOLIO') {
    throw new DomainError(ErrorCodes.VALIDACION, 'Los cheques de cartera se depositan o se endosan; no se transfieren.');
  }
  if (to.type === 'CARD_CLEARING') throw new DomainError(ErrorCodes.VALIDACION, 'A tarjetas a acreditar solo entran cobros con tarjeta.');
  if (from.currency !== to.currency) throw new DomainError(ErrorCodes.VALIDACION, 'Las cuentas tienen distinta moneda.');
  const a = roundMoney(amount);
  const f = roundMoney(fee);
  if (!a.gt(0)) throw new DomainError(ErrorCodes.VALIDACION, 'El importe debe ser mayor a cero.');
  if (f.isNegative() || !f.lt(a)) throw new DomainError(ErrorCodes.VALIDACION, 'La comisión debe ser menor al importe transferido.');
  return { amount: a, fee: f, received: a.minus(f) };
}

// ─── Extractos bancarios ───

export interface StatementRow {
  date: Date;
  description: string;
  amount: Dec;
  reference: string | null;
}

/** "1.234,56" | "-1234.56" | "1,234.56" | "(1.234,56)" → Decimal. */
export function parseAmountAR(raw: string): Dec {
  let s = raw.trim().replace(/\$|\s/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new DomainError(ErrorCodes.VALIDACION, `Importe ilegible: "${raw}".`);
  const v = roundMoney(s);
  return negative ? v.negated() : v;
}

/** "29/10/2026", "29-10-26" o "2026-10-29" → medianoche UTC del día. */
export function parseDateAR(raw: string): Date {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    const d = new Date(Date.UTC(y, +m[2]! - 1, +m[1]!));
    if (d.getUTCMonth() === +m[2]! - 1) return d;
  }
  throw new DomainError(ErrorCodes.VALIDACION, `Fecha ilegible: "${raw}".`);
}

/**
 * Lee un extracto en CSV (separador ; , o tab). Columnas reconocidas por encabezado:
 * fecha, descripción/concepto, importe (o débito y crédito por separado), referencia/comprobante.
 */
export function parseStatementCsv(text: string): { rows: StatementRow[]; errors: { line: number; message: string }[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new DomainError(ErrorCodes.VALIDACION, 'El archivo no tiene movimientos.');
  const sep = [';', '\t', ','].find((s) => lines[0]!.includes(s)) ?? ';';
  const norm = (h: string) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const header = lines[0]!.split(sep).map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col('fecha');
  const iDesc = col('descrip', 'concepto', 'detalle');
  const iAmount = col('importe', 'monto');
  const iDebit = col('debito', 'debe');
  const iCredit = col('credito', 'haber');
  const iRef = col('referencia', 'comprobante', 'nro');
  if (iDate < 0 || (iAmount < 0 && (iDebit < 0 || iCredit < 0))) {
    throw new DomainError(ErrorCodes.VALIDACION, 'El extracto necesita columnas "Fecha" e "Importe" (o "Débito" y "Crédito").');
  }
  const rows: StatementRow[] = [];
  const errors: { line: number; message: string }[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    try {
      let amount: Dec;
      if (iAmount >= 0) amount = parseAmountAR(cells[iAmount] ?? '');
      else {
        const debit = cells[iDebit] ? parseAmountAR(cells[iDebit]!).abs() : dec(0);
        const credit = cells[iCredit] ? parseAmountAR(cells[iCredit]!).abs() : dec(0);
        amount = credit.minus(debit);
      }
      if (amount.isZero()) return;
      rows.push({ date: parseDateAR(cells[iDate] ?? ''), description: iDesc >= 0 ? (cells[iDesc] ?? '') : '', amount, reference: iRef >= 0 ? cells[iRef] || null : null });
    } catch (e) {
      errors.push({ line: i + 2, message: e instanceof Error ? e.message : String(e) });
    }
  });
  return { rows, errors };
}

/** Clave para detectar líneas ya importadas (la misma línea repetida en un archivo lleva su número de aparición). */
export function statementKey(r: StatementRow, occurrence: number) {
  return [r.date.toISOString().slice(0, 10), r.amount.toFixed(2), r.description.toLowerCase().replace(/\s+/g, ' ').trim(), r.reference ?? '', occurrence].join('|');
}

/** Movimientos candidatos para conciliar una línea: mismo importe, fecha cercana; primero los más próximos. */
export function matchCandidates<T extends { id: string; amount: DecimalLike; valueDate: Date | string; reference?: string | null }>(
  line: { date: Date; amount: DecimalLike; reference?: string | null },
  movements: T[],
  toleranceDays = 5,
): T[] {
  const day = 86_400_000;
  return movements
    .filter((m) => dec(m.amount).eq(line.amount) && Math.abs(new Date(m.valueDate).getTime() - line.date.getTime()) <= toleranceDays * day)
    .sort((a, b) => {
      const ref = (m: T) => (line.reference && m.reference && m.reference.includes(line.reference) ? 0 : 1);
      return ref(a) - ref(b) || Math.abs(new Date(a.valueDate).getTime() - line.date.getTime()) - Math.abs(new Date(b.valueDate).getTime() - line.date.getTime());
    });
}

/**
 * Conciliación automática prudente: una línea se concilia sola solo si tiene un único candidato y
 * ese movimiento no es candidato de ninguna otra línea. Lo ambiguo queda para decidir a mano.
 */
export function pickAutoMatches<L extends { id: string }, M extends { id: string }>(
  lines: L[],
  candidatesOf: (line: L) => M[],
): { lineId: string; movementId: string }[] {
  const byLine = new Map(lines.map((l) => [l.id, candidatesOf(l).map((m) => m.id)]));
  const claims = new Map<string, number>();
  for (const ids of byLine.values()) for (const id of ids) claims.set(id, (claims.get(id) ?? 0) + 1);
  return [...byLine.entries()]
    .filter(([, ids]) => ids.length === 1 && claims.get(ids[0]!) === 1)
    .map(([lineId, ids]) => ({ lineId, movementId: ids[0]! }));
}

/** Importe con signo de un movimiento de tesorería, como lo muestra el banco (ingreso +, egreso −). */
export const signedAmount = (direction: 'IN' | 'OUT', amount: DecimalLike): Dec => (direction === 'IN' ? roundMoney(amount) : roundMoney(amount).negated());

// ─── Flujo de fondos proyectado ───

export interface CashflowItem {
  date: Date;
  /** Positivo = ingreso esperado. */
  amount: DecimalLike;
  kind: string;
}

/**
 * Proyección semanal desde `from`: saldo inicial + movimientos esperados por semana (lunes a domingo).
 * Lo vencido antes de `from` se agrupa en la primera semana (es lo que debería cobrarse/pagarse ya).
 */
export interface CashflowBucket {
  from: Date;
  to: Date;
  inflow: Dec;
  outflow: Dec;
  byKind: Record<string, Dec>;
  balance: Dec;
}

export function projectCashflow(opening: DecimalLike, items: CashflowItem[], from: Date, weeks: number): CashflowBucket[] {
  const day = 86_400_000;
  const dow = (from.getUTCDay() + 6) % 7;
  const start = new Date(from.getTime() - dow * day);
  const buckets: CashflowBucket[] = Array.from({ length: weeks }, (_, i) => ({
    from: new Date(start.getTime() + i * 7 * day),
    to: new Date(start.getTime() + (i * 7 + 6) * day),
    inflow: dec(0),
    outflow: dec(0),
    byKind: {} as Record<string, Dec>,
    balance: dec(0),
  }));
  for (const it of items) {
    const idx = Math.max(0, Math.floor((new Date(it.date).getTime() - start.getTime()) / (7 * day)));
    const b = buckets[idx];
    if (!b) continue;
    const a = dec(it.amount);
    if (a.gte(0)) b.inflow = b.inflow.plus(a);
    else b.outflow = b.outflow.plus(a);
    b.byKind[it.kind] = (b.byKind[it.kind] ?? dec(0)).plus(a);
  }
  let running = dec(opening);
  for (const b of buckets) {
    running = running.plus(b.inflow).plus(b.outflow);
    b.balance = running;
  }
  return buckets;
}

// ─── Cierre de período ───

/** Una fecha está bloqueada si es igual o anterior al último día cerrado. */
export function assertPeriodOpen(date: Date, lockedUntil: string | null) {
  if (!lockedUntil) return;
  if (date.toISOString().slice(0, 10) <= lockedUntil) {
    const [y, m, d] = lockedUntil.split('-');
    throw new DomainError(ErrorCodes.VALIDACION, `El período está cerrado hasta el ${d}/${m}/${y}: no se registran operaciones con fecha anterior.`, 409);
  }
}

const fmtISO = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Mover la fecha de cierre. Cerrar solo avanza y nunca alcanza el día de hoy (el período en curso
 * sigue abierto); reabrir solo retrocede (o quita el cierre) y exige motivo.
 */
export function assertPeriodMove(mode: 'CLOSE' | 'REOPEN', current: string | null, next: string | null, today: string) {
  if (mode === 'CLOSE') {
    if (!next) throw new DomainError(ErrorCodes.VALIDACION, 'Indicá hasta qué día se cierra.');
    if (next >= today) throw new DomainError(ErrorCodes.VALIDACION, `Solo se puede cerrar hasta ayer (${fmtISO(today)} sigue abierto).`);
    if (current && next <= current) throw new DomainError(ErrorCodes.VALIDACION, `El período ya está cerrado hasta el ${fmtISO(current)}. Para retroceder, reabrilo.`);
    return;
  }
  if (!current) throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, 'No hay ningún período cerrado.');
  if (next && next >= current) throw new DomainError(ErrorCodes.VALIDACION, `Para reabrir, la nueva fecha tiene que ser anterior al ${fmtISO(current)}.`);
}

// ─── Gastos recurrentes ───

export interface RecurringTemplate {
  id: string;
  dayOfMonth: number;
  startsOn: Date;
}

/**
 * Meses de cada plantilla que faltan registrar, desde su inicio (como mucho 12 meses atrás) hasta
 * `until`, con la fecha en que vence cada uno. Lo ya registrado (`done`: "id|AAAA-MM") no aparece.
 */
export function pendingRecurring(templates: RecurringTemplate[], done: Set<string>, today: Date, until: Date): { templateId: string; period: string; dueDate: Date }[] {
  const out: { templateId: string; period: string; dueDate: Date }[] = [];
  const floor = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 12, 1);
  for (const t of templates) {
    const start = Math.max(Date.UTC(t.startsOn.getUTCFullYear(), t.startsOn.getUTCMonth(), 1), floor);
    for (let d = new Date(start); ; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const dueDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), t.dayOfMonth));
      if (dueDate > until) break;
      if (dueDate < t.startsOn) continue;
      const period = dueDate.toISOString().slice(0, 7);
      if (!done.has(`${t.id}|${period}`)) out.push({ templateId: t.id, period, dueDate });
    }
  }
  return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}
