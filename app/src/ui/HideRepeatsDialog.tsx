import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { setHiddenTitles, type CalendarRow } from '../lib/data';
import type { RepeatedTitle } from '../lib/repeats';
import { online } from '../lib/session';
import { errorText } from './format';

interface Props {
  cal: CalendarRow;
  candidates: RepeatedTitle[];
  /** Called with the number of titles hidden (0 = nothing hidden). */
  onClose: (hidden: number) => void;
}

/** Asks which repeated event titles of a calendar to hide (days off, holidays…). */
export function HideRepeatsDialog({ cal, candidates, onClose }: Props) {
  const tr = t.value;
  const ref = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter((c) => c.suggested).map((c) => c.title)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(0);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function toggle(title: string, on: boolean) {
    const next = new Set(picked);
    if (on) next.add(title);
    else next.delete(title);
    setPicked(next);
  }

  function hide() {
    setBusy(true);
    setError(null);
    setHiddenTitles(cal.id, [...(cal.hidden_titles ?? []), ...picked])
      .then(() => {
        done.current = picked.size;
        ref.current?.close();
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  }

  return (
    <dialog ref={ref} class="dialog" aria-labelledby="hide-title" onClose={() => onClose(done.current)}>
      <div class="stack">
        <h2 id="hide-title">{tr('hide.title')}</h2>
        <p class="muted small">{tr('hide.intro', { name: cal.name })}</p>
        <ul class="hide-list">
          {candidates.map((c) => (
            <li key={c.title}>
              <label class="check">
                <input type="checkbox" checked={picked.has(c.title)} onChange={(e) => toggle(c.title, (e.target as HTMLInputElement).checked)} />
                <span>
                  {c.title}
                  <span class="muted small">
                    {' · '}
                    {tr('hide.count', { n: c.count })}
                    {c.allDay && ` · ${tr('hide.allDay')}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" class="error small">
            {error}
          </p>
        )}
        <div class="actions">
          <button type="button" class="btn primary" disabled={busy || !online.value || picked.size === 0} onClick={hide}>
            {tr('hide.confirm')}
          </button>
          <button type="button" class="btn ghost" onClick={() => ref.current?.close()}>
            {tr('hide.skip')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
