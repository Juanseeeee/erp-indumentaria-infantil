import { TOURS, canTakeTour, type Tour } from '@erp/contracts';
import { tokenize } from './assistant.guide';

/**
 * Elige los recorridos guiados para ofrecer debajo de una respuesta del asistente, según la pregunta.
 * Es independiente del motor (IA o guía): así el botón «Guiame paso a paso» aparece siempre igual.
 */
interface IndexedTour {
  tour: Tour;
  title: Set<string>;
  keywords: Set<string>;
  phrases: string[][];
  description: Set<string>;
}

let index: { tours: IndexedTour[]; idf: Map<string, number> } | null = null;

function build() {
  const tours = TOURS.map((tour) => {
    const phrases = tour.keywords.map((k) => tokenize(k)).filter((p) => p.length);
    return {
      tour,
      title: new Set(tokenize(tour.title)),
      keywords: new Set(phrases.flat()),
      phrases,
      description: new Set(tokenize(tour.description)),
    };
  });
  const df = new Map<string, number>();
  for (const t of tours) for (const tok of new Set([...t.title, ...t.keywords, ...t.description])) df.set(tok, (df.get(tok) ?? 0) + 1);
  const n = Math.max(1, tours.length);
  const idf = new Map([...df].map(([tok, f]) => [tok, Math.log(1 + n / f)]));
  return { tours, idf };
}

export function matchTours(question: string, permissions: Iterable<string>, limit = 2): { id: string; title: string }[] {
  index ??= build();
  const q = [...new Set(tokenize(question))];
  if (!q.length) return [];
  const perms = [...permissions];
  const scored = index.tours
    .filter((t) => canTakeTour(t.tour, perms))
    .map((t) => {
      let score = 0;
      let hits = 0;
      for (const tok of q) {
        const w = index!.idf.get(tok) ?? 0;
        const field = t.title.has(tok) ? 3 : t.keywords.has(tok) ? 2 : t.description.has(tok) ? 1 : 0;
        if (field) hits++;
        score += field * w;
      }
      // Una frase clave completa dentro de la pregunta («nota de crédito», «cheque rechazado») pesa mucho.
      const qs = new Set(q);
      for (const p of t.phrases) if (p.length > 1 && p.every((tok) => qs.has(tok))) score += 4 * p.length;
      return { t, score, hits };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  // Coincidencia clara (varias palabras o una muy específica); si no hay, una sola palabra del título
  // («¿cómo hago una factura?») alcanza para ofrecer el recorrido más afín.
  const strong = scored.filter((s) => s.score >= 3 && (s.hits >= 2 || s.score >= 6));
  const weak = scored.filter((s) => s.t.title.size && [...s.t.title].some((tok) => q.includes(tok)) && s.score >= 1.5);
  const pool = strong.length ? strong : weak.slice(0, 1);
  if (!pool.length) return [];
  const best = pool[0]!.score;
  return pool
    .filter((s) => s.score >= best * 0.75)
    .slice(0, limit)
    .map((s) => ({ id: s.t.tour.id, title: s.t.tour.title }));
}
