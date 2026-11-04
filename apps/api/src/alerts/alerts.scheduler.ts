import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from './alerts.service';
import { EmailDispatcher } from './email-dispatcher';

/** Usuario técnico de los procesos automáticos (no existe en `users`; no audita acciones de negocio). */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Evalúa las alertas de cada empresa y despacha los correos cada ALERTS_INTERVAL_MINUTES (15 por defecto;
 * 0 la desactiva, y en las pruebas automáticas no corre). Cuando exista apps/worker, esto se muda ahí.
 */
@Injectable()
export class AlertsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AlertsScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly mailer: EmailDispatcher,
  ) {}

  onApplicationBootstrap() {
    const minutes = Number(process.env.ALERTS_INTERVAL_MINUTES ?? 15);
    if (process.env.NODE_ENV === 'test' || !Number.isFinite(minutes) || minutes <= 0) return;
    // Primera pasada al minuto de arrancar, para no competir con el arranque.
    this.timers = [setTimeout(() => void this.tick(), 60_000), setInterval(() => void this.tick(), minutes * 60_000)];
    for (const t of this.timers) t.unref();
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearTimeout(t);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const companies = await this.prisma.companyUser.findMany({ where: { isActive: true }, distinct: ['companyId'], select: { companyId: true } });
      for (const { companyId } of companies) {
        const ctx = { companyId, userId: SYSTEM_USER_ID };
        try {
          const r = await this.alerts.evaluate(ctx);
          const m = await this.mailer.dispatch(ctx);
          if (r.created || r.resolved || m.sent || m.failed) this.logger.log(`Empresa ${companyId}: ${r.created} alertas nuevas, ${r.resolved} resueltas, ${m.sent} correos enviados, ${m.failed} con error.`);
        } catch (e) {
          this.logger.error(`Alertas de la empresa ${companyId}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
