import { useState } from 'preact/hooks';
import { t, type MessageKey } from '../i18n';
import {
  addBlockedDays,
  addCalendar,
  addEntry,
  blockedDays,
  calendarTitles,
  calendars,
  deleteBlockedDay,
  deleteCalendar,
  deleteEntry,
  entries,
  saveFeed,
  scheduleSettings,
  setHiddenTitles,
  settingsRow,
  syncNow,
  updateCalendar,
  updateEntry,
  updateSettings,
  type CalendarInput,
  type CalendarPatch,
  type CalendarRow,
} from '../lib/data';
import { online } from '../lib/session';
import { parseBlockedDays } from '../lib/blocked';
import { repeatedTitles, type RepeatedTitle } from '../lib/repeats';
import { HideRepeatsDialog } from './HideRepeatsDialog';
import { loggedPerDay, practicasHours, type Role } from '../engine/schedule';
import { localDate } from '../../../supabase/functions/_shared/tz.ts';
import { LanguagePicker } from './LanguagePicker';
import { AccountSettings, SignupLinkSettings } from './AccountSettings';
import { EntryForm, entrySummary } from './EntryForm';
import { dayLabel, errorText, feedErrorMessage, minutesToInput, parseTimeInput, timeLabel, weekdayShort } from './format';

const ROLES: Role[] = ['work', 'school', 'gym', 'activity', 'deadlines', 'main', 'practicas', 'other'];
const ROLE_DEFAULTS: Record<Role, Pick<CalendarInput, 'buffer_before_min' | 'buffer_after_min' | 'counts_busy' | 'color'>> = {
  work: { buffer_before_min: 75, buffer_after_min: 0, counts_busy: true, color: '#e3a008' },
  school: { buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, color: '#8b5cf6' },
  gym: { buffer_before_min: 30, buffer_after_min: 30, counts_busy: true, color: '#10b981' },
  activity: { buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, color: '#ec4899' },
  deadlines: { buffer_before_min: 0, buffer_after_min: 0, counts_busy: false, color: '#ef4444' },
  main: { buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, color: '#5b8def' },
  practicas: { buffer_before_min: 45, buffer_after_min: 75, counts_busy: true, color: '#0ea5e9' },
  other: { buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, color: '#64748b' },
};

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<string | null | void>) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ ok: true, text });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, setMessage, run };
}

function Status({ message }: { message: { ok: boolean; text: string } | null }) {
  return (
    <p role="status" aria-live="polite" class={message && !message.ok ? 'error small' : 'muted small'}>
      {message?.text ?? ''}
    </p>
  );
}

/** Hours typed in a field → whole minutes, clamped. */
function hoursToMinutes(e: Event, min: number, max: number): number {
  const h = Number((e.target as HTMLInputElement).value.replace(',', '.'));
  return Math.min(max, Math.max(min, Math.round((Number.isFinite(h) ? h : 0) * 60)));
}

function numberValue(e: Event): number {
  return Number((e.target as HTMLInputElement).value);
}

// ---------------------------------------------------------------------------
function GeneralSettings() {
  const tr = t.value;
  const s = settingsRow.value;
  const { busy, message, run } = useBusy();
  const [tz, setTz] = useState(s?.timezone ?? 'Europe/Madrid');
  const [start, setStart] = useState(minutesToInput(s?.day_start_min ?? 480));
  const [end, setEnd] = useState(s?.day_end_min === 1440 || !s ? '00:00' : minutesToInput(s.day_end_min));
  const [minSlot, setMinSlot] = useState(s?.min_slot_min ?? 15);

  const modules: { key: 'module_practicas' | 'module_etudes' | 'module_outlook'; label: MessageKey }[] = [
    { key: 'module_practicas', label: 'module.practicas' },
    { key: 'module_etudes', label: 'module.etudes' },
    { key: 'module_outlook', label: 'module.outlook' },
  ];

  return (
    <section class="card stack" aria-labelledby="general-h">
      <h2 id="general-h">{tr('settings.general')}</h2>
      <LanguagePicker />
      <form
        class="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          const startMin = parseTimeInput(start);
          const endParsed = parseTimeInput(end);
          const endMin = endParsed === 0 ? 1440 : endParsed;
          void run(async () => {
            if (startMin === null || endMin === null || startMin >= endMin) throw new Error(`${start}–${end}`);
            await updateSettings({ timezone: tz.trim(), day_start_min: startMin, day_end_min: endMin, min_slot_min: minSlot });
            return tr('common.saved');
          });
        }}
      >
        <label class="field">
          <span>{tr('settings.timezone')}</span>
          <input value={tz} onInput={(e) => setTz((e.target as HTMLInputElement).value)} autocomplete="off" />
        </label>
        <label class="field">
          <span>{tr('settings.dayStart')}</span>
          <input type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('settings.dayEnd')}</span>
          <input type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('settings.minSlot')}</span>
          <input type="number" inputMode="numeric" min={5} max={240} value={minSlot} onInput={(e) => setMinSlot(numberValue(e))} />
        </label>
        <button class="btn primary" type="submit" disabled={busy || !online.value}>
          {tr('common.save')}
        </button>
      </form>
      <fieldset class="stack-tight">
        <legend>{tr('settings.modules')}</legend>
        {modules.map((m) => (
          <label key={m.key} class="check">
            <input
              type="checkbox"
              checked={s?.[m.key] ?? false}
              disabled={busy || !online.value}
              onChange={(e) => void run(() => updateSettings({ [m.key]: (e.target as HTMLInputElement).checked }))}
            />
            <span>{tr(m.label)}</span>
          </label>
        ))}
      </fieldset>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function CalendarItem({ cal, defaultOpen = false }: { cal: CalendarRow; defaultOpen?: boolean }) {
  const tr = t.value;
  const tz = scheduleSettings.value.tz;
  const { busy, message, setMessage, run } = useBusy();
  const [feed, setFeed] = useState('');
  const [candidates, setCandidates] = useState<RepeatedTitle[] | null>(null);
  const save = (patch: CalendarPatch) => void run(() => updateCalendar(cal.id, patch));
  const hidden = cal.hidden_titles ?? [];
  const summary = [
    tr(`role.${cal.role}` as MessageKey),
    cal.source === 'manual'
      ? tr('cal.summaryManual', { n: entries.value.filter((e) => e.calendar_id === cal.id).length })
      : cal.feed_host
        ? tr('cal.feedHost', { host: cal.feed_host })
        : tr('cal.noFeed'),
  ].join(' · ');

  /** Opens the "hide repeated events?" dialog when some titles repeat. */
  async function lookForRepeats(): Promise<number> {
    const found = repeatedTitles(await calendarTitles(cal.id), hidden);
    if (found.length > 0) setCandidates(found);
    return found.length;
  }

  return (
    <li class="cal-item" style={{ '--cal': cal.color }}>
      <details class="cal-details" open={defaultOpen}>
        <summary class="cal-summary">
          <span class="cal-dot" aria-hidden="true" />
          <span class="cal-summary-text">
            <strong>{cal.name}</strong>
            <span class="muted small">{summary}</span>
          </span>
          {cal.last_error && (
            <span class="badge warn" title={tr('cal.lastError', { code: cal.last_error })}>⚠ {cal.last_error}</span>
          )}
        </summary>
        <div class="cal-body stack-tight">
          <div class="grid-form">
            <label class="field">
              <span>{tr('cal.name')}</span>
              <input
                value={cal.name}
                maxLength={60}
                onChange={(e) => save({ name: (e.target as HTMLInputElement).value.trim() || cal.name })}
              />
            </label>
            <label class="field">
              <span>{tr('cal.role')}</span>
              <select value={cal.role} onChange={(e) => save({ role: (e.target as HTMLSelectElement).value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tr(`role.${r}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>{tr('cal.color')}</span>
              <input type="color" value={cal.color} onChange={(e) => save({ color: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="field">
              <span>{tr('cal.before')}</span>
              <input type="number" inputMode="numeric" min={0} max={240} value={cal.buffer_before_min} onChange={(e) => save({ buffer_before_min: numberValue(e) })} />
            </label>
            <label class="field">
              <span>{tr('cal.after')}</span>
              <input type="number" inputMode="numeric" min={0} max={240} value={cal.buffer_after_min} onChange={(e) => save({ buffer_after_min: numberValue(e) })} />
            </label>
            <label class="check">
              <input type="checkbox" checked={cal.counts_busy} onChange={(e) => save({ counts_busy: (e.target as HTMLInputElement).checked })} />
              <span>{tr('cal.countsBusy')}</span>
            </label>
            {cal.source === 'feed' && (
              <>
                <label class="field">
                  <span>{tr('cal.work')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={0.5}
                    value={(cal.deadline_work_min ?? 0) / 60}
                    onChange={(e) => save({ deadline_work_min: hoursToMinutes(e, 0, 6000) })}
                  />
                </label>
                <label class="field">
                  <span>{tr('cal.workMax')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.25}
                    max={16}
                    step={0.5}
                    value={(cal.deadline_daily_max_min ?? 120) / 60}
                    disabled={!cal.deadline_work_min}
                    onChange={(e) => save({ deadline_daily_max_min: hoursToMinutes(e, 15, 960) })}
                  />
                </label>
                <p class="muted small span-all">{tr('cal.workHelp')}</p>
              </>
            )}
          </div>

          {cal.source === 'manual' ? (
            <ManualEntries cal={cal} />
          ) : (
            <>
              <form
                class="feed-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const { error } = await saveFeed(cal.id, feed);
                    if (error) {
                      setMessage({ ok: false, text: feedErrorMessage(error) });
                      return null;
                    }
                    setFeed('');
                    await syncNow();
                    await lookForRepeats();
                    return tr('cal.feedOk', { host: calendars.value.find((c) => c.id === cal.id)?.feed_host ?? '' });
                  });
                }}
              >
                <label class="field">
                  <span>{tr('cal.feed')}</span>
                  <input
                    type="password"
                    autocomplete="off"
                    spellcheck={false}
                    placeholder={cal.feed_host ? tr('cal.feedHost', { host: cal.feed_host }) : 'https://…/basic.ics'}
                    value={feed}
                    onInput={(e) => setFeed((e.target as HTMLInputElement).value)}
                    required
                  />
                </label>
                <button class="btn" type="submit" disabled={busy || !online.value || !feed.trim()}>
                  {busy ? tr('cal.feedSaving') : tr('cal.feedSave')}
                </button>
              </form>
              <p class="muted small">
                {cal.feed_host ? tr('cal.feedHost', { host: cal.feed_host }) : tr('cal.noFeed')}
                {cal.last_synced_at && ` · ${tr('cal.lastSync', { time: timeLabel(Date.parse(cal.last_synced_at), tz) })}`}
                {cal.last_error && <span class="error"> · {tr('cal.lastError', { code: cal.last_error })}</span>}
              </p>
              <p class="muted small">{tr('cal.feedHelp')}</p>
              <div class="stack-tight">
                <h3 class="small">{tr('hide.hidden')}</h3>
                {hidden.length === 0 ? (
                  <p class="muted small">{tr('hide.noneHidden')}</p>
                ) : (
                  <ul class="chip-list">
                    {hidden.map((h) => (
                      <li key={h} class="chip">
                        <span>{h}</span>
                        <button
                          type="button"
                          class="chip-x"
                          aria-label={tr('hide.show', { title: h })}
                          title={tr('hide.show', { title: h })}
                          disabled={busy || !online.value}
                          onClick={() => void run(() => setHiddenTitles(cal.id, hidden.filter((x) => x !== h)))}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {cal.feed_host && (
                  <button
                    type="button"
                    class="btn"
                    disabled={busy || !online.value}
                    onClick={() => void run(async () => ((await lookForRepeats()) > 0 ? null : tr('hide.nothing')))}
                  >
                    {busy ? tr('hide.searching') : tr('hide.search')}
                  </button>
                )}
              </div>
              {candidates && (
                <HideRepeatsDialog
                  cal={cal}
                  candidates={candidates}
                  onClose={(n) => {
                    setCandidates(null);
                    if (n > 0) setMessage({ ok: true, text: tr('hide.done', { n }) });
                  }}
                />
              )}
            </>
          )}
          <Status message={message} />
          <button
            type="button"
            class="btn danger"
            disabled={busy || !online.value}
            onClick={() => {
              if (confirm(tr('cal.confirmDelete', { name: cal.name }))) void run(() => deleteCalendar(cal.id));
            }}
          >
            {tr('common.delete')}
          </button>
        </div>
      </details>
    </li>
  );
}

function ManualEntries({ cal }: { cal: CalendarRow }) {
  const tr = t.value;
  const tz = scheduleSettings.value.tz;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { busy, message, run } = useBusy();
  const list = entries.value.filter((e) => e.calendar_id === cal.id);

  return (
    <div class="stack-tight">
      <p class="muted small">{tr('cal.manual')}</p>
      <h3 class="small">{tr('entry.title')}</h3>
      {list.length === 0 ? (
        <p class="muted small">{tr('entry.empty')}</p>
      ) : (
        <ul class="entry-list">
          {list.map((e) =>
            editing === e.id ? (
              <li key={e.id} class="entry-item editing">
                <EntryForm
                  tz={tz}
                  initial={e}
                  submitLabel={tr('common.save')}
                  onSubmit={async (fields) => {
                    await updateEntry(e.id, fields);
                    setEditing(null);
                  }}
                >
                  <button type="button" class="btn ghost" onClick={() => setEditing(null)}>
                    {tr('common.cancel')}
                  </button>
                </EntryForm>
              </li>
            ) : (
              <li key={e.id} class="entry-item">
                <div class="entry-text">
                  <strong>{e.title}</strong>
                  <span class="muted small">{entrySummary(e)}</span>
                </div>
                <div class="actions">
                  <button type="button" class="btn small-btn" onClick={() => setEditing(e.id)}>
                    {tr('entry.edit')}
                  </button>
                  <button
                    type="button"
                    class="btn small-btn danger"
                    disabled={busy || !online.value}
                    onClick={() => {
                      if (confirm(tr('entry.confirmDelete', { name: e.title }))) void run(() => deleteEntry(e.id));
                    }}
                  >
                    {tr('common.delete')}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {adding ? (
        <div class="entry-new">
          <h3 class="small">{tr('entry.add')}</h3>
          <EntryForm tz={tz} submitLabel={tr('entry.add')} onSubmit={(fields) => addEntry(cal.id, fields)}>
            <button type="button" class="btn ghost" onClick={() => setAdding(false)}>
              {tr('common.close')}
            </button>
          </EntryForm>
        </div>
      ) : (
        <button type="button" class="btn" disabled={!online.value} onClick={() => setAdding(true)}>
          + {tr('entry.add')}
        </button>
      )}
      <Status message={message} />
    </div>
  );
}

function CalendarsSettings() {
  const tr = t.value;
  const { busy, message, run } = useBusy();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('work');
  const [source, setSource] = useState<CalendarRow['source']>('feed');
  /** The calendar just added opens, ready for its link or entries. */
  const [added, setAdded] = useState<string | null>(null);

  return (
    <section class="card stack" aria-labelledby="cal-h">
      <h2 id="cal-h">{tr('cal.title')}</h2>
      {calendars.value.length === 0 ? (
        <p class="muted">{tr('cal.empty')}</p>
      ) : (
        <ul class="cal-list">
          {calendars.value.map((c) => (
            <CalendarItem key={c.id} cal={c} defaultOpen={c.id === added} />
          ))}
        </ul>
      )}
      <details class="cal-add" open={calendars.value.length === 0}>
        <summary>+ {tr('cal.add')}</summary>
        <form
          class="grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const cal = await addCalendar({ name: name.trim(), role, source, ...ROLE_DEFAULTS[role] });
              setAdded(cal.id);
              setName('');
            });
          }}
        >
          <label class="field">
            <span>{tr('cal.name')}</span>
            <input value={name} maxLength={60} required onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>{tr('cal.role')}</span>
            <select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {tr(`role.${r}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <fieldset class="span-all stack-tight">
            <legend>{tr('cal.source')}</legend>
            <label class="check">
              <input type="radio" name="cal-source" checked={source === 'feed'} onChange={() => setSource('feed')} />
              <span>{tr('cal.sourceFeed')}</span>
            </label>
            <label class="check">
              <input type="radio" name="cal-source" checked={source === 'manual'} onChange={() => setSource('manual')} />
              <span>{tr('cal.sourceManual')}</span>
            </label>
          </fieldset>
          <button class="btn primary" type="submit" disabled={busy || !online.value || !name.trim()}>
            {tr('cal.add')}
          </button>
        </form>
      </details>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function PracticasSettings() {
  const tr = t.value;
  const s = settingsRow.value;
  const { busy, message, run } = useBusy();
  const [startDate, setStartDate] = useState(s?.practicas_start ?? '2026-10-01');
  // Empty end date = computed from the target hours.
  const [endDate, setEndDate] = useState(s?.practicas_end ?? '');
  const [days, setDays] = useState<number[]>(s?.practicas_weekdays ?? [1, 2, 3, 4, 5]);
  const [from, setFrom] = useState(minutesToInput(s?.practicas_start_min ?? 540));
  const [to, setTo] = useState(minutesToInput(s?.practicas_end_min ?? 780));
  const [before, setBefore] = useState(s?.practicas_buffer_before_min ?? 45);
  const [after, setAfter] = useState(s?.practicas_buffer_after_min ?? 75);
  const [total, setTotal] = useState(s?.practicas_total_hours ?? 500);
  const [factor, setFactor] = useState(String(s?.practicas_hour_factor ?? 1));
  if (!s?.module_practicas) return null;

  const hours = practicasHours(scheduleSettings.value, localDate(Date.now(), scheduleSettings.value.tz));
  return (
    <section class="card stack" aria-labelledby="pr-h">
      <h2 id="pr-h">{tr('pr.title')}</h2>
      <p>
        <progress max={hours.target} value={Math.min(hours.done, hours.target)} aria-label={tr('pr.title')} />{' '}
        <span class="small">{tr('pr.progress', { done: hours.done, target: hours.target, planned: hours.planned })}</span>
      </p>
      {hours.end && (
        <p class="small">
          <strong>{tr(s.practicas_end ? 'pr.fixedEnd' : 'pr.projectedEnd', { date: dayLabel(hours.end) })}</strong>
          {s.practicas_end && hours.planned < hours.target && (
            <span class="warn-text"> · {tr('pr.short', { missing: hours.target - hours.planned })}</span>
          )}
        </p>
      )}
      <form
        class="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          const a = parseTimeInput(from);
          const b = parseTimeInput(to);
          const f = Number(factor.replace(',', '.'));
          void run(async () => {
            if (a === null || b === null || a >= b) throw new Error(`${from}–${to}`);
            if (!Number.isFinite(f) || f < 0.5 || f > 3) throw new Error(factor);
            await updateSettings({
              practicas_start: startDate || null,
              practicas_end: endDate || null,
              practicas_weekdays: [...days].sort(),
              practicas_start_min: a,
              practicas_end_min: b,
              practicas_buffer_before_min: before,
              practicas_buffer_after_min: after,
              practicas_total_hours: total,
              practicas_hour_factor: Math.round(f * 100) / 100,
            });
            return tr('common.saved');
          });
        }}
      >
        <label class="field">
          <span>{tr('pr.start')}</span>
          <input type="date" value={startDate} onInput={(e) => setStartDate((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('pr.end')}</span>
          <input
            type="date"
            value={endDate}
            aria-describedby="pr-end-help"
            onInput={(e) => setEndDate((e.target as HTMLInputElement).value)}
          />
          <span id="pr-end-help" class="muted small">
            {tr('pr.endHelp', { target: total })}
          </span>
        </label>
        <fieldset class="span-all weekdays">
          <legend>{tr('pr.days')}</legend>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} class="check">
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={(e) =>
                  setDays((e.target as HTMLInputElement).checked ? [...days, d] : days.filter((x) => x !== d))
                }
              />
              <span>{weekdayShort(d)}</span>
            </label>
          ))}
        </fieldset>
        <label class="field">
          <span>{tr('pr.from')}</span>
          <input type="time" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('pr.to')}</span>
          <input type="time" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('pr.before')}</span>
          <input type="number" inputMode="numeric" min={0} max={240} value={before} onInput={(e) => setBefore(numberValue(e))} />
        </label>
        <label class="field">
          <span>{tr('pr.after')}</span>
          <input type="number" inputMode="numeric" min={0} max={240} value={after} onInput={(e) => setAfter(numberValue(e))} />
        </label>
        <label class="field">
          <span>{tr('pr.total')}</span>
          <input type="number" inputMode="numeric" min={1} max={5000} value={total} onInput={(e) => setTotal(numberValue(e))} />
        </label>
        <label class="field">
          <span>{tr('pr.factor')}</span>
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            value={factor}
            aria-describedby="pr-factor-help"
            onInput={(e) => setFactor((e.target as HTMLInputElement).value)}
          />
          <span id="pr-factor-help" class="muted small">
            {tr('pr.factorHelp', { worked: (s.practicas_end_min - s.practicas_start_min) / 60, logged: loggedPerDay(scheduleSettings.value) })}
          </span>
        </label>
        <button class="btn primary" type="submit" disabled={busy || !online.value}>
          {tr('common.save')}
        </button>
      </form>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function BlockedDaysSettings() {
  const tr = t.value;
  const { busy, message, run } = useBusy();
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<'non_school' | 'holiday'>('non_school');
  const [bulk, setBulk] = useState('');
  const parsed = parseBlockedDays(bulk);
  if (!settingsRow.value?.module_practicas) return null;

  return (
    <section class="card stack" aria-labelledby="bd-h">
      <h2 id="bd-h">{tr('bd.title')}</h2>
      <p class="muted small">{tr('bd.help')}</p>
      <form
        class="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await addBlockedDays([{ date, kind }]);
            setDate('');
          });
        }}
      >
        <label class="field">
          <span>{tr('bd.date')}</span>
          <input type="date" required value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('bd.kind')}</span>
          <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as typeof kind)}>
            <option value="non_school">{tr('bd.non_school')}</option>
            <option value="holiday">{tr('bd.holiday')}</option>
          </select>
        </label>
        <button class="btn primary" type="submit" disabled={busy || !online.value || !date}>
          {tr('bd.add')}
        </button>
      </form>
      <details>
        <summary>{tr('bd.bulk')}</summary>
        <div class="stack">
          <label class="field">
            <span class="muted small">{tr('bd.bulkHelp')}</span>
            <textarea rows={6} value={bulk} onInput={(e) => setBulk((e.target as HTMLTextAreaElement).value)} />
          </label>
          <button
            type="button"
            class="btn"
            disabled={busy || !online.value || parsed.length === 0}
            onClick={() =>
              void run(async () => {
                await addBlockedDays(parsed);
                setBulk('');
              })
            }
          >
            {tr('bd.import', { n: parsed.length })}
          </button>
        </div>
      </details>
      {blockedDays.value.length === 0 ? (
        <p class="muted">{tr('bd.empty')}</p>
      ) : (
        <ul class="chip-list">
          {blockedDays.value.map((b) => (
            <li key={b.date} class={`chip ${b.kind}`}>
              <span>
                {dayLabel(b.date)} · {tr(b.kind === 'holiday' ? 'bd.holiday' : 'bd.non_school')}
              </span>
              <button
                type="button"
                class="chip-x"
                aria-label={tr('bd.remove', { date: dayLabel(b.date) })}
                disabled={busy || !online.value}
                onClick={() => void run(() => deleteBlockedDay(b.date))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Status message={message} />
    </section>
  );
}

export function SettingsView() {
  return (
    <div class="columns">
      <div class="stack">
        <GeneralSettings key={settingsRow.value?.user_id ?? 'none'} />
        <PracticasSettings key={`pr-${settingsRow.value?.module_practicas}`} />
        <BlockedDaysSettings />
      </div>
      <div class="stack">
        <CalendarsSettings />
        <SignupLinkSettings />
        <AccountSettings />
      </div>
    </div>
  );
}
