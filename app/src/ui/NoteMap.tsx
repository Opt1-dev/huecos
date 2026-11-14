import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { subjects, type NoteRow } from '../lib/data';
import { layoutGraph, noteLinks, type Point } from '../lib/noteGraph';

const LABEL_MAX = 22;
const LABEL_H = 14;
/** Rough width of one character of a 0.7rem label. */
const CHAR_W = 6.4;

function shortLabel(title: string): string {
  return title.length > LABEL_MAX ? `${title.slice(0, LABEL_MAX - 1)}…` : title;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const overlap = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

/**
 * Labels that fit: each goes right of its point, else left, unless it would
 * leave the map or cover another label or point. The others show on hover or
 * focus. Pinned notes get their label first.
 */
export function placeLabels(notes: readonly { id: string; title: string; pinned: boolean }[], at: (id: string) => Point, w: number, h: number) {
  const placed = new Map<string, { right: boolean }>();
  const dots = new Map(notes.map((n) => {
    const p = at(n.id);
    return [n.id, { x1: p.x - 8, y1: p.y - 8, x2: p.x + 8, y2: p.y + 8 }] as const;
  }));
  const labels: Box[] = [];
  const order = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  for (const n of order) {
    const p = at(n.id);
    const width = shortLabel(n.title).length * CHAR_W;
    const y1 = p.y - LABEL_H / 2;
    for (const right of [true, false]) {
      const x1 = right ? p.x + 10 : p.x - 10 - width;
      const box = { x1, y1, x2: x1 + width, y2: y1 + LABEL_H };
      if (box.x1 < 2 || box.x2 > w - 2 || box.y1 < 0 || box.y2 > h) continue;
      if (labels.some((l) => overlap(box, l))) continue;
      if ([...dots].some(([id, d]) => id !== n.id && overlap(box, d))) continue;
      labels.push(box);
      placed.set(n.id, { right });
      break;
    }
  }
  return placed;
}

interface Props {
  notes: readonly NoteRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Each note is a point; notes whose titles share a word are joined by a line. */
export function NoteMap({ notes, selectedId, onSelect }: Props) {
  const tr = t.value;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 200 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(120, el.clientWidth), h: Math.max(120, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Laid out once per set of notes in a unit square, then stretched to the map.
  const key = notes.map((n) => `${n.id}:${n.title}:${n.pinned}`).join('|');
  const links = useMemo(() => noteLinks(notes), [key]);
  const pos = useMemo(() => layoutGraph(notes, links, 1), [key]);
  const px = (id: string): Point => {
    const p = pos.get(id)!;
    return { x: p.x * size.w, y: p.y * size.h };
  };
  const labels = useMemo(() => placeLabels(notes, px, size.w, size.h), [key, size.w, size.h]);

  const color = (n: NoteRow) => {
    const s = subjects.value.find((x) => x.id === n.subject_id);
    return s ? `var(--series-${(s.color_index % 8) + 1})` : 'var(--muted)';
  };

  const focus = hoverId ?? selectedId;
  const neighbours = new Set(focus ? links.flatMap((l) => (l.a === focus ? [l.b] : l.b === focus ? [l.a] : [])) : []);
  const focusNote = notes.find((n) => n.id === focus);
  const focusWords = focus ? [...new Set(links.filter((l) => l.a === focus || l.b === focus).flatMap((l) => l.words))] : [];

  return (
    <div class="note-map" ref={box}>
      {notes.length === 0 ? (
        <p class="muted small note-map-empty">{tr('nt.mapEmpty')}</p>
      ) : (
        <svg width={size.w} height={size.h} role="group" aria-label={tr('nt.map')}>
          {links.map((l) => {
            const a = px(l.a);
            const b = px(l.b);
            const lit = focus !== null && (l.a === focus || l.b === focus);
            return (
              <line
                key={`${l.a}-${l.b}`}
                class={lit ? 'map-link lit' : focus ? 'map-link dim' : 'map-link'}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                style={{ strokeWidth: `${Math.min(1 + (l.words.length - 1) * 0.75, 3)}px` }}
              />
            );
          })}
          {notes.map((n) => {
            const p = px(n.id);
            const active = n.id === focus;
            const dim = focus !== null && !active && !neighbours.has(n.id);
            const placed = labels.get(n.id);
            const right = placed ? placed.right : p.x < size.w * 0.6;
            return (
              <g
                key={n.id}
                class={`map-node${active ? ' active' : ''}${dim ? ' dim' : ''}${n.id === selectedId ? ' selected' : ''}`}
                style={{ '--c': color(n) }}
                tabIndex={0}
                role="button"
                aria-label={tr('nt.open', { title: n.title })}
                onPointerEnter={() => setHoverId(n.id)}
                onPointerLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(n.id)}
                onBlur={() => setHoverId(null)}
                onClick={() => onSelect(n.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(n.id);
                  }
                }}
              >
                <circle class="map-hit" cx={p.x} cy={p.y} r={14} />
                <circle class="map-dot" cx={p.x} cy={p.y} r={n.pinned ? 7 : 5.5} />
                {(placed || active) && (
                  <text class="map-label" x={p.x + (right ? 10 : -10)} y={p.y} dy="0.32em" text-anchor={right ? 'start' : 'end'}>
                    {shortLabel(n.title)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {focusNote && (
        <p class="map-caption small" aria-live="polite">
          <strong>{focusNote.title}</strong>
          {focusWords.length > 0 && <span class="muted"> · {tr('nt.linked', { words: focusWords.join(', ') })}</span>}
        </p>
      )}
    </div>
  );
}
