// Note map: notes linked when their titles share a word (pure, tested).
import { fold } from './rendus';

/** Short words that don't make two notes related (FR, ES, EN). */
const STOPWORDS = new Set(
  (
    'les des une pour par sur dans avec sans aux ces ses mes tes nos vos leur leurs que qui quoi est sont pas plus tout tous toute ' +
    'los las una unos unas para por con sin del como que pero sus mis tus mas muy entre sobre ' +
    'the and for with from into onto your our their are was were not but all any '
  )
    .split(' ')
    .filter(Boolean),
);

/** Meaningful words of a title: folded, 3+ letters, no stop words. */
export function titleWords(title: string): string[] {
  const words = fold(title)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

export interface NoteNode {
  id: string;
  title: string;
}

export interface NoteLink {
  a: string;
  b: string;
  words: string[];
}

/** One link per pair of notes whose titles share at least one word. */
export function noteLinks(notes: readonly NoteNode[]): NoteLink[] {
  const words = notes.map((n) => new Set(titleWords(n.title)));
  const links: NoteLink[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const shared = [...words[i]!].filter((w) => words[j]!.has(w));
      if (shared.length > 0) links.push({ a: notes[i]!.id, b: notes[j]!.id, words: shared });
    }
  }
  return links;
}

/** Deterministic pseudo-random numbers from a string seed. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Force layout (Fruchterman–Reingold) in a `width` × 1 box: linked notes pull
 * together, all notes push apart, a light pull keeps them centred. Same notes
 * and links give the same picture every time. Coordinates stay within a
 * margin of the box.
 */
export function layoutGraph(nodes: readonly NoteNode[], links: readonly NoteLink[], width = 3, iterations = 300): Map<string, Point> {
  const n = nodes.length;
  const pos = new Map<string, Point>();
  if (n === 0) return pos;
  const margin = 0.08;
  const clampX = (v: number) => Math.min(width - margin, Math.max(margin, v));
  const clampY = (v: number) => Math.min(1 - margin, Math.max(margin, v));
  if (n === 1) {
    pos.set(nodes[0]!.id, { x: width / 2, y: 0.5 });
    return pos;
  }

  const rand = seeded(nodes.map((d) => d.id).join('|'));
  for (const d of nodes) pos.set(d.id, { x: margin + rand() * (width - 2 * margin), y: margin + rand() * (1 - 2 * margin) });

  const k = 0.9 * Math.sqrt(width / n);
  const linked = links.filter((l) => pos.has(l.a) && pos.has(l.b));
  let temp = width / 8;
  const cooling = temp / (iterations + 1);
  for (let it = 0; it < iterations; it++) {
    const disp = new Map(nodes.map((d) => [d.id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      const pa = pos.get(a.id)!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        const pb = pos.get(b.id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          d = Math.hypot(dx, dy);
        }
        const f = (k * k) / d;
        disp.get(a.id)!.x += (dx / d) * f;
        disp.get(a.id)!.y += (dy / d) * f;
        disp.get(b.id)!.x -= (dx / d) * f;
        disp.get(b.id)!.y -= (dy / d) * f;
      }
    }
    for (const l of linked) {
      const pa = pos.get(l.a)!;
      const pb = pos.get(l.b)!;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const d = Math.max(Math.hypot(dx, dy), 1e-6);
      const f = ((d * d) / k) * (1 + 0.5 * (l.words.length - 1));
      disp.get(l.a)!.x -= (dx / d) * f;
      disp.get(l.a)!.y -= (dy / d) * f;
      disp.get(l.b)!.x += (dx / d) * f;
      disp.get(l.b)!.y += (dy / d) * f;
    }
    for (const d of nodes) {
      const p = pos.get(d.id)!;
      const v = disp.get(d.id)!;
      // Light pull towards the centre so unlinked notes don't stick to the edges.
      v.x += (width / 2 - p.x) * 0.15 * k;
      v.y += (0.5 - p.y) * 0.15 * k;
      const len = Math.max(Math.hypot(v.x, v.y), 1e-9);
      const step = Math.min(len, temp);
      p.x = clampX(p.x + (v.x / len) * step);
      p.y = clampY(p.y + (v.y / len) * step);
    }
    temp = Math.max(temp - cooling, 0.002);
  }
  return pos;
}
