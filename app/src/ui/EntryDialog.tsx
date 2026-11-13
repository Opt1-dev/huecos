import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { calendars, deleteEntry, entries, updateEntry } from '../lib/data';
import { online } from '../lib/session';
import { EntryForm } from './EntryForm';
import { errorText } from './format';

interface Props {
  entryId: string;
  tz: string;
  onClose: () => void;
}

/** Edit a manual calendar entry (the whole series) from the day or week view. */
export function EntryDialog({ entryId, tz, onClose }: Props) {
  const tr = t.value;
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const entry = entries.value.find((e) => e.id === entryId);
  const cal = calendars.value.find((c) => c.id === entry?.calendar_id);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  if (!entry) return null;

  return (
    <dialog ref={ref} class="dialog" aria-labelledby="entry-dialog-title" onClose={onClose}>
      <div class="stack">
        <h2 id="entry-dialog-title">{tr('entry.editTitle')}</h2>
        {cal && <p class="muted small">{cal.name}</p>}
        <p class="muted small">{tr('entry.seriesNote')}</p>
        <EntryForm
          tz={tz}
          initial={entry}
          submitLabel={tr('common.save')}
          onSubmit={async (fields) => {
            await updateEntry(entry.id, fields);
            ref.current?.close();
          }}
        >
          <button
            type="button"
            class="btn danger"
            disabled={!online.value}
            onClick={() => {
              if (!confirm(tr('entry.confirmDelete', { name: entry.title }))) return;
              deleteEntry(entry.id)
                .then(() => ref.current?.close())
                .catch((e: unknown) => setError(errorText(e)));
            }}
          >
            {tr('common.delete')}
          </button>
          <button type="button" class="btn ghost" onClick={() => ref.current?.close()}>
            {tr('common.close')}
          </button>
        </EntryForm>
        {error && (
          <p role="alert" class="error small">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
