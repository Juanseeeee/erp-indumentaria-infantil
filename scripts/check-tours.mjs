/**
 * Verifica los recorridos guiados (packages/contracts/src/tours) contra la web:
 *  - cada `route` corresponde a una pantalla de apps/web/src/app/(erp) (o /login);
 *  - cada `target` existe como ancla en el código: data-tour="x", tour="x", `tour: 'x'` (pestañas),
 *    las de las tablas (table-<id>, -search, -columns, -first-row), las del menú (nav-<href>);
 *  - el ancla aparece en el archivo de esa pantalla o en un componente (components/);
 *  - ids únicos, permisos existentes, pasos con título y texto, `waitFor` seguido de un paso con ruta.
 *
 * Uso: pnpm --filter @erp/contracts build && node scripts/check-tours.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const web = join(root, 'apps', 'web', 'src');
const require = createRequire(join(root, 'packages', 'contracts', 'package.json'));
const { TOURS, ALL_PERMISSIONS } = require('./dist/index.js');

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(web).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
const src = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

// Anclas por archivo.
const anchors = new Map(); // ancla -> Set(archivos)
const add = (a, f) => (anchors.get(a) ?? anchors.set(a, new Set()).get(a)).add(f);
for (const [f, text] of src) {
  for (const m of text.matchAll(/(?:data-tour|\btour)=["']([^"'{}]+)["']/g)) add(m[1], f);
  for (const m of text.matchAll(/(?:data-tour|\btour)=\{["'`]([^"'`$]+)["'`]\}/g)) add(m[1], f);
  for (const m of text.matchAll(/\btour:\s*["']([^"']+)["']/g)) add(m[1], f);
  // Ancla condicional (solo el primer elemento de una lista): data-tour={i === 0 ? 'x' : undefined}
  for (const m of text.matchAll(/(?:data-tour|\btour)=\{[^{}?]*\?\s*["']([^"']+)["']\s*:\s*undefined\s*\}/g)) add(m[1], f);
  for (const m of text.matchAll(/<DataTable[\s\S]{0,200}?\bid=["']([^"']+)["']/g))
    for (const suf of ['', '-search', '-columns', '-first-row']) add(`table-${m[1]}${suf}`, f);
}
const parties = [...src.entries()].find(([f]) => f.includes(`terceros${sep}page.tsx`));
for (const role of ['CUSTOMER', 'SUPPLIER', 'WORKSHOP', 'all']) for (const suf of ['', '-search', '-columns', '-first-row']) add(`table-parties-${role}${suf}`, parties?.[0] ?? 'terceros');
const nav = src.get(join(web, 'components', 'nav.ts')) ?? '';
for (const m of nav.matchAll(/href:\s*'([^']+)'/g)) add(`nav-${m[1]}`, join(web, 'components', 'app-shell.tsx'));
add('item-picker', join(web, 'components', 'item-picker.tsx'));

// Pantallas: ruta -> archivo page.tsx
const appDir = join(web, 'app', '(erp)');
const pageFor = (route) => {
  const path = route.split('?')[0].replace(/\/+$/, '');
  if (path === '/login') return join(web, 'app', 'login', 'page.tsx');
  const segs = path.split('/').filter(Boolean);
  let dir = appDir;
  for (const s of segs) {
    // Segmento fijo si existe la carpeta; si no (o con «*»), la carpeta dinámica [id] (p. ej. /reportes/ventas).
    if (s !== '*' && existsSync(join(dir, s))) {
      dir = join(dir, s);
      continue;
    }
    const dyn = existsSync(dir) ? readdirSync(dir).find((d) => /^\[.+\]$/.test(d)) : undefined;
    if (!dyn) return null;
    dir = join(dir, dyn);
  }
  const page = join(dir, 'page.tsx');
  return existsSync(page) ? page : null;
};

const errors = [];
const ids = new Set();
const perms = new Set(ALL_PERMISSIONS);
for (const t of TOURS) {
  const where = `[${t.id}]`;
  if (ids.has(t.id)) errors.push(`${where} id repetido`);
  ids.add(t.id);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)) errors.push(`${where} id no es kebab-case`);
  if (!t.title || !t.description || !t.keywords?.length || !t.steps?.length) errors.push(`${where} falta título, descripción, palabras clave o pasos`);
  for (const p of t.permissions) if (!perms.has(p)) errors.push(`${where} permiso inexistente: ${p}`);
  let route = null;
  t.steps.forEach((s, i) => {
    const at = `${where} paso ${i + 1}`;
    if (!s.title || !s.body) errors.push(`${at}: falta título o texto`);
    if (s.route) {
      route = s.route;
      if (!pageFor(s.route)) errors.push(`${at}: la pantalla ${s.route} no existe`);
    }
    if (s.waitFor === 'route' && !t.steps[i + 1]?.route) errors.push(`${at}: waitFor sin un paso siguiente con ruta`);
    if (s.target) {
      const found = anchors.get(s.target);
      if (!found) {
        errors.push(`${at}: el ancla "${s.target}" no existe en la web`);
      } else if (route && !s.target.startsWith('nav-') && !s.target.startsWith('header-')) {
        const page = pageFor(route);
        const ok = [...found].some((f) => f === page || f.startsWith(join(web, 'components')) || (page && f.startsWith(join(page, '..'))));
        if (!ok) errors.push(`${at}: el ancla "${s.target}" está en ${[...found].map((f) => relative(web, f)).join(', ')}, no en la pantalla ${route}`);
      }
    }
  });
}

if (errors.length) {
  console.error(`Recorridos con problemas (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Recorridos OK: ${TOURS.length} recorridos, ${TOURS.reduce((n, t) => n + t.steps.length, 0)} pasos.`);
