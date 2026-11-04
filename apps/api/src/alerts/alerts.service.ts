import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import {
  ALERT_PRIORITY_LABELS,
  ALERT_RULES,
  findAlertRule,
  type AlertPriority,
  type AlertQuery,
  type AlertRuleDefinition,
  type AlertRuleUpdateInput,
} from '@erp/contracts';
import type { Tx } from '../prisma/prisma.service';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { AuditService } from '../common/common.service';
import { BUSINESS_TZ, businessDate } from '../common/dates';

/** Condición detectada: una alerta por operación afectada (dedupKey). */
export interface Candidate {
  key: string;
  title: string;
  detail: string | null;
  link: string | null;
}

export interface RuleConfig {
  code: string;
  label: string;
  enabled: boolean;
  priority: AlertPriority;
  roles: string[];
  userIds: string[];
  sendEmail: boolean;
  days: number | null;
}

const MAX_PER_RULE = 500;
const fmtMoney = (v: Prisma.Decimal.Value) => `$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;
const fmtQty = (v: Prisma.Decimal.Value) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(Number(v));
const dmy = (d: Date) => `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}/${d.toISOString().slice(0, 4)}`;
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * Alertas (RF §13). Cada regla del catálogo tiene un detector que mira el estado actual de los datos.
 * Evaluar es idempotente: crea las alertas nuevas, actualiza las vigentes y resuelve solas las que ya no
 * se cumplen. Las nuevas se avisan por correo en un resumen por destinatario (outbox).
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  // ─── Reglas ───

  private async rulesInTx(tx: Tx): Promise<RuleConfig[]> {
    const rows = await tx.alertRule.findMany();
    return (ALERT_RULES as readonly AlertRuleDefinition[]).map((def) => {
      const row = rows.find((r) => r.code === def.code);
      return {
        code: def.code,
        label: def.label,
        enabled: row?.enabled ?? true,
        priority: (row?.priority ?? def.priority) as AlertPriority,
        roles: row?.roles ?? [...def.roles],
        userIds: row?.userIds ?? [],
        sendEmail: row?.sendEmail ?? true,
        days: def.days ? (row?.days ?? def.days.default) : null,
      };
    });
  }

  rules(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const [rules, roles] = await Promise.all([this.rulesInTx(tx), tx.role.findMany({ select: { code: true, name: true }, orderBy: { name: 'asc' } })]);
      const open = await tx.alert.groupBy({ by: ['code'], where: { status: { not: 'RESOLVED' } }, _count: true });
      return {
        rules: rules.map((r) => ({ ...r, definition: findAlertRule(r.code), open: open.find((o) => o.code === r.code)?._count ?? 0 })),
        roles,
        emailConfigured: !!process.env.SMTP_URL,
      };
    });
  }

  updateRule(ctx: RequestContext, code: string, input: AlertRuleUpdateInput) {
    const def = findAlertRule(code);
    if (!def) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La regla no existe.', 404);
    if (def.days && (input.days == null || input.days < def.days.min || input.days > def.days.max))
      throw new DomainError(ErrorCodes.VALIDACION, `${def.days.label}: entre ${def.days.min} y ${def.days.max}.`);
    if (input.enabled && !input.roles.length && !input.userIds.length) throw new DomainError(ErrorCodes.VALIDACION, 'Elegí al menos un rol o usuario que reciba la alerta.');
    return this.uow.run(
      ctx,
      async (tx) => {
        const known = new Set((await tx.role.findMany({ select: { code: true } })).map((r) => r.code));
        const unknown = input.roles.filter((r) => !known.has(r));
        if (unknown.length) throw new DomainError(ErrorCodes.VALIDACION, `Roles inexistentes: ${unknown.join(', ')}.`);
        const data = { enabled: input.enabled, priority: input.priority, roles: input.roles, userIds: input.userIds, sendEmail: input.sendEmail, days: def.days ? input.days : null, updatedAt: new Date(), updatedBy: ctx.userId };
        const before = await tx.alertRule.findUnique({ where: { companyId_code: { companyId: ctx.companyId, code } } });
        const rule = await tx.alertRule.upsert({ where: { companyId_code: { companyId: ctx.companyId, code } }, create: { companyId: ctx.companyId, code, ...data }, update: data });
        await this.audit.log(tx, ctx, { entity: 'alert_rule', entityId: code, action: before ? 'update' : 'create', diff: { before, after: data } });
        return rule;
      },
      { idempotent: true },
    );
  }

  // ─── Consulta y estado ───

  /** Códigos de regla que recibe el usuario (por rol o explícitamente). */
  private async myCodes(tx: Tx, ctx: RequestContext) {
    const roles = (await tx.userRole.findMany({ where: { userId: ctx.userId }, select: { role: { select: { code: true } } } })).map((r) => r.role.code);
    return (await this.rulesInTx(tx)).filter((r) => r.userIds.includes(ctx.userId) || r.roles.some((code) => roles.includes(code))).map((r) => r.code);
  }

  list(ctx: RequestContext, q: AlertQuery) {
    if (q.scope === 'all' && !ctx.permissions.has('alerts.manage')) throw new DomainError(ErrorCodes.SIN_PERMISO, 'No tenés permiso para ver las alertas de todos.', 403);
    return this.uow.run(ctx, async (tx) => {
      const where: Prisma.AlertWhereInput = {
        ...(q.status === 'OPEN' ? { status: { not: 'RESOLVED' } } : { status: q.status }),
        ...(q.scope === 'mine' ? { code: { in: await this.myCodes(tx, ctx) } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.alert.count({ where }),
        tx.alert.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      const userIds = [...new Set(rows.flatMap((r) => [r.seenBy, r.resolvedBy]).filter((x): x is string => !!x))];
      const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
      const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);
      const sorted = [...rows].sort((a, b) => (q.status === 'RESOLVED' ? 0 : (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)));
      return {
        total,
        rows: sorted.map((r) => ({ ...r, ruleLabel: findAlertRule(r.code)?.label ?? r.code, seenByName: name(r.seenBy), resolvedByName: name(r.resolvedBy) })),
      };
    });
  }

  /** Para la campana: nuevas y abiertas del usuario. */
  summary(ctx: RequestContext) {
    return this.uow.run(ctx, async (tx) => {
      const codes = await this.myCodes(tx, ctx);
      const [fresh, open, critical] = await Promise.all([
        tx.alert.count({ where: { code: { in: codes }, status: 'NEW' } }),
        tx.alert.count({ where: { code: { in: codes }, status: { not: 'RESOLVED' } } }),
        tx.alert.count({ where: { code: { in: codes }, status: { not: 'RESOLVED' }, priority: 'CRITICAL' } }),
      ]);
      return { new: fresh, open, critical };
    });
  }

  private async visibleAlert(tx: Tx, ctx: RequestContext, id: string) {
    const alert = await tx.alert.findUnique({ where: { id } });
    if (!alert) throw new DomainError(ErrorCodes.NO_ENCONTRADO, 'La alerta no existe.', 404);
    if (!ctx.permissions.has('alerts.manage') && !(await this.myCodes(tx, ctx)).includes(alert.code)) throw new DomainError(ErrorCodes.SIN_PERMISO, 'Esta alerta no está dirigida a vos.', 403);
    return alert;
  }

  markSeen(ctx: RequestContext, id: string) {
    return this.uow.run(ctx, async (tx) => {
      const alert = await this.visibleAlert(tx, ctx, id);
      if (alert.status !== 'NEW') return alert;
      return tx.alert.update({ where: { id }, data: { status: 'SEEN', seenAt: new Date(), seenBy: ctx.userId } });
    });
  }

  /** Resolver a mano: no vuelve a aparecer mientras la condición siga vigente (ver cleared_at). */
  resolve(ctx: RequestContext, id: string, note: string | null | undefined) {
    return this.uow.run(
      ctx,
      async (tx) => {
        const alert = await this.visibleAlert(tx, ctx, id);
        if (alert.status === 'RESOLVED') throw new DomainError(ErrorCodes.VALIDACION, 'La alerta ya está resuelta.');
        const now = new Date();
        const updated = await tx.alert.update({
          where: { id },
          data: { status: 'RESOLVED', resolvedAt: now, resolvedBy: ctx.userId, resolutionNote: note || null, seenAt: alert.seenAt ?? now, seenBy: alert.seenBy ?? ctx.userId },
        });
        await this.audit.log(tx, ctx, { entity: 'alert', entityId: id, action: 'resolve', diff: { code: alert.code, title: alert.title }, reason: note || null });
        return updated;
      },
      { idempotent: true },
    );
  }

  // ─── Evaluación ───

  /**
   * Corre todas las reglas de la empresa. Un candado por empresa evita que dos evaluaciones (programada y
   * manual) se pisen: la segunda devuelve `skipped`.
   */
  evaluate(ctx: Pick<RequestContext, 'companyId' | 'userId'>) {
    return this.uow.run(ctx, async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`alerts:${ctx.companyId}`})) AS ok`;
      if (!lock?.ok) return { skipped: true, created: 0, resolved: 0, open: 0, emails: 0 };
      const now = new Date();
      const rules = await this.rulesInTx(tx);
      const fresh: { rule: RuleConfig; alerts: { id: string; title: string; detail: string | null; link: string | null; priority: string }[] }[] = [];
      let created = 0;
      let resolved = 0;
      for (const rule of rules) {
        const candidates = rule.enabled ? (await this.detect(tx, rule)).slice(0, MAX_PER_RULE) : [];
        const existing = await tx.alert.findMany({ where: { code: rule.code, clearedAt: null } });
        const byKey = new Map(existing.map((a) => [a.dedupKey, a]));
        const keys = new Set(candidates.map((c) => c.key));

        const toCreate = candidates.filter((c) => !byKey.has(c.key)).map((c) => ({ id: randomUUID(), companyId: ctx.companyId, code: rule.code, dedupKey: c.key, priority: rule.priority, title: c.title, detail: c.detail, link: c.link }));
        if (toCreate.length) await tx.alert.createMany({ data: toCreate });
        created += toCreate.length;
        if (toCreate.length) fresh.push({ rule, alerts: toCreate });

        // Vigentes: se actualiza el texto si cambió (importes, días de atraso) y la última detección.
        const still = candidates.filter((c) => byKey.has(c.key));
        for (const c of still) {
          const a = byKey.get(c.key)!;
          if (a.title !== c.title || a.detail !== c.detail || a.link !== c.link) await tx.alert.update({ where: { id: a.id }, data: { title: c.title, detail: c.detail, link: c.link } });
        }
        if (still.length) await tx.alert.updateMany({ where: { id: { in: still.map((c) => byKey.get(c.key)!.id) } }, data: { lastDetectedAt: now } });

        // La condición desapareció (o la regla se desactivó): se resuelven solas.
        const gone = existing.filter((a) => !keys.has(a.dedupKey));
        if (gone.length) {
          const open = gone.filter((a) => a.status !== 'RESOLVED').map((a) => a.id);
          if (open.length) {
            await tx.alert.updateMany({
              where: { id: { in: open } },
              data: { status: 'RESOLVED', resolvedAt: now, clearedAt: now, resolutionNote: rule.enabled ? 'Se resolvió sola: la condición ya no se cumple.' : 'Regla desactivada.' },
            });
            resolved += open.length;
          }
          const snoozed = gone.filter((a) => a.status === 'RESOLVED').map((a) => a.id);
          if (snoozed.length) await tx.alert.updateMany({ where: { id: { in: snoozed } }, data: { clearedAt: now } });
        }
      }
      const emails = await this.enqueueDigests(tx, ctx.companyId, fresh.filter((f) => f.rule.sendEmail));
      const open = await tx.alert.count({ where: { status: { not: 'RESOLVED' } } });
      return { skipped: false, created, resolved, open, emails };
    });
  }

  /** Un correo por destinatario con todas sus alertas nuevas, ordenadas por prioridad. */
  private async enqueueDigests(tx: Tx, companyId: string, fresh: { rule: RuleConfig; alerts: { title: string; detail: string | null; link: string | null; priority: string }[] }[]) {
    if (!fresh.length) return 0;
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { legalName: true, tradeName: true } });
    const companyName = company?.tradeName ?? company?.legalName ?? 'la empresa';
    const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
    const inbox = new Map<string, { email: string; name: string; items: { rule: string; title: string; detail: string | null; link: string | null; priority: string }[] }>();
    for (const f of fresh) {
      for (const u of await this.recipients(tx, companyId, f.rule)) {
        const entry = inbox.get(u.id) ?? { email: u.email, name: u.name, items: [] };
        entry.items.push(...f.alerts.map((a) => ({ ...a, rule: f.rule.label })));
        inbox.set(u.id, entry);
      }
    }
    const rows = [...inbox.values()].map((m) => {
      const items = m.items.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
      const n = items.length;
      const subject = `${n} ${n === 1 ? 'alerta nueva' : 'alertas nuevas'} en ${companyName}`;
      const line = (i: (typeof items)[number]) => `[${ALERT_PRIORITY_LABELS[i.priority as AlertPriority] ?? i.priority}] ${i.rule}: ${i.title}${i.detail ? ` — ${i.detail}` : ''}${i.link ? `\n  ${origin}${i.link}` : ''}`;
      const text = `Hola ${m.name}:\n\nHay ${n === 1 ? 'una alerta nueva' : `${n} alertas nuevas`} para vos.\n\n${items.map(line).join('\n\n')}\n\nTodas tus alertas: ${origin}/alertas\n`;
      const html = `<p>Hola ${escape(m.name)}:</p><p>Hay ${n === 1 ? 'una alerta nueva' : `${n} alertas nuevas`} para vos.</p><ul>${items
        .map(
          (i) =>
            `<li><strong>${escape(ALERT_PRIORITY_LABELS[i.priority as AlertPriority] ?? i.priority)}</strong> · ${escape(i.rule)}: ${i.link ? `<a href="${escape(origin + i.link)}">${escape(i.title)}</a>` : escape(i.title)}${i.detail ? `<br><span style="color:#555">${escape(i.detail)}</span>` : ''}</li>`,
        )
        .join('')}</ul><p><a href="${escape(origin)}/alertas">Ver todas tus alertas</a></p>`;
      return { companyId, toEmail: m.email, toName: m.name, subject, textBody: text, htmlBody: html, kind: 'ALERT_DIGEST' };
    });
    if (rows.length) await tx.emailOutbox.createMany({ data: rows });
    return rows.length;
  }

  /** Usuarios activos de la empresa con alguno de los roles de la regla, o elegidos explícitamente. */
  private recipients(tx: Tx, companyId: string, rule: RuleConfig) {
    return tx.$queryRaw<{ id: string; email: string; name: string }[]>`
      SELECT u.id, u.email, u.name
      FROM company_users cu JOIN users u ON u.id = cu.user_id
      WHERE cu.company_id = ${companyId}::uuid AND cu.is_active AND u.is_active
        AND (cu.user_id = ANY(${rule.userIds}::uuid[])
             OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = cu.user_id AND r.code = ANY(${rule.roles}::text[])))
      ORDER BY u.name`;
  }

  // ─── Detectores ───

  private async detect(tx: Tx, rule: RuleConfig): Promise<Candidate[]> {
    const today = businessDate();
    const days = rule.days ?? 0;
    switch (rule.code) {
      case 'STOCK_MIN': {
        const rows = await tx.$queryRaw<{ id: string; sku: string; name: string; on_hand: string; min: string }[]>`
          SELECT i.id, i.sku, i.name, COALESCE(SUM(b.on_hand), 0)::text AS on_hand, i.min_stock::text AS min
          FROM items i LEFT JOIN stock_balances b ON b.item_id = i.id AND b.warehouse_id IN (SELECT id FROM warehouses WHERE type = 'OWN')
          WHERE i.is_active AND i.min_stock IS NOT NULL
          GROUP BY i.id HAVING COALESCE(SUM(b.on_hand), 0) < i.min_stock ORDER BY i.sku`;
        return rows.map((r) => ({ key: r.id, title: `${r.sku} · ${r.name}`, detail: `Stock ${fmtQty(r.on_hand)} con mínimo ${fmtQty(r.min)}.`, link: `/stock/${r.id}` }));
      }
      case 'MATERIAL_SHORTAGE': {
        const rows = await tx.$queryRaw<{ id: string; order_id: string; number: string; sku: string; name: string; missing: string }[]>`
          SELECT r.id, o.id AS order_id, o.number, i.sku, i.name,
                 ((r.required_qty - r.issued_qty) - COALESCE((SELECT SUM(b.on_hand) FROM stock_balances b WHERE b.item_id = r.material_item_id AND b.warehouse_id = o.materials_warehouse_id), 0))::text AS missing
          FROM production_requirements r JOIN production_orders o ON o.id = r.order_id JOIN items i ON i.id = r.material_item_id
          WHERE o.status IN ('RELEASED', 'IN_PROGRESS') AND r.required_qty > r.issued_qty`;
        return rows
          .filter((r) => new Prisma.Decimal(r.missing).gt(0))
          .map((r) => ({ key: r.id, title: `${r.number}: falta ${r.name}`, detail: `Faltan ${fmtQty(r.missing)} de ${r.sku} en el depósito de materiales.`, link: `/produccion/ordenes/${r.order_id}` }));
      }
      case 'PRODUCTION_LATE': {
        const rows = await tx.productionOrder.findMany({ where: { status: { in: ['RELEASED', 'IN_PROGRESS'] }, dueDate: { lt: today } }, select: { id: true, number: true, dueDate: true }, orderBy: { dueDate: 'asc' } });
        return rows.map((o) => ({ key: o.id, title: `${o.number} atrasada`, detail: `Vencía el ${dmy(o.dueDate!)} (${Math.round((today.getTime() - o.dueDate!.getTime()) / 86_400_000)} días de atraso).`, link: `/produccion/ordenes/${o.id}` }));
      }
      case 'ORDER_NOT_PREPARED': {
        const rows = await tx.$queryRaw<{ id: string; number: string; customer: string; confirmed: Date }[]>`
          SELECT o.id, o.number, p.legal_name AS customer, (o.confirmed_at AT TIME ZONE ${BUSINESS_TZ})::date AS confirmed
          FROM sales_orders o JOIN parties p ON p.id = o.customer_id
          WHERE o.status = 'CONFIRMED' AND o.confirmed_at IS NOT NULL
            AND (o.confirmed_at AT TIME ZONE ${BUSINESS_TZ})::date <= ${today}::date - ${days}::int
            AND NOT EXISTS (SELECT 1 FROM delivery_notes d WHERE d.order_id = o.id AND d.status = 'ISSUED')
          ORDER BY o.confirmed_at`;
        return rows.map((o) => ({ key: o.id, title: `Pedido ${o.number} sin preparar`, detail: `${o.customer} · confirmado el ${dmy(o.confirmed)}.`, link: `/ventas/pedidos/${o.id}` }));
      }
      case 'CUSTOMER_OVERDUE': {
        const rows = await tx.$queryRaw<{ id: string; name: string; amount: string; oldest: Date; count: bigint }[]>`
          SELECT p.id, p.legal_name AS name, SUM(e.open_amount)::text AS amount, MIN(e.due_date) AS oldest, COUNT(*) AS count
          FROM account_entries e JOIN parties p ON p.id = e.party_id
          WHERE e.account_type = 'RECEIVABLE' AND e.open_amount > 0 AND e.due_date < ${today}::date - ${days}::int
          GROUP BY p.id, p.legal_name ORDER BY SUM(e.open_amount) DESC`;
        return rows.map((r) => ({
          key: r.id,
          title: `${r.name}: ${fmtMoney(r.amount)} vencidos`,
          detail: `${Number(r.count)} ${Number(r.count) === 1 ? 'comprobante' : 'comprobantes'} vencidos hace más de ${days} días; el más antiguo vencía el ${dmy(r.oldest)}.`,
          link: `/cuentas-a-cobrar/${r.id}`,
        }));
      }
      case 'CHEQUE_DUE': {
        const rows = await tx.cheque.findMany({ where: { ownership: 'THIRD', status: 'IN_PORTFOLIO', paymentDate: { lte: new Date(today.getTime() + days * 86_400_000) } }, orderBy: { paymentDate: 'asc' } });
        return rows.map((c) => ({ key: c.id, title: `Cheque ${c.bank} n.º ${c.number} por ${fmtMoney(c.amount.toString())}`, detail: `Fecha de pago ${dmy(c.paymentDate)}: depositarlo o usarlo.`, link: '/tesoreria' }));
      }
      case 'CHEQUE_REJECTED': {
        const rows = await tx.$queryRaw<{ id: string; bank: string; number: string; amount: string; customer: string | null }[]>`
          SELECT c.id, c.bank, c.number, c.amount::text AS amount, p.legal_name AS customer
          FROM cheques c LEFT JOIN parties p ON p.id = c.received_from_id
          WHERE c.ownership = 'THIRD' AND c.status = 'REJECTED' ORDER BY c.payment_date`;
        return rows.map((c) => ({ key: c.id, title: `Cheque rechazado ${c.bank} n.º ${c.number} por ${fmtMoney(c.amount)}`, detail: c.customer ? `Lo entregó ${c.customer}: reclamar el reemplazo.` : null, link: '/tesoreria' }));
      }
      case 'APPROVAL_PENDING': {
        const [docs, payments] = await Promise.all([
          tx.stockDocument.findMany({ where: { status: 'PENDING_APPROVAL' }, select: { id: true, number: true } }),
          tx.$queryRaw<{ id: string; number: string; total: string; supplier: string }[]>`
            SELECT sp.id, sp.number, sp.total::text AS total, p.legal_name AS supplier
            FROM supplier_payments sp JOIN parties p ON p.id = sp.supplier_id WHERE sp.status = 'PENDING_APPROVAL'`,
        ]);
        return [
          ...docs.map((d) => ({ key: `stock:${d.id}`, title: `Ajuste de stock ${d.number} para aprobar`, detail: 'Supera el umbral: lo aprueba otra persona.', link: `/stock/documentos/${d.id}` })),
          ...payments.map((p) => ({ key: `payment:${p.id}`, title: `Pago ${p.number} a ${p.supplier} para aprobar`, detail: `${fmtMoney(p.total)}: supera el umbral de aprobación.`, link: `/pagos/${p.id}` })),
        ];
      }
      case 'INVENTORY_DIFFERENCE': {
        const [counts, projection] = await Promise.all([
          tx.$queryRaw<{ id: string; number: string; lines: bigint }[]>`
            SELECT c.id, c.number, COUNT(*) AS lines FROM inventory_counts c JOIN inventory_count_lines l ON l.count_id = c.id
            WHERE c.status = 'REVIEW' AND l.counted_qty IS NOT NULL AND l.counted_qty <> l.expected_qty
            GROUP BY c.id, c.number`,
          // Integridad: el saldo proyectado tiene que ser la suma de los movimientos (ver ARCHITECTURE.md).
          tx.$queryRaw<{ item_id: string; warehouse_id: string; sku: string; warehouse: string; balance: string; moves: string }[]>`
            WITH b AS (SELECT item_id, warehouse_id, SUM(on_hand) AS qty FROM stock_balances GROUP BY 1, 2),
                 m AS (SELECT item_id, warehouse_id, SUM(qty) AS qty FROM stock_movements GROUP BY 1, 2)
            SELECT COALESCE(b.item_id, m.item_id) AS item_id, COALESCE(b.warehouse_id, m.warehouse_id) AS warehouse_id, i.sku, w.name AS warehouse,
                   COALESCE(b.qty, 0)::text AS balance, COALESCE(m.qty, 0)::text AS moves
            FROM b FULL JOIN m ON m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id
            JOIN items i ON i.id = COALESCE(b.item_id, m.item_id) JOIN warehouses w ON w.id = COALESCE(b.warehouse_id, m.warehouse_id)
            WHERE COALESCE(b.qty, 0) <> COALESCE(m.qty, 0)`,
        ]);
        return [
          ...counts.map((c) => ({ key: `count:${c.id}`, title: `Inventario ${c.number} con diferencias`, detail: `${Number(c.lines)} ${Number(c.lines) === 1 ? 'artículo' : 'artículos'} contados distinto del sistema: revisar y confirmar.`, link: `/stock/inventarios/${c.id}` })),
          ...projection.map((p) => ({
            key: `projection:${p.item_id}:${p.warehouse_id}`,
            title: `Saldo inconsistente: ${p.sku} en ${p.warehouse}`,
            detail: `El saldo dice ${fmtQty(p.balance)} y los movimientos suman ${fmtQty(p.moves)}. Avisar a soporte.`,
            link: `/stock/${p.item_id}`,
          })),
        ];
      }
      case 'RECONCILIATION_PENDING': {
        const rows = await tx.$queryRaw<{ id: string; account: string; lines: bigint; oldest: Date }[]>`
          SELECT s.id, a.name AS account, COUNT(*) AS lines, MIN(l.date) AS oldest
          FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id JOIN cash_accounts a ON a.id = s.cash_account_id
          WHERE l.status = 'PENDING' AND l.date < ${today}::date - ${days}::int
          GROUP BY s.id, a.name ORDER BY MIN(l.date)`;
        return rows.map((s) => ({ key: s.id, title: `${s.account}: ${Number(s.lines)} ${Number(s.lines) === 1 ? 'línea' : 'líneas'} sin conciliar`, detail: `La más antigua es del ${dmy(s.oldest)}.`, link: `/tesoreria/extractos/${s.id}` }));
      }
      case 'INTEGRATION_ERROR': {
        const [docs, failed] = await Promise.all([
          tx.$queryRaw<{ id: string; doc_type: string; status: string; party: string }[]>`
            SELECT d.id, d.doc_type, d.status::text AS status, p.legal_name AS party
            FROM fiscal_documents d JOIN parties p ON p.id = d.party_id
            WHERE d.direction = 'SALE' AND ((d.status = 'REJECTED' AND d.created_at >= now() - interval '30 days')
                                            OR (d.status = 'PENDING_AUTH' AND d.created_at < now() - interval '1 hour'))`,
          tx.emailOutbox.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
        ]);
        return [
          ...docs.map((d) => ({
            key: `arca:${d.id}`,
            title: d.status === 'REJECTED' ? `ARCA rechazó un comprobante ${d.doc_type} de ${d.party}` : `Comprobante ${d.doc_type} de ${d.party} sin CAE hace más de una hora`,
            detail: d.status === 'REJECTED' ? 'No tiene número ni efectos: revisar el motivo y volver a emitir.' : 'Se reintenta solo; si sigue así, revisar la conexión con ARCA.',
            link: `/ventas/comprobantes/${d.id}`,
          })),
          ...(failed ? [{ key: 'email', title: `${failed} ${failed === 1 ? 'correo no se pudo enviar' : 'correos no se pudieron enviar'}`, detail: 'Revisar la configuración del servidor de correo (SMTP).', link: '/alertas?tab=reglas' }] : []),
        ];
      }
      default:
        return [];
    }
  }
}

