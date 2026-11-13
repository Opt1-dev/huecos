import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { subjects, type NoteRow } from '../lib/data';
import { layoutGraph, noteLinks } from '../lib/noteGraph';

const LABEL_MAX = 22;

interface Props {
  notes: readonly NoteRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Each note is a point; notes whose titles share a word are joined by a line. */
export function NoteMap({ notes, selectedId, onSelect }: Props) {
  const tr = t.value;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(140, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout in a width × 1 box; only a real change of shape lays it out again.
  const aspect = Math.max(1, Math.round((size.w / size.h) * 4) / 4);
  const key = notes.map((n) => `${n.id}:${n.title}`).join('|');
  const links = useMemo(() => noteLinks(notes), [key]);
  const pos = useMemo(() => layoutGraph(notes, links, aspect), [key, aspect]);

  const color = (n: NoteRow) => {
    const s = subjects.value.find((x) => x.id === n.subject_id);
    return s ? `var(--series-${(s.color_index % 8) + 1})` : 'var(--muted)';
  };
  const px = (id: string) => {
    const p = pos.get(id)!;
    return { x: (p.x / aspect) * size.w, y: p.y * size.h };
  };

  const focus = hoverId ?? selectedId;
  const neighbours = new Set(focus ? links.flatMap((l) => (l.a === focus ? [l.b] : l.b === focus ? [l.a] : [])) : []);
  const focusNote = notes.find((n) => n.id === focus);
  const focusWords = focus ? [...new Set(links.filter((l) => l.a === focus || l.b === focus).flatMap((l) => l.words))] : [];
  const showLabels = notes.length <= 30;

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
            const right = p.x < size.w * 0.7;
            const label = n.title.length > LABEL_MAX ? `${n.title.slice(0, LABEL_MAX - 1)}…` : n.title;
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
                {(showLabels || active) && (
                  <text class="map-label" x={p.x + (right ? 10 : -10)} y={p.y} dy="0.32em" text-anchor={right ? 'start' : 'end'}>
                    {label}
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
