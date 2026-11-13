import { useEffect, useRef, useState } from 'preact/hooks';
import { locale, t } from '../i18n';
import type { SubjectSeries } from '../lib/rendus';
import { shortDate } from './format';

const HEIGHT = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 32 };
const DAY = 86_400_000;
const REFERENCES = [7.5, 5];

const dateMs = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y!, m! - 1, day!);
};

export function formatGrade(n: number): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }).format(n);
}

interface Tip {
  x: number;
  y: number;
  subject: string;
  title: string;
  due: string;
  grade: number;
}

/** Grades over time: one line per subject, legend with each subject's average. */
export function GradesChart({ series }: { series: SubjectSeries[] }) {
  const tr = t.value;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (series.length === 0) return <p class="muted small">{tr('rd.chartEmpty')}</p>;

  const all = series.flatMap((s) => s.points.map((p) => dateMs(p.due)));
  const min = Math.min(...all) - 3 * DAY;
  const max = Math.max(...all) + 3 * DAY;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (d: string) => PAD.left + ((dateMs(d) - min) / (max - min)) * plotW;
  const y = (g: number) => PAD.top + (1 - g / 10) * plotH;

  // About one date label per 90 px.
  const ticks: number[] = [];
  const count = Math.max(2, Math.floor(plotW / 90));
  for (let i = 0; i <= count; i++) ticks.push(min + ((max - min) * i) / count);
  const tickLabel = (ms: number) => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(ms);

  return (
    <div class="grades-chart" ref={box}>
      <svg width={width} height={HEIGHT} role="img" aria-labelledby="grades-desc">
        <desc id="grades-desc">{tr('rd.chartDesc')}</desc>
        {[0, 2.5, 5, 7.5, 10].map((g) => (
          <g key={`y${g}`}>
            <line class="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(g)} y2={y(g)} />
            <text class="chart-axis" x={PAD.left - 6} y={y(g)} dy="0.32em" text-anchor="end">
              {formatGrade(g)}
            </text>
          </g>
        ))}
        {REFERENCES.map((g) => (
          <line key={`r${g}`} class="chart-ref" x1={PAD.left} x2={width - PAD.right} y1={y(g)} y2={y(g)} />
        ))}
        {ticks.map((ms, i) => (
          <text
            key={`x${ms}`}
            class="chart-axis"
            x={PAD.left + ((ms - min) / (max - min)) * plotW}
            y={HEIGHT - 8}
            text-anchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
          >
            {tickLabel(ms)}
          </text>
        ))}
        {series.map((s) => (
          <g key={s.subjectId ?? 'none'} style={{ '--c': `var(--series-${(s.colorIndex % 8) + 1})` }}>
            {s.points.length > 1 && (
              <polyline class="chart-line" points={s.points.map((p) => `${x(p.due)},${y(p.grade)}`).join(' ')} />
            )}
            {s.points.map((p, i) => (
              <g key={i}>
                <circle class="chart-point" cx={x(p.due)} cy={y(p.grade)} r={4} />
                <circle
                  class="chart-hit"
                  cx={x(p.due)}
                  cy={y(p.grade)}
                  r={12}
                  tabIndex={0}
                  aria-label={`${s.name} · ${p.title} · ${shortDate(p.due)} · ${formatGrade(p.grade)}/10`}
                  onPointerEnter={() => setTip({ x: x(p.due), y: y(p.grade), subject: s.name, title: p.title, due: p.due, grade: p.grade })}
                  onPointerLeave={() => setTip(null)}
                  onFocus={() => setTip({ x: x(p.due), y: y(p.grade), subject: s.name, title: p.title, due: p.due, grade: p.grade })}
                  onBlur={() => setTip(null)}
                />
              </g>
            ))}
          </g>
        ))}
      </svg>
      {tip && (
        <div
          class="chart-tip"
          role="status"
          style={{
            left: `${Math.min(Math.max(tip.x, 90), width - 90)}px`,
            top: `${tip.y}px`,
          }}
        >
          <strong>{formatGrade(tip.grade)}/10</strong>
          <span>{tip.subject}</span>
          <span class="muted">
            {tip.title} · {shortDate(tip.due)}
          </span>
        </div>
      )}
      <ul class="chart-legend">
        {series.map((s) => (
          <li key={s.subjectId ?? 'none'} style={{ '--c': `var(--series-${(s.colorIndex % 8) + 1})` }}>
            <span class="legend-swatch" aria-hidden="true" />
            <span>{s.name}</span>
            <span class="muted">{tr('rd.average', { avg: formatGrade(Math.round(s.average * 100) / 100) })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
