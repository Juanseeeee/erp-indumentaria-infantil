import { Controller, Get, Headers, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators';
import { AlertsScheduler } from './alerts.scheduler';

/**
 * Tareas programadas para Vercel Cron (en Vercel no corre el temporizador interno).
 * Vercel llama con «Authorization: Bearer <CRON_SECRET>». Sin CRON_SECRET configurada, no hace nada.
 */
@Controller('cron')
export class CronController {
  constructor(private readonly scheduler: AlertsScheduler) {}

  @Public()
  @Get('alerts')
  async alerts(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new ServiceUnavailableException('Tarea programada no configurada (falta CRON_SECRET).');
    // Comparación en tiempo constante (sobre hashes, para no filtrar la longitud).
    const digest = (v: string) => createHash('sha256').update(v).digest();
    if (!timingSafeEqual(digest(authorization ?? ''), digest(`Bearer ${secret}`))) throw new UnauthorizedException('No autorizado.');
    return this.scheduler.tick();
  }
}
