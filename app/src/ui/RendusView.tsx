import { useMemo, useState } from 'preact/hooks';
import { t, type MessageKey } from '../i18n';
import {
  addRendu,
  addSubject,
  calendars,
  deleteRendu,
  deleteSubject,
  doneDeadlines,
  events,
  loaded,
  rendus,
  scheduleSettings,
  subjects,
  updateRendu,
  updateSubject,
  type RenduFields,
  type RenduRow,
} from '../lib/data';
import {
  gradeSeries,
  nextColorIndex,
  parseGrade,
  RENDU_STATES,
  SUBJECT_COLOR_COUNT,
  upcomingRendus,
  type RenduState,
  type UpcomingRow,
} from '../lib/rendus';
import { normalizeTitle } from '../engine/schedule';
import { online } from '../lib/session';
import { localDate } from '../../../supabase/functions/_shared/tz.ts';
import { errorText, shortDate, weekdayDay } from './format';
import { formatGrade, GradesChart } from './GradesChart';
import { useNow } from './planner';

const GRADED_OPEN_KEY = 'huecos.gradedOpen';
function readGradedOpen(): boolean {
  try {
    return localStorage.getItem(GRADED_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

type Message = { ok: boolean; text: string } | null;

function useRunner() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  async function run(fn: () => Promise<Message | void>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage((await fn()) ?? null);
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, run };
}

function Status({ message }: { message: Message }) {
  return (
    <p role="status" aria-live="polite" class={message && !message.ok ? 'error small' : 'muted small'}>
      {message?.text ?? ''}
    </p>
  );
}

function dueLabel(due: string, daysLeft: number): { text: string; late: boolean } {
  const tr = t.value;
  const { weekday } = weekdayDay(due);
  const when =
    daysLeft === 0
      ? tr('rd.today')
      : daysLeft === 1
        ? tr('rd.tomorrow')
        : daysLeft > 1
          ? tr('rd.inDays', { n: daysLeft })
          : tr('rd.late', { n: -daysLeft });
  return { text: `${weekday} ${shortDate(due)} · ${when}`, late: daysLeft < 0 };
}

function SubjectSelect({ value, onChange, label, disabled }: { value: string; onChange: (v: string | null) => void; label: string; disabled?: boolean }) {
  const tr = t.value;
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}>
      <option value="">{tr('rd.chooseSubject')}</option>
      {subjects.value.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function StateSelect({ value, onChange, label, disabled }: { value: RenduState; onChange: (v: RenduState) => void; label: string; disabled?: boolean }) {
  const tr = t.value;
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange((e.target as HTMLSelectElement).value as RenduState)}>
      {RENDU_STATES.map((s) => (
        <option key={s} value={s}>
          {tr(`rd.state.${s}` as MessageKey)}
        </option>
      ))}
    </select>
  );
}

function SubjectChip({ subjectId }: { subjectId: string | null }) {
  const tr = t.value;
  const s = subjects.value.find((x) => x.id === subjectId);
  return (
    <span class="subject-chip" style={{ '--c': s ? `var(--series-${(s.color_index % 8) + 1})` : 'var(--border)' }}>
      {s?.name ?? tr('rd.noSubject')}
    </span>
  );
}

// ---------------------------------------------------------------------------
function UpcomingSection({ rows }: { rows: UpcomingRow[] }) {
  const tr = t.value;
  const { busy, message, run } = useRunner();

  /** Any change saves a real rendu (created on the first change). */
  function save(row: UpcomingRow, patch: RenduFields) {
    void run(async () => {
      if (row.rendu) await updateRendu(row.rendu.id, patch);
      else
        await addRendu({
          event_id: row.eventId,
          title: row.title,
          due: row.due,
          subject_id: row.suggestedSubjectId,
          ...patch,
        });
    });
  }

  return (
    <section class="card stack" aria-labelledby="upcoming-h">
      <h2 id="upcoming-h">{tr('rd.upcoming')}</h2>
      {rows.length === 0 ? (
        <p class="muted small">{tr('rd.upcomingEmpty')}</p>
      ) : (
        <ul class="rendu-list">
          {rows.map((row) => {
            const due = dueLabel(row.due, row.daysLeft);
            const subjectValue = row.rendu ? (row.rendu.subject_id ?? '') : (row.suggestedSubjectId ?? '');
            return (
              <li key={row.key} class="rendu-row">
                <div class="rendu-head">
                  <strong class="rendu-title">{row.title}</strong>
                  <span class={due.late ? 'error small' : 'muted small'}>{due.text}</span>
                </div>
                <div class="rendu-controls">
                  <SubjectSelect
                    label={`${tr('rd.subject')} · ${row.title}`}
                    value={subjectValue}
                    disabled={busy || !online.value}
                    onChange={(v) => save(row, { subject_id: v })}
                  />
                  <StateSelect
                    label={`${tr('rd.state')} · ${row.title}`}
                    value={row.rendu?.state ?? 'todo'}
                    disabled={busy || !online.value}
                    onChange={(v) => save(row, { state: v })}
                  />
                  {!row.eventId && row.rendu && (
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={tr('rd.delete', { title: row.title })}
                      disabled={busy || !online.value}
                      onClick={() => {
                        if (confirm(tr('rd.confirmDelete', { title: row.title }))) void run(() => deleteRendu(row.rendu!.id));
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                <input
                  class="rendu-note"
                  aria-label={`${tr('rd.note')} · ${row.title}`}
                  placeholder={tr('rd.notePlaceholder')}
                  maxLength={2000}
                  value={row.rendu?.note ?? ''}
                  disabled={busy || !online.value}
                  onChange={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v !== (row.rendu?.note ?? '')) save(row, { note: v });
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function GradeInput({ rendu, onSave, disabled }: { rendu: RenduRow; onSave: (grade: number) => void; disabled: boolean }) {
  const tr = t.value;
  const [text, setText] = useState(rendu.grade === null ? '' : formatGrade(rendu.grade));
  const invalid = text.trim() !== '' && parseGrade(text) === null;
  return (
    <span class="grade-box">
      <input
        type="text"
        inputMode="decimal"
        autocomplete="off"
        aria-label={tr('rd.gradeOf', { title: rendu.title })}
        aria-invalid={invalid}
        title={invalid ? tr('rd.gradeInvalid') : undefined}
        value={text}
        disabled={disabled}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onChange={() => {
          const g = parseGrade(text);
          if (g !== null && g !== rendu.grade) onSave(g);
        }}
      />
      <span aria-hidden="true">/10</span>
    </span>
  );
}

function MineRow({ r, run, busy }: { r: RenduRow; run: (fn: () => Promise<Message | void>) => Promise<void>; busy: boolean }) {
  const tr = t.value;
  return (
    <li class="rendu-row">
      <div class="rendu-head">
        <strong class="rendu-title">{r.title}</strong>
        <span class="muted small">
          <SubjectChip subjectId={r.subject_id} /> {shortDate(r.due)}
        </span>
      </div>
      <div class="rendu-controls">
        <StateSelect
          label={`${tr('rd.state')} · ${r.title}`}
          value={r.state}
          disabled={busy || !online.value}
          onChange={(state) => void run(() => updateRendu(r.id, state === 'graded' ? { state } : { state, grade: null }))}
        />
        {(r.state === 'submitted' || r.state === 'graded') && (
          <GradeInput
            key={`${r.id}-${r.grade}`}
            rendu={r}
            disabled={busy || !online.value}
            onSave={(grade) => void run(() => updateRendu(r.id, { grade, state: 'graded' }))}
          />
        )}
        <button
          type="button"
          class="icon-btn"
          aria-label={tr('rd.delete', { title: r.title })}
          disabled={busy || !online.value}
          onClick={() => {
            if (confirm(tr('rd.confirmDelete', { title: r.title }))) void run(() => deleteRendu(r.id));
          }}
        >
          ×
        </button>
      </div>
    </li>
  );
}

function MineSection() {
  const tr = t.value;
  const { busy, message, run } = useRunner();
  const [gradedOpen, setGradedOpen] = useState(readGradedOpen);
  const by = (state: RenduState) => rendus.value.filter((r) => r.state === state);
  const done = by('done').sort((a, b) => a.due.localeCompare(b.due));
  const submitted = by('submitted').sort((a, b) => a.due.localeCompare(b.due));
  const graded = by('graded').sort((a, b) => b.due.localeCompare(a.due));

  return (
    <section class="card stack" aria-labelledby="mine-h">
      <h2 id="mine-h">{tr('rd.mine')}</h2>
      {done.length + submitted.length + graded.length === 0 && <p class="muted small">{tr('rd.mineEmpty')}</p>}
      {done.length > 0 && (
        <div class="stack-tight">
          <h3 class="small">{tr('rd.group.done')}</h3>
          <ul class="rendu-list">
            {done.map((r) => (
              <MineRow key={r.id} r={r} run={run} busy={busy} />
            ))}
          </ul>
        </div>
      )}
      {submitted.length > 0 && (
        <div class="stack-tight">
          <h3 class="small">{tr('rd.group.submitted')}</h3>
          <ul class="rendu-list">
            {submitted.map((r) => (
              <MineRow key={r.id} r={r} run={run} busy={busy} />
            ))}
          </ul>
        </div>
      )}
      {graded.length > 0 && (
        <details
          class="graded-group"
          open={gradedOpen}
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            setGradedOpen(open);
            try {
              localStorage.setItem(GRADED_OPEN_KEY, open ? '1' : '0');
            } catch {
              /* ignore */
            }
          }}
        >
          <summary>{tr('rd.group.graded', { n: graded.length })}</summary>
          <ul class="rendu-list">
            {graded.map((r) => (
              <MineRow key={r.id} r={r} run={run} busy={busy} />
            ))}
          </ul>
        </details>
      )}
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function NewRenduSection() {
  const tr = t.value;
  const today = localDate(Date.now(), scheduleSettings.value.tz);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(today);
  const [state, setState] = useState<RenduState>('todo');
  const [grade, setGrade] = useState('');
  const { busy, message, run } = useRunner();
  const gradeValue = parseGrade(grade);
  const gradeBad = state === 'graded' && gradeValue === null;

  return (
    <section class="card stack" aria-labelledby="new-rendu-h">
      <h2 id="new-rendu-h">{tr('rd.new')}</h2>
      <form
        class="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (gradeBad) return;
          void run(async () => {
            await addRendu({
              subject_id: subjectId,
              title: title.trim(),
              due,
              state,
              grade: state === 'graded' ? gradeValue : null,
            });
            setTitle('');
            setGrade('');
          });
        }}
      >
        <label class="field span-all">
          <span>{tr('rd.title')}</span>
          <input value={title} maxLength={300} required onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('rd.subject')}</span>
          <SubjectSelect label={tr('rd.subject')} value={subjectId ?? ''} onChange={setSubjectId} />
        </label>
        <label class="field">
          <span>{tr('rd.due')}</span>
          <input type="date" required value={due} onInput={(e) => setDue((e.target as HTMLInputElement).value || due)} />
        </label>
        <label class="field">
          <span>{tr('rd.state')}</span>
          <StateSelect label={tr('rd.state')} value={state} onChange={setState} />
        </label>
        {state === 'graded' && (
          <label class="field">
            <span>{tr('rd.grade')}</span>
            <input
              type="text"
              inputMode="decimal"
              required
              value={grade}
              aria-invalid={grade !== '' && gradeBad}
              aria-describedby="new-grade-help"
              onInput={(e) => setGrade((e.target as HTMLInputElement).value)}
            />
            <span id="new-grade-help" class={grade !== '' && gradeBad ? 'error small' : 'muted small'}>
              {tr('rd.gradeInvalid')}
            </span>
          </label>
        )}
        <button type="submit" class="btn primary" disabled={busy || !online.value || !title.trim() || gradeBad}>
          {tr('rd.add')}
        </button>
      </form>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function SubjectsSection() {
  const tr = t.value;
  const [name, setName] = useState('');
  const { busy, message, run } = useRunner();
  const uses = (id: string) => rendus.value.filter((r) => r.subject_id === id).length;

  return (
    <section class="card stack" aria-labelledby="subjects-h">
      <h2 id="subjects-h">{tr('rd.subjects')}</h2>
      {subjects.value.length === 0 ? (
        <p class="muted small">{tr('rd.subjectsEmpty')}</p>
      ) : (
        <ul class="subject-list">
          {subjects.value.map((s) => {
            const n = uses(s.id);
            return (
              <li key={s.id} class="subject-row" style={{ '--c': `var(--series-${(s.color_index % 8) + 1})` }}>
                <span class="legend-swatch" aria-hidden="true" />
                <input
                  aria-label={tr('rd.nameOf', { name: s.name })}
                  value={s.name}
                  maxLength={60}
                  disabled={busy || !online.value}
                  onChange={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v && v !== s.name) void run(() => updateSubject(s.id, { name: v }));
                  }}
                />
                <select
                  aria-label={tr('rd.colorOf', { name: s.name })}
                  value={s.color_index}
                  disabled={busy || !online.value}
                  onChange={(e) => void run(() => updateSubject(s.id, { color_index: Number((e.target as HTMLSelectElement).value) }))}
                >
                  {Array.from({ length: SUBJECT_COLOR_COUNT }, (_, i) => (
                    <option key={i} value={i}>
                      {tr(`rd.color.${i}` as MessageKey)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={n > 0 ? tr('rd.inUse', { n }) : tr('rd.deleteSubject', { name: s.name })}
                  title={n > 0 ? tr('rd.inUse', { n }) : undefined}
                  disabled={busy || !online.value || n > 0}
                  onClick={() => void run(() => deleteSubject(s.id))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        class="feed-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await addSubject(name, nextColorIndex(subjects.value));
            setName('');
          });
        }}
      >
        <label class="field">
          <span>{tr('rd.subjectName')}</span>
          <input value={name} maxLength={60} required onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <button type="submit" class="btn" disabled={busy || !online.value || !name.trim()}>
          {tr('rd.addSubject')}
        </button>
      </form>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
export function RendusView() {
  const tr = t.value;
  const now = useNow();
  const s = scheduleSettings.value;
  const today = localDate(now, s.tz);

  const rows = useMemo(() => {
    const cals = new Map(calendars.value.map((c) => [c.id, c]));
    const deadlines = events.value.filter((e) => {
      if (e.event_type !== 'deadline' || e.status === 'cancelled') return false;
      const hidden = cals.get(e.calendar_id)?.hidden_titles ?? [];
      return !hidden.some((h) => normalizeTitle(h) === normalizeTitle(e.title));
    });
    return upcomingRendus({
      deadlines,
      rendus: rendus.value,
      subjects: subjects.value,
      done: new Set(doneDeadlines.value),
      today,
      tz: s.tz,
    });
  }, [events.value, rendus.value, subjects.value, doneDeadlines.value, calendars.value, today, s.tz]);

  const series = useMemo(() => gradeSeries(rendus.value, subjects.value, tr('rd.noSubject')), [rendus.value, subjects.value, tr]);

  if (!loaded.value) return <p class="muted">{tr('common.loading')}</p>;

  return (
    <div class="columns">
      <div class="stack">
        <UpcomingSection rows={rows} />
        <MineSection />
      </div>
      <div class="stack">
        <section class="card stack" aria-labelledby="chart-h">
          <h2 id="chart-h">{tr('rd.chart')}</h2>
          <GradesChart series={series} />
        </section>
        <NewRenduSection />
        <SubjectsSection />
      </div>
    </div>
  );
}
