/**
 * Empaqueta la API para Vercel en `src/vercel/` (ver src/main.ts):
 *  - server.cjs: dist/server.js (salida de nest build, con la metadata de decoradores que Nest necesita)
 *    con TODAS las dependencias JS incrustadas, la guía del asistente y las fuentes de pdfkit.
 *  - prisma-query-engine.node y argon2.node: los binarios nativos de la plataforma donde corre el build
 *    (en Vercel, Linux; el build de Vercel corre en el mismo sistema que las funciones).
 *
 * Uso: después de `nest build`, `node scripts/bundle.mjs`.
 */
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'vercel');
const require = createRequire(join(root, 'package.json'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ── Binarios nativos ──
const prismaClientDir = dirname(require.resolve('@prisma/client/package.json'));
const generatedDir = dirname(createRequire(join(prismaClientDir, 'package.json')).resolve('.prisma/client/default'));
const engine = readdirSync(generatedDir).find((f) => f.endsWith('.node') && /query_engine/.test(f));
if (!engine) throw new Error(`No encontré el motor de Prisma en ${generatedDir} (¿falta prisma generate?)`);
copyFileSync(join(generatedDir, engine), join(out, 'prisma-query-engine.node'));

const argonDir = dirname(require.resolve('@node-rs/argon2/package.json'));
const platform = `${process.platform}-${process.arch}`;
const argonPkg = readdirSync(dirname(argonDir)).find((d) => d.startsWith(`argon2-${platform}`));
if (!argonPkg) throw new Error(`No encontré el binario de argon2 para ${platform} junto a ${argonDir}`);
const argonNode = readdirSync(join(dirname(argonDir), argonPkg)).find((f) => f.endsWith('.node'));
copyFileSync(join(dirname(argonDir), argonPkg, argonNode), join(out, 'argon2.node'));

// ── Guía del asistente (mismo formato que loadGuide) ──
const kdir = join(root, 'src', 'assistant', 'knowledge');
const guide = readdirSync(kdir)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((f) => readFileSync(join(kdir, f), 'utf8').trim())
  .join('\n\n---\n\n');

/** @node-rs/argon2 elige el binario con require dinámicos: se reemplaza por el binario copiado al lado. */
const argon2Plugin = {
  name: 'argon2-native',
  setup(b) {
    b.onResolve({ filter: /^@node-rs\/argon2$/ }, () => ({ path: 'argon2-native', namespace: 'argon2-native' }));
    b.onLoad({ filter: /.*/, namespace: 'argon2-native' }, () => ({
      loader: 'js',
      contents: `module.exports = require(require('node:path').join(__dirname, 'argon2.node'));`,
    }));
  },
};

/** pdfkit lee las métricas de las fuentes estándar de disco (__dirname/data): se incrustan. */
const pdfkitPlugin = {
  name: 'pdfkit-afm',
  setup(b) {
    b.onLoad({ filter: /[\\/]pdfkit[\\/]js[\\/]pdfkit\.js$/ }, (args) => {
      const dataDir = join(dirname(args.path), 'data');
      const src = readFileSync(args.path, 'utf8').replace(
        /fs\.readFileSync\(__dirname \+ '\/data\/([\w-]+\.afm)', 'utf8'\)/g,
        (_m, file) => JSON.stringify(readFileSync(join(dataDir, file), 'utf8')),
      );
      return { contents: src, loader: 'js' };
    });
  },
};

const result = await build({
  entryPoints: [join(root, 'dist', 'server.js')],
  outfile: join(out, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  keepNames: true,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
  define: { __ERP_GUIDE__: JSON.stringify(guide) },
  plugins: [argon2Plugin, pdfkitPlugin],
  // Paquetes opcionales que Nest y otras librerías intentan cargar solo si están instalados.
  external: [
    '@nestjs/microservices',
    '@nestjs/microservices/*',
    '@nestjs/websockets',
    '@nestjs/websockets/*',
    'class-validator',
    'class-transformer',
    'class-transformer/*',
    '@fastify/static',
    '@fastify/view',
  ],
});

const left = readFileSync(join(out, 'server.cjs'), 'utf8').match(/__dirname \+ '\/data\//g);
if (left) throw new Error('pdfkit: quedaron lecturas de fuentes sin incrustar');
if (!existsSync(join(out, 'server.cjs'))) throw new Error('No se generó server.cjs');
const kb = Object.values(result.metafile.outputs).reduce((s, o) => s + o.bytes, 0) / 1024;
console.log(`Paquete de Vercel listo en src/vercel (${Math.round(kb)} KB, motor ${engine}, ${argonPkg})`);
