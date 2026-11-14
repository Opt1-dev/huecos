import { useMemo, useRef, useState } from 'preact/hooks';
import { locale, t } from '../i18n';
import { addNote, deleteNote, loaded, notes, subjects, updateNote, type NoteRow } from '../lib/data';
import { filterNotes, NOTE_MAX, type SubjectFilter } from '../lib/notes';
import { online } from '../lib/session';
import { errorText } from './format';
import { NoteMap } from './NoteMap';

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

/** Bottom left: write a new note, or edit the one picked in the list. */
function NoteEditor({ editing, onDone }: { editing: NoteRow | null; onDone: () => void }) {
  const tr = t.value;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [subjectId, setSubjectId] = useState<string | null>(editing?.subject_id ?? null);
  const [body, setBody] = useState(editing?.body ?? '');
  const { busy, message, run } = useRunner();
  const p = editing ? `edit-${editing.id}` : 'new-note';

  return (
    <form
      class="stack"
      aria-labelledby="editor-h"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          if (editing) {
            await updateNote(editing.id, { title: title.trim(), subject_id: subjectId, body });
            onDone();
          } else {
            await addNote({ title: title.trim(), subject_id: subjectId, body });
            setTitle('');
            setBody('');
          }
        });
      }}
    >
      <h2 id="editor-h">{editing ? tr('nt.editTitle') : tr('nt.new')}</h2>
      <label class="field" for={`${p}-title`}>
        <span>{tr('nt.title')}</span>
        <input id={`${p}-title`} value={title} maxLength={200} required onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field" for={`${p}-subject`}>
        <span>{tr('nt.subject')}</span>
        <SubjectSelect id={`${p}-subject`} value={subjectId ?? ''} onChange={setSubjectId} />
      </label>
      <label class="field note-body-field" for={`${p}-body`}>
        <span>{tr('nt.body')}</span>
        <textarea
          id={`${p}-body`}
          maxLength={NOTE_MAX}
          value={body}
          aria-describedby={`${p}-count`}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      <span id={`${p}-count`} class="muted small">
        {tr('nt.count', { n: body.length, max: NOTE_MAX })}
      </span>
      <div class="actions">
        <button type="submit" class="btn primary" disabled={busy || !online.value || !title.trim()}>
          {editing ? tr('nt.save') : tr('nt.add')}
        </button>
        {editing && (
          <button type="button" class="btn ghost" onClick={onDone}>
            {tr('nt.cancel')}
          </button>
        )}
      </div>
      <Status message={message} />
    </form>
  );
}

/** Bottom right: one title per note, opened to read it. */
function NoteItem({
  note,
  open,
  selected,
  onToggle,
  onEdit,
}: {
  note: NoteRow;
  open: boolean;
  selected: boolean;
  onToggle: (open: boolean) => void;
  onEdit: () => void;
}) {
  const tr = t.value;
  const { busy, message, run } = useRunner();
  const subject = subjects.value.find((s) => s.id === note.subject_id);
  const modified = new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', timeStyle: 'short' }).format(Date.parse(note.updated_at));
  const subjectColor = subject ? `var(--series-${(subject.color_index % 8) + 1})` : 'var(--muted)';

  return (
    <li id={`note-${note.id}`} class={`note-item${note.pinned ? ' pinned' : ''}${selected ? ' selected' : ''}`}>
      <details open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
        <summary style={{ '--c': subjectColor }}>
          <span class="note-dot" aria-hidden="true" />
          <span class="note-item-title">{note.title}</span>
          {note.pinned && <span class="badge">{tr('nt.pinned')}</span>}
        </summary>
        <div class="note-item-body stack-tight">
          {subject && (
            <span class="subject-chip" style={{ '--c': subjectColor }}>
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
            <button type="button" class="btn small-btn" disabled={!online.value} onClick={onEdit}>
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
          <Status message={message} />
        </div>
      </details>
    </li>
  );
}

export function NotesView() {
  const tr = t.value;
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState<SubjectFilter>('');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const list = useMemo(() => filterNotes(notes.value, search, subject), [notes.value, search, subject]);
  const editing = notes.value.find((n) => n.id === editingId) ?? null;

  const setOpen = (id: string, open: boolean) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  /** From the map: open the note in the list and bring it into view. */
  function select(id: string) {
    setSelectedId(id);
    setOpen(id, true);
    requestAnimationFrame(() => document.getElementById(`note-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  if (!loaded.value) return <p class="muted">{tr('common.loading')}</p>;

  return (
    <div class="card notes-board">
      <section class="notes-map-zone" aria-labelledby="map-h">
        <div class="notes-map-head">
          <h2 id="map-h">{tr('nt.map')}</h2>
          <p class="muted small">{tr('nt.mapHelp')}</p>
        </div>
        <NoteMap notes={list} selectedId={selectedId} onSelect={select} />
      </section>
      <div class="notes-bottom">
        <section class="notes-editor" ref={editorRef}>
          <NoteEditor key={editingId ?? 'new'} editing={editing} onDone={() => setEditingId(null)} />
        </section>
        <section class="notes-list-zone" aria-labelledby="notes-h">
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
                <NoteItem
                  key={n.id}
                  note={n}
                  open={openIds.has(n.id)}
                  selected={n.id === selectedId}
                  onToggle={(open) => {
                    setOpen(n.id, open);
                    if (open) setSelectedId(n.id);
                  }}
                  onEdit={() => {
                    setEditingId(n.id);
                    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
