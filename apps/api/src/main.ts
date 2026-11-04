import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

export function configureApp(app: INestApplication) {
  app.use(helmet());
  app.use(cookieParser());
  // Los extractos bancarios viajan como texto en el cuerpo (hasta 1 MB de CSV).
  (app as NestExpressApplication).useBodyParser('json', { limit: '2mb' });
  // El front llega por el proxy de Next (mismo origen). CORS solo para el origen configurado.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.setGlobalPrefix('api');
  return app;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`API escuchando en http://localhost:${port}/api`);
}

if (require.main === module) {
  void bootstrap();
}
