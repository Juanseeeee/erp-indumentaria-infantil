import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';

const MAX_ATTEMPTS = 5;
const BATCH = 50;

/**
 * Despacha la cola de correos (email_outbox). Sin SMTP_URL no envía nada: los correos quedan pendientes
 * y se mandan cuando se configure. Tras 5 intentos fallidos quedan en FAILED (y lo avisa una alerta).
 */
@Injectable()
export class EmailDispatcher {
  private readonly logger = new Logger(EmailDispatcher.name);
  private transporter: { url: string; transport: Transporter } | null = null;

  constructor(private readonly uow: UnitOfWork) {}

  get configured() {
    return !!process.env.SMTP_URL;
  }

  private transport() {
    const url = process.env.SMTP_URL!;
    if (this.transporter?.url !== url) this.transporter = { url, transport: createTransport(url) };
    return this.transporter.transport;
  }

  async dispatch(ctx: Pick<RequestContext, 'companyId' | 'userId'>) {
    if (!this.configured) return { configured: false, sent: 0, failed: 0, pending: 0 };
    return this.uow.run(ctx, async (tx) => {
      // SKIP LOCKED: dos despachos simultáneos no mandan el mismo correo dos veces.
      const batch = await tx.$queryRaw<{ id: string; to_email: string; to_name: string | null; subject: string; text_body: string; html_body: string | null; attempts: number }[]>`
        SELECT id, to_email, to_name, subject, text_body, html_body, attempts FROM email_outbox
        WHERE status = 'PENDING' ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`;
      let sent = 0;
      let failed = 0;
      for (const m of batch) {
        try {
          await this.transport().sendMail({
            from: process.env.MAIL_FROM ?? 'Ositos ERP <alertas@ositos.local>',
            to: m.to_name ? { name: m.to_name, address: m.to_email } : m.to_email,
            subject: m.subject,
            text: m.text_body,
            html: m.html_body ?? undefined,
          });
          await tx.emailOutbox.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: new Date(), attempts: m.attempts + 1, lastError: null } });
          sent++;
        } catch (e) {
          const attempts = m.attempts + 1;
          await tx.emailOutbox.update({ where: { id: m.id }, data: { attempts, lastError: (e as Error).message.slice(0, 500), status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING' } });
          failed++;
          this.logger.warn(`No se pudo enviar el correo ${m.id} (intento ${attempts}): ${(e as Error).message}`);
        }
      }
      const pending = await tx.emailOutbox.count({ where: { status: 'PENDING' } });
      return { configured: true, sent, failed, pending };
    });
  }
}
