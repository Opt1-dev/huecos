import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { addTask, deleteTask, tasks, updateTask, type TaskRow } from '../lib/data';
import { online } from '../lib/session';
import type { Placement } from '../engine/schedule';
import { localDate } from '../../../supabase/functions/_shared/tz.ts';
import { durationLabel, errorText, minutesToInput, parseTimeInput, QUADRANT_KEYS, timeLabel, weekdayDay } from './format';

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 210, 240];
type Q = 1 | 2 | 3 | 4;

interface Props {
  date: string;
  tz: string;
  placements: Placement[];
}

export function TasksPanel({ date, tz, placements }: Props) {
  const tr = t.value;
  const [title, setTitle] = useState('');
  const [quadrant, setQuadrant] = useState<Q>(1);
  const [start, setStart] = useState('');
  const [duration, setDuration] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Shown: tasks of this day, plus undated open tasks (they are not tied to a day).
  const visible = tasks.value.filter((tk) => tk.day === date || (tk.day === null && !tk.done));
  const placementOf = new Map(placements.map((p) => [p.taskId, p.blocks]));
  /** "14:00" on the shown day, "lun. 16 14:00" on another day. */
  const when = (ms: number) => {
    const d = localDate(ms, tz);
    if (d === date) return timeLabel(ms, tz);
    const { weekday, day } = weekdayDay(d);
    return `${weekday} ${day} ${timeLabel(ms, tz)}`;
  };

  function TaskLine({ task }: { task: TaskRow }) {
    const placed = placementOf.get(task.id);
    const id = `task-${task.id}`;
    return (
      <li class={`task ${task.done ? 'done' : ''}`}>
        <input
          id={id}
          type="checkbox"
          checked={task.done}
          disabled={busy || !online.value}
          onChange={(e) => void run(() => updateTask(task.id, { done: (e.target as HTMLInputElement).checked }))}
        />
        <label for={id} class="task-title">
          {task.title}
          <span class="muted small">
            {' · '}
            {task.start_min !== null ? `${minutesToInput(task.start_min)} · ` : ''}
            {durationLabel(task.duration_min)}
            {placed && placed.length === 0 && <span class="warn-text"> · {tr(`tasks.unplaced.${task.quadrant}`)}</span>}
            {placed && placed.length === 1 && <> · {tr('tasks.placed', { when: when(placed[0]!.startMs) })}</>}
            {placed && placed.length === 2 && (
              <> · {tr('tasks.placedParts', { first: when(placed[0]!.startMs), second: when(placed[1]!.startMs) })}</>
            )}
          </span>
        </label>
        <select
          aria-label={tr('tasks.move')}
          value={task.quadrant}
          disabled={busy || !online.value}
          onChange={(e) => void run(() => updateTask(task.id, { quadrant: Number((e.target as HTMLSelectElement).value) as Q }))}
        >
          {([1, 2, 3, 4] as Q[]).map((q) => (
            <option key={q} value={q}>
              {tr(QUADRANT_KEYS[q])}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="icon-btn"
          aria-label={`${tr('common.delete')} ${task.title}`}
          disabled={busy || !online.value}
          onClick={() => void run(() => deleteTask(task.id))}
        >
          ×
        </button>
      </li>
    );
  }

  return (
    <section class="card stack" aria-labelledby="tasks-h">
      <h2 id="tasks-h">{tr('tasks.title')}</h2>
      <form
        class="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          const startMin = start ? parseTimeInput(start) : null;
          void run(async () => {
            await addTask({
              title: title.trim(),
              quadrant,
              // A task with a time belongs to the shown day; otherwise Huecos places it.
              day: startMin !== null ? date : null,
              start_min: startMin,
              duration_min: duration,
            });
            setTitle('');
            setStart('');
          });
        }}
      >
        <h3 class="span-all">{tr('tasks.new')}</h3>
        <label class="field span-all">
          <span>{tr('tasks.name')}</span>
          <input value={title} maxLength={200} required onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('tasks.priority')}</span>
          <select value={quadrant} onChange={(e) => setQuadrant(Number((e.target as HTMLSelectElement).value) as Q)}>
            {([1, 2, 3, 4] as Q[]).map((q) => (
              <option key={q} value={q}>
                {tr(QUADRANT_KEYS[q])}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>{tr('tasks.start')}</span>
          <input type="time" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('tasks.duration')}</span>
          <select value={duration} onChange={(e) => setDuration(Number((e.target as HTMLSelectElement).value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </select>
        </label>
        {!start && <p class="muted small span-all">{tr(`tasks.rule.${quadrant}`)}</p>}
        <button class="btn primary" type="submit" disabled={busy || !online.value || !title.trim()}>
          {tr('tasks.add')}
        </button>
      </form>
      <p role="status" aria-live="polite" class="error small">
        {error ?? ''}
      </p>

      <h3>{tr('tasks.matrix')}</h3>
      <div class="matrix">
        {([1, 2, 3, 4] as Q[]).map((q) => {
          const list = visible.filter((tk) => tk.quadrant === q);
          return (
            <section key={q} class={`quadrant q${q}`} aria-labelledby={`q-${q}`}>
              <h4 id={`q-${q}`}>{tr(QUADRANT_KEYS[q])}</h4>
              {list.length === 0 ? (
                <p class="muted small">{tr('tasks.empty')}</p>
              ) : (
                <ul class="task-list">
                  {list.map((task) => (
                    <TaskLine key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
