import { useMemo, useState } from 'preact/hooks';
import { t } from '../i18n';
import { calendars, loaded, scheduleData, scheduleSettings, tasks, clearOverride } from '../lib/data';
import { online } from '../lib/session';
import { planDay, type Block } from '../engine/schedule';
import { addDays, localDate } from '../../../supabase/functions/_shared/tz.ts';
import { Timeline } from './Timeline';
import { EventDialog } from './EventDialog';
import { TasksPanel } from './TasksPanel';
import { WeekView } from './WeekView';
import { dayLabel, durationLabel, timeLabel } from './format';
import { selectedDate, SyncBar, useNow, viewMode, ViewSwitch } from './planner';

/** "Ma journée" tab: day or week, as last chosen. */
export function PlannerView() {
  const tr = t.value;
  if (!loaded.value) return <p class="muted">{tr('common.loading')}</p>;
  return (
    <div class="stack">
      <ViewSwitch />
      {viewMode.value === 'week' ? <WeekView /> : <DayView />}
    </div>
  );
}

export function DayView() {
  const tr = t.value;
  const now = useNow();
  const s = scheduleSettings.value;
  const today = localDate(now, s.tz);
  const date = selectedDate.value ?? today;
  const [selected, setSelected] = useState<Block | null>(null);

  const { plan, placements } = useMemo(
    () => planDay(date, scheduleData.value, s, now),
    [date, scheduleData.value, s, now],
  );

  const dayTasks = tasks.value.filter(
    (tk) => tk.day === date || placements.some((p) => p.taskId === tk.id && p.block && localDate(p.block.startMs, s.tz) === date),
  );
  const doneCount = dayTasks.filter((tk) => tk.done).length;

  const quick = [
    { label: tr('day.today'), value: today },
    { label: tr('day.tomorrow'), value: addDays(today, 1) },
    { label: tr('day.afterTomorrow'), value: addDays(today, 2) },
  ];

  return (
    <div class="stack">
      <div class="day-bar">
        <div class="segmented" role="group" aria-label={tr('day.picker')}>
          {quick.map((q) => (
            <button
              key={q.value}
              type="button"
              class="btn"
              aria-pressed={date === q.value}
              onClick={() => (selectedDate.value = q.value === today ? null : q.value)}
            >
              {q.label}
            </button>
          ))}
        </div>
        <label class="field inline">
          <span class="sr-only">{tr('day.date')}</span>
          <input
            type="date"
            value={date}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v) selectedDate.value = v === today ? null : v;
            }}
          />
        </label>
      </div>

      <SyncBar tz={s.tz} />

      <h2 class="day-title">{dayLabel(date)}</h2>

      <div class="tiles">
        <div class="tile">
          <span class="tile-label">{tr('tiles.tasks')}</span>
          <span class="tile-value">{dayTasks.length}</span>
          <span class="tile-sub">{tr('tiles.tasksDone', { done: doneCount, total: dayTasks.length })}</span>
        </div>
        <div class="tile">
          <span class="tile-label">{tr('tiles.busy')}</span>
          <span class="tile-value">{durationLabel(plan.busyTotalMin)}</span>
        </div>
        <div class="tile free">
          <span class="tile-label">{tr('tiles.free')}</span>
          <span class="tile-value">{durationLabel(plan.freeTotalMin)}</span>
          <span class="tile-sub">
            {plan.longestFreeMin ? tr('tiles.longest', { d: durationLabel(plan.longestFreeMin) }) : tr('tiles.none')}
            {date === today && plan.nextFree && ` · ${tr('tiles.next', { time: timeLabel(plan.nextFree.startMs, s.tz) })}`}
          </span>
        </div>
      </div>

      {calendars.value.length === 0 && <p class="notice">{tr('day.noCalendars')}</p>}
      {plan.practicasBlocked && <p class="notice">{tr(`day.blocked.${plan.practicasBlocked}`)}</p>}

      <div class="columns">
        <section class="card stack" aria-labelledby="summary-h">
          <h2 id="summary-h" class="sr-only">
            {tr('timeline.label')}
          </h2>
          {plan.notes.length > 0 && (
            <div>
              <h3 class="small muted">{tr('day.notes')}</h3>
              <ul class="chip-list">
                {plan.notes.map((n) => (
                  <li key={`${n.eventId}`} class="chip" style={{ '--cal': n.color ?? 'var(--accent)' }}>
                    <span>{n.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Timeline plan={plan} tz={s.tz} onSelect={setSelected} />
          {plan.cancelled.length > 0 && (
            <div>
              <h3 class="small muted">{tr('day.cancelled')}</h3>
              <ul class="chip-list">
                {plan.cancelled.map((c) => (
                  <li key={c.eventId} class="chip cancelled">
                    <span>
                      {timeLabel(c.startMs, s.tz)} {c.title}
                    </span>
                    <button type="button" class="btn small-btn" disabled={!online.value} onClick={() => void clearOverride(c.eventId!)}>
                      {tr('day.restore')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <TasksPanel date={date} tz={s.tz} placements={placements} />
      </div>

      {selected && <EventDialog block={selected} tz={s.tz} onClose={() => setSelected(null)} />}
    </div>
  );
}
