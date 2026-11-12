import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { webOrigin } from './common/origin';

export function configureApp(app: INestApplication) {
  app.use(helmet());
  app.use(cookieParser());
  // Los extractos bancarios viajan como texto en el cuerpo (hasta 1 MB de CSV).
  (app as NestExpressApplication).useBodyParser('json', { limit: '2mb' });
  // El front llega por el mismo origen (proxy de Next en local, ruteo de servicios en Vercel). CORS solo para el origen configurado.
  app.enableCors({ origin: webOrigin(), credentials: true });
  app.setGlobalPrefix('api');
  return app;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);
  // Vercel asigna el puerto en PORT; en local se usa API_PORT.
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`API escuchando en el puerto ${port} (/api)`);
}

// Arranca al ejecutarse directo (node dist/main.js) o en Vercel, que carga este archivo como entrada.
// Las pruebas lo importan solo por configureApp y no deben levantar el servidor.
if (require.main === module || process.env.VERCEL) {
  void bootstrap();
}
