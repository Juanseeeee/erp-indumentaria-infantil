/**
 * Entrada de la API.
 *
 * En Vercel, el empaquetado de la función no incluye las dependencias de un monorepo pnpm (error
 * «Cannot find module» al arrancar). Por eso el build genera `src/vercel/` con la API completa en un
 * solo archivo (`scripts/bundle.mjs`) y los dos binarios nativos al lado; este archivo no importa
 * nada de node_modules y carga ese paquete si existe. En local (node dist/main.js) no existe y se
 * usa el código compilado normal.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type ServerModule = { bootstrap: () => Promise<void> };

function loadServer(): ServerModule {
  // Solo en Vercel (o forzado con API_BUNDLE=1 para probarlo): en local podría haber un paquete viejo.
  if ((process.env.VERCEL || process.env.API_BUNDLE === '1') && existsSync(join(__dirname, 'vercel', 'server.cjs'))) {
    const engine = join(__dirname, 'vercel', 'prisma-query-engine.node');
    if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY && existsSync(engine)) process.env.PRISMA_QUERY_ENGINE_LIBRARY = engine;
    return require('./vercel/server.cjs') as ServerModule;
  }
  return require('./server') as ServerModule;
}

// Arranca al ejecutarse directo (node dist/main.js) o en Vercel, que carga este archivo como entrada.
if (require.main === module || process.env.VERCEL) {
  void loadServer().bootstrap();
}
