/**
 * Entrada de la API (en Vercel, fijada con `entrypoint` en vercel.json).
 *
 * En Vercel, el empaquetado de la función no incluye las dependencias de un monorepo pnpm (error
 * «Cannot find module» al arrancar) ni archivos sueltos. Por eso el build genera `dist/vercel/` (Vercel publica dist/ como función)
 * (`scripts/bundle.mjs`): `server.cjs` con la API completa en un solo archivo y `natives.cjs` con los
 * binarios nativos comprimidos, que acá se extraen a /tmp. Este archivo no importa nada de
 * node_modules. En local (node dist/main.js) se usa el código compilado normal (`bootstrap.ts`).
 * No renombrar `bootstrap.ts` a main/app/index/server: Vercel toma esos nombres como entradas.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

type ServerModule = { bootstrap: () => Promise<void> };
type Natives = { platform: string; engine: string; argon2: string };

/** Escribe los binarios nativos en /tmp (una vez por instancia) y le indica a Prisma y argon2 dónde están. */
function extractNatives(natives: Natives) {
  const dir = join(tmpdir(), `erp-natives-${natives.platform}`);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, b64: string) => {
    const file = join(dir, name);
    if (!existsSync(file)) {
      const partial = `${file}.${process.pid}.tmp`;
      writeFileSync(partial, gunzipSync(Buffer.from(b64, 'base64')));
      renameSync(partial, file);
    }
    return file;
  };
  process.env.PRISMA_QUERY_ENGINE_LIBRARY ??= write('prisma-query-engine.node', natives.engine);
  process.env.ERP_ARGON2_NATIVE = write('argon2.node', natives.argon2);
}

/** Si el arranque falla en Vercel, deja en el log qué archivos llegaron a la función. */
function logLayout() {
  const list = (d: string, depth: number): string[] => {
    try {
      return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() && depth > 0 && e.name !== 'node_modules' ? [`${e.name}/`, ...list(join(d, e.name), depth - 1).map((x) => `  ${e.name}/${x}`)] : [e.name],
      );
    } catch {
      return [];
    }
  };
  console.error(`[api] __dirname=${__dirname} cwd=${process.cwd()}\n${list(__dirname, 2).slice(0, 80).join('\n')}`);
}

function loadServer(): ServerModule {
  // Solo en Vercel (o forzado con API_BUNDLE=1 para probarlo): en local podría haber un paquete viejo.
  if (process.env.VERCEL || process.env.API_BUNDLE === '1') {
    try {
      // Rutas literales: así el empaquetado de Vercel los incluye en la función.
      extractNatives(require('./vercel/natives.cjs') as Natives);
      return require('./vercel/server.cjs') as ServerModule;
    } catch (err) {
      console.error('[api] No se pudo cargar el paquete de Vercel (dist/vercel):', err);
      logLayout();
      throw err;
    }
  }
  // Ruta dinámica: el empaquetado de Vercel no debe seguir el código sin empaquetar.
  return require(join(__dirname, 'bootstrap')) as ServerModule;
}

// Arranca al ejecutarse directo (node dist/main.js) o en Vercel, que carga este archivo como entrada.
if (require.main === module || process.env.VERCEL) {
  void loadServer().bootstrap();
}
