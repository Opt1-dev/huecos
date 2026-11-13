import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import type { Block } from '../engine/schedule';
import { clearOverride, overrides, setOverride } from '../lib/data';
import { online } from '../lib/session';
import { localDate, minutesSinceMidnight, zonedToUtc } from '../../../supabase/functions/_shared/tz.ts';
import { errorText, minutesToInput, parseTimeInput } from './format';

interface Props {
  block: Block;
  tz: string;
  onClose: () => void;
}

export function EventDialog({ block, tz, onClose }: Props) {
  const tr = t.value;
  const ref = useRef<HTMLDialogElement>(null);
  const [start, setStart] = useState(minutesToInput(minutesSinceMidnight(block.startMs, tz)));
  const [end, setEnd] = useState(minutesToInput(minutesSinceMidnight(block.endMs, tz)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasOverride = overrides.value.some((o) => o.event_id === block.eventId);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function move(e: Event) {
    e.preventDefault();
    const a = parseTimeInput(start);
    const b = parseTimeInput(end);
    if (a === null || b === null) return;
    const day = localDate(block.startMs, tz);
    const startMs = zonedToUtc(day, a, tz);
    // An end earlier than the start means the next day (shift after midnight).
    const endMs = zonedToUtc(day, b <= a ? b + 1440 : b, tz);
    void act(() =>
      setOverride(block.eventId!, { start_at: new Date(startMs).toISOString(), end_at: new Date(endMs).toISOString(), cancelled: false }),
    );
  }

  return (
    <dialog ref={ref} class="dialog" aria-labelledby="ev-title" onClose={onClose}>
      <form class="stack" onSubmit={move}>
        <h2 id="ev-title">{tr('event.title')}</h2>
        <p>
          <strong>{block.title}</strong>
        </p>
        <p class="muted small">{tr('event.note')}</p>
        <div class="grid-form">
          <label class="field">
            <span>{tr('event.start')}</span>
            <input type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} required />
          </label>
          <label class="field">
            <span>{tr('event.end')}</span>
            <input type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} required />
          </label>
        </div>
        <p role="status" aria-live="polite" class="error small">
          {error ?? ''}
        </p>
        <div class="actions">
          <button type="submit" class="btn primary" disabled={busy || !online.value}>
            {tr('event.move')}
          </button>
          <button
            type="button"
            class="btn danger"
            disabled={busy || !online.value}
            onClick={() => void act(() => setOverride(block.eventId!, { start_at: null, end_at: null, cancelled: true }))}
          >
            {tr('event.cancelEvent')}
          </button>
          {hasOverride && (
            <button type="button" class="btn" disabled={busy || !online.value} onClick={() => void act(() => clearOverride(block.eventId!))}>
              {tr('event.reset')}
            </button>
          )}
          <button type="button" class="btn ghost" onClick={() => ref.current?.close()}>
            {tr('common.close')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
