import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { calendars, scheduleData, scheduleSettings } from '../lib/data';
import { planWeek, weekStart, type Block } from '../engine/schedule';
import { addDays, localDate, MINUTE } from '../../../supabase/functions/_shared/tz.ts';
import { hourMarks, Timeline, WEEK_PX_PER_MIN } from './Timeline';
import { EventDialog } from './EventDialog';
import { EntryDialog } from './EntryDialog';
import { dayLabel, durationLabel, shortDate, timeLabel, weekdayDay } from './format';
import { selectedDate, setViewMode, SyncBar, useNow } from './planner';

const MAX_NOTES = 2;

export function WeekView() {
  const tr = t.value;
  const now = useNow();
  const s = scheduleSettings.value;
  const today = localDate(now, s.tz);
  const anchor = selectedDate.value ?? today;
  const [selected, setSelected] = useState<Block | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const week = useMemo(() => planWeek(anchor, scheduleData.value, s, now), [anchor, scheduleData.value, s, now]);
  const end = addDays(week.start, 6);
  const isThisWeek = week.start === weekStart(today);

  /** Keep "today" as null so the view follows the clock past midnight. */
  const show = (date: string) => (selectedDate.value = date === today ? null : date);
  const openDay = (date: string) => {
    show(date);
    setViewMode('day');
  };

  // On narrow screens the grid scrolls sideways: bring today (or Monday) into view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('.week-head.today');
    const axis = el.querySelector<HTMLElement>('.week-axis');
    if (!target) {
      el.scrollLeft = 0;
      return;
    }
    const offset = target.getBoundingClientRect().left - el.getBoundingClientRect().left - (axis?.offsetWidth ?? 0);
    el.scrollLeft = Math.max(el.scrollLeft + offset, 0);
  }, [week.start]);

  const first = week.days[0]!;
  const longest = week.longestFree;
  const longestDay = longest ? localDate(longest.startMs, s.tz) : null;
  const range = { start: shortDate(week.start), end: shortDate(end) };

  return (
    <div class="stack">
      <div class="day-bar">
        <div class="segmented" role="group" aria-label={tr('view.week')}>
          <button type="button" class="btn" aria-label={tr('week.prev')} onClick={() => show(addDays(week.start, -7))}>
            ‹
          </button>
          <button type="button" class="btn" aria-pressed={isThisWeek} onClick={() => (selectedDate.value = null)}>
            {tr('week.this')}
          </button>
          <button type="button" class="btn" aria-label={tr('week.next')} onClick={() => show(addDays(week.start, 7))}>
            ›
          </button>
        </div>
        <label class="field inline">
          <span class="sr-only">{tr('day.date')}</span>
          <input
            type="date"
            value={anchor}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v) show(v);
            }}
          />
        </label>
      </div>

      <SyncBar tz={s.tz} />

      <h2 class="day-title week-title">{tr('week.title', range)}</h2>

      <div class="tiles">
        <div class="tile free">
          <span class="tile-label">{tr('week.free')}</span>
          <span class="tile-value">{durationLabel(week.freeTotalMin)}</span>
        </div>
        <div class="tile">
          <span class="tile-label">{tr('week.busy')}</span>
          <span class="tile-value">{durationLabel(week.busyTotalMin)}</span>
        </div>
        <div class="tile">
          <span class="tile-label">{tr('week.longest')}</span>
          <span class="tile-value">{longest ? durationLabel((longest.endMs - longest.startMs) / MINUTE) : '—'}</span>
          <span class="tile-sub">
            {longest && longestDay
              ? tr('week.longestWhen', {
                  day: `${weekdayDay(longestDay).weekday} ${weekdayDay(longestDay).day}`,
                  start: timeLabel(longest.startMs, s.tz),
                  end: timeLabel(longest.endMs, s.tz),
                })
              : tr('tiles.none')}
          </span>
        </div>
      </div>

      {calendars.value.length === 0 && <p class="notice">{tr('day.noCalendars')}</p>}

      <section class="card stack week-card" aria-labelledby="week-h">
        <h2 id="week-h" class="sr-only">
          {tr('week.label', range)}
        </h2>
        <p class="muted small">{tr('week.hint')}</p>
        <div class="week-scroll" ref={scroller}>
          <div class="week-grid">
            <div class="week-corner" aria-hidden="true" />
            {week.days.map((d) => {
              const { weekday, day } = weekdayDay(d.date);
              const isToday = d.date === today;
              const extra = d.notes.length - MAX_NOTES;
              return (
                <div key={`h${d.date}`} class={isToday ? 'week-head today' : 'week-head'}>
                  <button
                    type="button"
                    class="week-day-btn"
                    aria-label={tr('week.openDay', { day: dayLabel(d.date) })}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => openDay(d.date)}
                  >
                    <span class="week-wd">{weekday}</span>
                    <span class="week-num">{day}</span>
                    <span class="week-free">{tr('week.dayFree', { d: durationLabel(d.freeTotalMin) })}</span>
                  </button>
                  {d.practicasBlocked && <span class="badge">{tr(`week.blocked.${d.practicasBlocked}`)}</span>}
                  {d.notes.length > 0 && (
                    <ul class="week-notes">
                      {d.notes.slice(0, MAX_NOTES).map((n) => (
                        <li key={`${n.eventId}`} class="chip" style={{ '--cal': n.color ?? 'var(--accent)' }} title={n.title}>
                          <span>{n.title}</span>
                        </li>
                      ))}
                      {extra > 0 && <li class="muted small">{tr('week.more', { n: extra })}</li>}
                    </ul>
                  )}
                </div>
              );
            })}

            <div class="week-axis" aria-hidden="true" style={{ height: `${((first.displayEndMs - first.displayStartMs) / MINUTE) * WEEK_PX_PER_MIN}px` }}>
              {hourMarks(first)
                .filter((_, i) => i % 2 === 0)
                .map((ms) => (
                  <span key={ms} style={{ top: `${((ms - first.displayStartMs) / MINUTE) * WEEK_PX_PER_MIN}px` }}>
                    {timeLabel(ms, s.tz)}
                  </span>
                ))}
            </div>
            {week.days.map((d) => (
              <div key={`t${d.date}`} class={d.date === today ? 'week-col today' : 'week-col'}>
                <Timeline plan={d} tz={s.tz} onSelect={setSelected} compact label={dayLabel(d.date)} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {selected &&
        (selected.entryId ? (
          <EntryDialog entryId={selected.entryId} tz={s.tz} onClose={() => setSelected(null)} />
        ) : (
          <EventDialog block={selected} tz={s.tz} onClose={() => setSelected(null)} />
        ))}
    </div>
  );
}
