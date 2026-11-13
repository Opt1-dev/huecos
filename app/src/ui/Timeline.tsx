import { t } from '../i18n';
import type { Block, DayPlan } from '../engine/schedule';
import { MINUTE } from '../../../supabase/functions/_shared/tz.ts';
import { timeLabel } from './format';

export const PX_PER_MIN = 0.9;
/** Week columns use a smaller scale so the whole 08:00–02:00 range fits on screen. */
export const WEEK_PX_PER_MIN = 0.6;
const KIND_COLORS: Partial<Record<Block['kind'], string>> = { practicas: '#0369a1', focus: '#1d4ed8' };

/** Black or white text, whichever contrasts more with a #rrggbb background. */
export function readableText(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#ffffff';
  const lin = (c: string) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? '#ffffff' : '#111111';
}

interface Props {
  plan: DayPlan;
  tz: string;
  onSelect: (block: Block) => void;
  /** Week column: no hour labels, titles only, smaller scale. */
  compact?: boolean;
  label?: string;
}

function position(plan: DayPlan, b: { startMs: number; endMs: number }, scale: number) {
  const start = Math.max(b.startMs, plan.displayStartMs);
  const end = Math.min(b.endMs, plan.displayEndMs);
  return {
    top: ((start - plan.displayStartMs) / MINUTE) * scale,
    height: Math.max(((end - start) / MINUTE) * scale, 0),
  };
}

/** Hour marks of a day plan, as epoch ms, from display start to display end. */
export function hourMarks(plan: DayPlan): number[] {
  const hours: number[] = [];
  for (let ms = plan.displayStartMs; ms <= plan.displayEndMs; ms += 60 * MINUTE) hours.push(ms);
  return hours;
}

export function Timeline({ plan, tz, onSelect, compact = false, label }: Props) {
  const tr = t.value;
  const scale = compact ? WEEK_PX_PER_MIN : PX_PER_MIN;
  const totalMin = (plan.displayEndMs - plan.displayStartMs) / MINUTE;
  const midnight = plan.windowEndMs;

  return (
    <div
      class={compact ? 'timeline compact' : 'timeline'}
      role="group"
      aria-label={label ?? tr('timeline.label')}
      style={{ height: `${totalMin * scale}px` }}
    >
      {hourMarks(plan).map((ms) => (
        <div key={ms} class="hour" style={{ top: `${((ms - plan.displayStartMs) / MINUTE) * scale}px` }} aria-hidden="true">
          {!compact && <span>{timeLabel(ms, tz)}</span>}
        </div>
      ))}
      <div
        class="after-midnight"
        aria-hidden="true"
        style={{ top: `${((midnight - plan.displayStartMs) / MINUTE) * scale}px`, bottom: 0 }}
      />

      {plan.free.map((f) => {
        const p = position(plan, f, scale);
        return (
          <div
            key={`f${f.startMs}`}
            class="block free"
            style={{ top: `${p.top}px`, height: `${p.height}px` }}
            role="img"
            aria-label={tr('timeline.free', { start: timeLabel(f.startMs, tz), end: timeLabel(f.endMs, tz) })}
          />
        );
      })}

      {plan.buffers.map((b) => {
        const p = position(plan, b, scale);
        return (
          <div key={`b${b.startMs}`} class="block buffer" style={{ top: `${p.top}px`, height: `${p.height}px` }}>
            {!compact && p.height >= 14 && <span>{tr('timeline.buffer')}</span>}
          </div>
        );
      })}

      {plan.busy.map((b) => {
        const p = position(plan, b, scale);
        if (p.height <= 0) return null;
        const label = [
          b.kind === 'focus' ? tr('timeline.study') : null,
          b.title,
          b.moved ? `(${tr('timeline.moved')})` : null,
          b.autoPlaced ? `(${tr('timeline.auto')})` : null,
        ]
          .filter(Boolean)
          .join(' ');
        const time = `${timeLabel(b.startMs, tz)}–${timeLabel(b.endMs, tz)}`;
        const content = compact ? (
          <span class="block-title">{label}</span>
        ) : (
          <>
            <span class="block-time">{time}</span> <span class="block-title">{label}</span>
          </>
        );
        const color = b.color ?? KIND_COLORS[b.kind] ?? '#1d4ed8';
        const style = {
          top: `${p.top}px`,
          height: `${Math.max(p.height, compact ? 12 : 18)}px`,
          '--cal': color,
          '--busy-text': readableText(color),
        };
        return b.eventId ? (
          <button
            key={`e${b.eventId}`}
            type="button"
            class={`block busy ${b.kind}`}
            style={style}
            title={`${time} ${label}`}
            aria-label={`${tr('timeline.edit', { title: label })}, ${time}`}
            onClick={() => onSelect(b)}
          >
            {content}
          </button>
        ) : (
          <div
            key={`${b.kind}${b.taskId ?? ''}${b.startMs}`}
            class={`block busy ${b.kind}`}
            style={style}
            title={`${time} ${label}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
