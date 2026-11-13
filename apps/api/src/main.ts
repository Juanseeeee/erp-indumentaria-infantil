/**
 * Entrada de la API (en Vercel, fijada con `entrypoint` en vercel.json).
 *
 * En Vercel, el empaquetado de la función no incluye las dependencias de un monorepo pnpm (error
 * «Cannot find module» al arrancar). Por eso el build genera `src/vercel/` con la API completa en un
 * solo archivo (`scripts/bundle.mjs`) y los dos binarios nativos al lado; este archivo no importa
 * nada de node_modules y carga ese paquete. En local (node dist/main.js) se usa el código compilado
 * normal (`bootstrap.ts`). No renombrar `bootstrap.ts` a main/app/index/server: Vercel toma esos
 * nombres como posibles entradas.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type ServerModule = { bootstrap: () => Promise<void> };

function bundleDir(): string | undefined {
  // Solo en Vercel (o forzado con API_BUNDLE=1 para probarlo): en local podría haber un paquete viejo.
  if (!process.env.VERCEL && process.env.API_BUNDLE !== '1') return undefined;
  const candidates = [
    join(__dirname, 'vercel'),
    join(process.cwd(), 'vercel'),
    join(process.cwd(), 'src', 'vercel'),
    join(process.cwd(), 'apps', 'api', 'src', 'vercel'),
  ];
  return candidates.find((d) => existsSync(join(d, 'server.cjs')));
}

function loadServer(): ServerModule {
  const dir = bundleDir();
  if (!dir) {
    if (process.env.VERCEL) console.error('[api] No se encontró el paquete src/vercel/server.cjs; se intenta el código sin empaquetar.');
    return require('./bootstrap') as ServerModule;
  }
  const engine = join(dir, 'prisma-query-engine.node');
  if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY && existsSync(engine)) process.env.PRISMA_QUERY_ENGINE_LIBRARY = engine;
  // La ruta literal permite que Vercel rastree e incluya el paquete en la función.
  if (dir === join(__dirname, 'vercel')) return require('./vercel/server.cjs') as ServerModule;
  return require(join(dir, 'server.cjs')) as ServerModule;
}

// Arranca al ejecutarse directo (node dist/main.js) o en Vercel, que carga este archivo como entrada.
if (require.main === module || process.env.VERCEL) {
  void loadServer().bootstrap();
}
