import { useMemo, useState } from 'preact/hooks';
import { locale, t } from '../i18n';
import { addNote, deleteNote, loaded, notes, subjects, updateNote, type NoteRow } from '../lib/data';
import { filterNotes, NOTE_MAX, type SubjectFilter } from '../lib/notes';
import { online } from '../lib/session';
import { errorText } from './format';

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

function SubjectSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string | null) => void }) {
  const tr = t.value;
  return (
    <select id={id} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}>
      <option value="">{tr('nt.none')}</option>
      {subjects.value.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

/** Title, optional subject and text: used to add a note and to edit one. */
function NoteFields(props: {
  idPrefix: string;
  title: string;
  subjectId: string | null;
  body: string;
  onTitle: (v: string) => void;
  onSubject: (v: string | null) => void;
  onBody: (v: string) => void;
}) {
  const tr = t.value;
  const { idPrefix: p } = props;
  return (
    <>
      <label class="field" for={`${p}-title`}>
        <span>{tr('nt.title')}</span>
        <input id={`${p}-title`} value={props.title} maxLength={200} required onInput={(e) => props.onTitle((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field" for={`${p}-subject`}>
        <span>{tr('nt.subject')}</span>
        <SubjectSelect id={`${p}-subject`} value={props.subjectId ?? ''} onChange={props.onSubject} />
      </label>
      <label class="field" for={`${p}-body`}>
        <span>{tr('nt.body')}</span>
        <textarea
          id={`${p}-body`}
          rows={6}
          maxLength={NOTE_MAX}
          value={props.body}
          aria-describedby={`${p}-count`}
          onInput={(e) => props.onBody((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      <span id={`${p}-count`} class="muted small">
        {tr('nt.count', { n: props.body.length, max: NOTE_MAX })}
      </span>
    </>
  );
}

function NewNote() {
  const tr = t.value;
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const { busy, message, run } = useRunner();
  return (
    <section class="card stack" aria-labelledby="new-note-h">
      <h2 id="new-note-h">{tr('nt.new')}</h2>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await addNote({ title: title.trim(), subject_id: subjectId, body });
            setTitle('');
            setBody('');
          });
        }}
      >
        <NoteFields
          idPrefix="new-note"
          title={title}
          subjectId={subjectId}
          body={body}
          onTitle={setTitle}
          onSubject={setSubjectId}
          onBody={setBody}
        />
        <button type="submit" class="btn primary" disabled={busy || !online.value || !title.trim()}>
          {tr('nt.add')}
        </button>
      </form>
      <Status message={message} />
    </section>
  );
}

function NoteCard({ note }: { note: NoteRow }) {
  const tr = t.value;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [subjectId, setSubjectId] = useState<string | null>(note.subject_id);
  const [body, setBody] = useState(note.body);
  const { busy, message, run } = useRunner();
  const subject = subjects.value.find((s) => s.id === note.subject_id);
  const modified = new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', timeStyle: 'short' }).format(Date.parse(note.updated_at));

  function startEdit() {
    setTitle(note.title);
    setSubjectId(note.subject_id);
    setBody(note.body);
    setEditing(true);
  }

  return (
    <li class={note.pinned ? 'note-card pinned' : 'note-card'}>
      {editing ? (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await updateNote(note.id, { title: title.trim(), subject_id: subjectId, body });
              setEditing(false);
            });
          }}
        >
          <NoteFields
            idPrefix={`edit-${note.id}`}
            title={title}
            subjectId={subjectId}
            body={body}
            onTitle={setTitle}
            onSubject={setSubjectId}
            onBody={setBody}
          />
          <div class="actions">
            <button type="submit" class="btn primary" disabled={busy || !online.value || !title.trim()}>
              {tr('nt.save')}
            </button>
            <button type="button" class="btn ghost" onClick={() => setEditing(false)}>
              {tr('nt.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div class="note-head">
            <h3 class="note-title">{note.title}</h3>
            {note.pinned && <span class="badge">{tr('nt.pinned')}</span>}
          </div>
          {subject && (
            <span class="subject-chip" style={{ '--c': `var(--series-${(subject.color_index % 8) + 1})` }}>
              {subject.name}
            </span>
          )}
          {note.body && <p class="note-body">{note.body}</p>}
          <p class="muted small">{tr('nt.modified', { date: modified })}</p>
          <div class="actions">
            <button
              type="button"
              class="btn small-btn"
              aria-pressed={note.pinned}
              disabled={busy || !online.value}
              onClick={() => void run(() => updateNote(note.id, { pinned: !note.pinned }))}
            >
              {note.pinned ? tr('nt.unpin') : tr('nt.pin')}
            </button>
            <button type="button" class="btn small-btn" disabled={!online.value} onClick={startEdit}>
              {tr('nt.edit')}
            </button>
            <button
              type="button"
              class="btn small-btn danger"
              disabled={busy || !online.value}
              onClick={() => {
                if (confirm(tr('nt.confirmDelete', { title: note.title }))) void run(() => deleteNote(note.id));
              }}
            >
              {tr('nt.delete')}
            </button>
          </div>
        </>
      )}
      <Status message={message} />
    </li>
  );
}

export function NotesView() {
  const tr = t.value;
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState<SubjectFilter>('');
  const list = useMemo(() => filterNotes(notes.value, search, subject), [notes.value, search, subject]);

  if (!loaded.value) return <p class="muted">{tr('common.loading')}</p>;

  return (
    <div class="columns">
      <div class="stack">
        <NewNote />
      </div>
      <section class="card stack" aria-labelledby="notes-h">
        <h2 id="notes-h">{tr('nt.list', { n: notes.value.length })}</h2>
        <div class="grid-form notes-filters">
          <label class="field">
            <span>{tr('nt.search')}</span>
            <input type="search" value={search} placeholder={tr('nt.searchPlaceholder')} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>{tr('nt.filter')}</span>
            <select value={subject} onChange={(e) => setSubject((e.target as HTMLSelectElement).value)}>
              <option value="">{tr('nt.all')}</option>
              <option value="none">{tr('nt.none')}</option>
              {subjects.value.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {notes.value.length === 0 ? (
          <p class="muted small">{tr('nt.empty')}</p>
        ) : list.length === 0 ? (
          <p class="muted small">{tr('nt.noMatch')}</p>
        ) : (
          <ul class="note-list">
            {list.map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
