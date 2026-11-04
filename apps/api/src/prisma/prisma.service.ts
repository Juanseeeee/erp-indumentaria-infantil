import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

/**
 * Cliente Prisma. Conecta con el rol `erp_app`, sujeto a RLS: cualquier consulta sobre
 * tablas de negocio fuera de `UnitOfWork.run` (que fija `app.company_id`) devuelve cero filas.
 * Las únicas tablas sin RLS son las de plataforma global: users, sessions, company_users, permissions.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'] });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
