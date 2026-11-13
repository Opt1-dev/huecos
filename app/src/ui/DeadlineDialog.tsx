import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { scheduleData, scheduleSettings, setDeadlineDone } from '../lib/data';
import { online } from '../lib/session';
import { deadlineWork } from '../engine/schedule';
import { localDate } from '../../../supabase/functions/_shared/tz.ts';
import { dayLabel, durationLabel, errorText, timeLabel } from './format';

interface Props {
  deadlineId: string;
  onClose: () => void;
}

/** A deadline with planned work: what is booked, what is missing, mark done. */
export function DeadlineDialog({ deadlineId, onClose }: Props) {
  const tr = t.value;
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = scheduleSettings.value;
  const info = useMemo(() => deadlineWork(scheduleData.value, s).deadlines.get(deadlineId), [scheduleData.value, s, deadlineId]);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  if (!info) return null;

  function toggle() {
    setBusy(true);
    setError(null);
    setDeadlineDone(deadlineId, !info!.done)
      .then(() => ref.current?.close())
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  }

  return (
    <dialog ref={ref} class="dialog" aria-labelledby="deadline-title" onClose={onClose}>
      <div class="stack">
        <h2 id="deadline-title">{tr('deadline.title')}</h2>
        <p>
          <strong>{info.title}</strong>
        </p>
        <p class="muted small">
          {tr('deadline.due', { date: `${dayLabel(localDate(info.dueMs, s.tz))} ${timeLabel(info.dueMs, s.tz)}` })}
        </p>
        {info.done ? (
          <p class="small">{tr('deadline.doneNote')}</p>
        ) : (
          <>
            <p class="small">
              {tr('deadline.planned', { planned: durationLabel(info.plannedMin), total: durationLabel(info.totalMin) })}
            </p>
            {info.missingMin > 0 && <p class="notice small">{tr('deadline.missing', { d: durationLabel(info.missingMin) })}</p>}
          </>
        )}
        {error && (
          <p role="alert" class="error small">
            {error}
          </p>
        )}
        <div class="actions">
          <button type="button" class="btn primary" disabled={busy || !online.value} onClick={toggle}>
            {info.done ? tr('deadline.markTodo') : tr('deadline.markDone')}
          </button>
          <button type="button" class="btn ghost" onClick={() => ref.current?.close()}>
            {tr('common.close')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
