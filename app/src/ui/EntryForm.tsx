import { useState } from 'preact/hooks';
import { t } from '../i18n';
import type { EntryFields, EntryRow } from '../lib/data';
import { online } from '../lib/session';
import { isoWeekday, localDate } from '../../../supabase/functions/_shared/tz.ts';
import { dayLabel, minutesToInput, parseTimeInput, shortDate, weekdayShort } from './format';

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const WORKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && b.every((d) => a.includes(d));

/** "Tous les jours", "Lun–ven", "lun., mer., ven." … */
export function weekdaysLabel(days: readonly number[]): string {
  const tr = t.value;
  if (same(days, ALL_DAYS)) return tr('entry.everyDay');
  if (same(days, WORKDAYS)) return tr('entry.workdays');
  if (same(days, WEEKEND)) return tr('entry.weekend');
  return [...days].sort().map(weekdayShort).join(', ');
}

/** One line describing when an entry happens. */
export function entrySummary(e: Pick<EntryRow, 'start_min' | 'end_min' | 'weekdays' | 'start_date' | 'end_date'>): string {
  const tr = t.value;
  const time = `${minutesToInput(e.start_min)}–${e.end_min === 1440 ? '00:00' : minutesToInput(e.end_min)}`;
  if (e.end_date === e.start_date) return `${dayLabel(e.start_date)} · ${time}`;
  const dates = e.end_date
    ? tr('entry.range', { start: shortDate(e.start_date), end: shortDate(e.end_date) })
    : tr('entry.since', { date: shortDate(e.start_date) });
  return `${weekdaysLabel(e.weekdays)} · ${time} · ${dates}`;
}

interface Props {
  tz: string;
  initial?: EntryRow;
  submitLabel: string;
  onSubmit: (fields: EntryFields) => Promise<void>;
  /** Extra buttons next to submit (cancel, delete). */
  children?: preact.ComponentChildren;
}

export function EntryForm({ tz, initial, submitLabel, onSubmit, children }: Props) {
  const tr = t.value;
  const today = localDate(Date.now(), tz);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [start, setStart] = useState(minutesToInput(initial?.start_min ?? 18 * 60));
  const [end, setEnd] = useState(initial ? (initial.end_min === 1440 ? '00:00' : minutesToInput(initial.end_min)) : '19:00');
  const [once, setOnce] = useState(initial ? initial.start_date === initial.end_date : false);
  const [days, setDays] = useState<number[]>(initial && initial.start_date !== initial.end_date ? [...initial.weekdays] : [...WORKDAYS]);
  const [date, setDate] = useState(initial?.start_date ?? today);
  const [from, setFrom] = useState(initial?.start_date ?? today);
  const [until, setUntil] = useState(initial && initial.end_date !== initial.start_date ? (initial.end_date ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(e: Event) {
    e.preventDefault();
    const startMin = parseTimeInput(start);
    const parsedEnd = parseTimeInput(end);
    // 00:00 as an end time means midnight at the end of the day.
    const endMin = parsedEnd === 0 ? 1440 : parsedEnd;
    if (startMin === null || endMin === null || endMin <= startMin) return setError(tr('entry.errTime'));
    if (!once && days.length === 0) return setError(tr('entry.errDays'));
    if (!once && until && until < from) return setError(tr('entry.errDates'));
    const fields: EntryFields = once
      ? { title: title.trim(), start_min: startMin, end_min: endMin, weekdays: [isoWeekday(date)], start_date: date, end_date: date }
      : {
          title: title.trim(),
          start_min: startMin,
          end_min: endMin,
          weekdays: [...days].sort(),
          start_date: from,
          end_date: until || null,
        };
    setBusy(true);
    setError(null);
    onSubmit(fields)
      .then(() => {
        if (!initial) setTitle('');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  const toggle = (d: number, on: boolean) => setDays(on ? [...days, d] : days.filter((x) => x !== d));

  return (
    <form class="grid-form entry-form" onSubmit={submit}>
      <label class="field span-all">
        <span>{tr('entry.name')}</span>
        <input value={title} maxLength={200} required onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span>{tr('entry.start')}</span>
        <input type="time" value={start} required onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span>{tr('entry.end')}</span>
        <input type="time" value={end} required onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />
      </label>

      <fieldset class="span-all stack-tight">
        <legend>{tr('entry.repeat')}</legend>
        <div class="weekdays">
          <label class="check">
            <input type="radio" name={`repeat-${initial?.id ?? 'new'}`} checked={!once} onChange={() => setOnce(false)} />
            <span>{tr('entry.weekly')}</span>
          </label>
          <label class="check">
            <input type="radio" name={`repeat-${initial?.id ?? 'new'}`} checked={once} onChange={() => setOnce(true)} />
            <span>{tr('entry.once')}</span>
          </label>
        </div>
      </fieldset>

      {once ? (
        <label class="field">
          <span>{tr('entry.date')}</span>
          <input type="date" value={date} required onInput={(e) => setDate((e.target as HTMLInputElement).value || date)} />
        </label>
      ) : (
        <>
          <fieldset class="span-all stack-tight">
            <legend>{tr('entry.days')}</legend>
            <div class="segmented" role="group" aria-label={tr('entry.days')}>
              {[
                { label: tr('entry.everyDay'), set: ALL_DAYS },
                { label: tr('entry.workdays'), set: WORKDAYS },
                { label: tr('entry.weekend'), set: WEEKEND },
              ].map((p) => (
                <button key={p.label} type="button" class="btn small-btn" aria-pressed={same(days, p.set)} onClick={() => setDays([...p.set])}>
                  {p.label}
                </button>
              ))}
            </div>
            <div class="weekdays">
              {ALL_DAYS.map((d) => (
                <label key={d} class="check">
                  <input type="checkbox" checked={days.includes(d)} onChange={(e) => toggle(d, (e.target as HTMLInputElement).checked)} />
                  <span>{weekdayShort(d)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label class="field">
            <span>{tr('entry.from')}</span>
            <input type="date" value={from} required onInput={(e) => setFrom((e.target as HTMLInputElement).value || from)} />
          </label>
          <label class="field">
            <span>{tr('entry.until')}</span>
            <input type="date" value={until} min={from} onInput={(e) => setUntil((e.target as HTMLInputElement).value)} />
          </label>
        </>
      )}

      <p role="status" aria-live="polite" class="error small span-all">
        {error ?? ''}
      </p>
      <div class="actions span-all">
        <button type="submit" class="btn primary" disabled={busy || !online.value || !title.trim()}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}
