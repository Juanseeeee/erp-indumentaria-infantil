/**
 * «Modo guía»: ayuda sin IA. Busca la pregunta en la guía de la plataforma (BM25 sobre las secciones
 * de knowledge/*.md, con normalización y raíces simples en español) y devuelve la sección más útil.
 * No envía datos a ningún servicio externo y no tiene costo ni límites.
 */

export interface GuideSection {
  title: string;
  /** Título de la sección madre (## …) cuando es una subsección (### …). */
  parent?: string;
  body: string;
  /** Rutas internas que menciona (para priorizar la pantalla actual). */
  routes: string[];
  tokens: string[];
  tf: Map<string, number>;
  titleTokens: Set<string>;
}

const STOP = new Set(
  'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estan estas este esto estos fue ha hace hacer hago hay la las le les lo los mas me mi mis muy necesito ni no nos o otra otro para pero poco por porque puede pueden puedo que quiero se sea ser si sin sobre son su sus tambien tengo tiene todo todos tu tus un una uno unos y ya yo vos podes tenes queres deberia hacerlo hacen sirve donde esta ver veo'.split(
    ' ',
  ),
);

/** Sinónimos frecuentes: lo que la gente escribe → cómo lo nombra la guía. */
const SYNONYMS: Record<string, string[]> = {
  factur: ['comprobant'],
  boleta: ['factur', 'comprobant'],
  cliente: ['tercer'],
  client: ['tercer'],
  proveedor: ['tercer'],
  taller: ['tercer'],
  contrasen: ['password', 'sesion'],
  clave: ['contrasen'],
  plata: ['tesor', 'caj', 'banc'],
  pag: ['orden'],
  mercaderi: ['stock'],
  inventari: ['stock'],
  product: ['model', 'variant'],
  prend: ['model', 'variant'],
  tela: ['material'],
  avi: ['material'],
  receta: ['fich'],
  usuari: ['rol', 'permis'],
  lleg: ['recep', 'recib'],
  menos: ['parcial'],
  falt: ['parcial', 'faltant'],
  mand: ['envi'],
  devolv: ['devolu'],
  mes: ['period'],
};

const ENDINGS = ['ieron', 'aron', 'eron', 'aciones', 'amientos', 'amiento', 'acion', 'ciones', 'cion', 'iendo', 'ando', 'ados', 'adas', 'ado', 'ada', 'ar', 'er', 'ir', 'es', 'as', 'os', 'a', 'o', 'e', 's'];

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ');
}

export function stem(word: string): string {
  for (const e of ENDINGS) {
    if (word.length - e.length >= 3 && word.endsWith(e)) return word.slice(0, -e.length);
  }
  return word;
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

export function buildIndex(markdown: string): GuideSection[] {
  const sections: GuideSection[] = [];
  let parent: string | undefined;
  let current: { title: string; parent?: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join('\n').trim();
    if (body) {
      const routes = [...body.matchAll(/`(\/[a-z0-9\-/]*)`/g)].map((m) => m[1]!);
      // El título pesa más que el cuerpo.
      const titleTokens = new Set(tokenize(current.title));
      const tokens = [...titleTokens, ...(current.parent ? tokenize(current.parent) : []), ...tokenize(body)];
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      sections.push({ title: current.title, parent: current.parent, body, routes, tokens, tf, titleTokens });
    }
    current = null;
  };
  for (const line of markdown.split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1]!.length;
      if (level === 1) {
        parent = undefined;
        current = { title: h[2]!.trim(), lines: [] };
      } else if (level === 2) {
        parent = h[2]!.trim();
        current = { title: parent, lines: [] };
      } else {
        current = { title: h[2]!.trim(), parent, lines: [] };
      }
      continue;
    }
    if (line.trim() === '---') continue;
    current?.lines.push(line);
  }
  flush();
  return sections;
}

export interface GuideHit {
  section: GuideSection;
  score: number;
}

export function searchGuide(index: GuideSection[], question: string, page?: string, limit = 3): GuideHit[] {
  const base = tokenize(question);
  const terms = [...new Set([...base, ...base.flatMap((t) => Object.entries(SYNONYMS).filter(([k]) => t.startsWith(k)).flatMap(([, v]) => v))])];
  if (!terms.length) return [];
  const N = index.length;
  const avg = index.reduce((s, x) => s + x.tokens.length, 0) / Math.max(N, 1);
  const df = new Map<string, number>();
  for (const term of terms) df.set(term, index.filter((s) => matchCount(s, term) > 0).length);
  const k1 = 1.4;
  const b = 0.75;
  const pageRoute = page?.split('?')[0];
  return index
    .map((section) => {
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const f = matchCount(section, term);
        if (!f) continue;
        matched++;
        const idf = Math.log(1 + (N - df.get(term)! + 0.5) / (df.get(term)! + 0.5));
        score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * section.tokens.length) / avg));
        // Que el término esté en el título es la mejor señal de que la sección trata de eso.
        if ([...section.titleTokens].some((t) => t === term || (term.length >= 4 && t.startsWith(term)))) score += 2.5 * idf;
      }
      // Cubrir más términos de la pregunta vale más que repetir uno solo.
      score *= 0.5 + matched / terms.length;
      // Las secciones generales (preguntas frecuentes, glosario) solo ganan si no hay una específica.
      if (/preguntas frecuentes|glosario/i.test(section.title)) score *= 0.8;
      if (pageRoute && pageRoute !== '/' && section.routes.some((r) => r === pageRoute || pageRoute.startsWith(r + '/'))) score *= 1.25;
      return { section, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Coincidencia exacta del término o como prefijo (para raíces cortas como «factur»). */
function matchCount(section: GuideSection, term: string): number {
  const exact = section.tf.get(term) ?? 0;
  if (exact || term.length < 4) return exact;
  let n = 0;
  for (const [t, c] of section.tf) if (t.length > term.length && t.startsWith(term)) n += c;
  return n;
}

/** Adapta el Markdown de la guía al panel: tablas a listas y rutas a enlaces. */
export function renderSection(body: string, maxChars = 2400): string {
  const out: string[] = [];
  let header: string[] | null = null;
  for (const line of body.split('\n')) {
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!header) {
        header = cells;
        continue;
      }
      out.push(`- ${cells[0]}${cells.length > 1 ? ': ' + cells.slice(1).filter(Boolean).join(' · ') : ''}`);
      continue;
    }
    header = null;
    out.push(line);
  }
  let text = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/`(\/[a-z0-9\-/]*)`/g, (_m, r: string) => `[${r}](${r})`);
  if (text.length > maxChars) {
    const cut = text.lastIndexOf('\n', maxChars);
    text = text.slice(0, cut > maxChars / 2 ? cut : maxChars).trimEnd() + '\n\n…';
  }
  return text.trim();
}
