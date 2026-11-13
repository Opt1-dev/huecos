import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { fromCache, settingsRow, syncing, syncNow } from '../lib/data';
import { online } from '../lib/session';
import { errorText, timeLabel } from './format';

/** Date shown by the day view, and the week shown by the week view. null = today. */
export const selectedDate = signal<string | null>(null);

export type ViewMode = 'day' | 'week';
const VIEW_KEY = 'huecos.view';

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'day';
  } catch {
    return 'day';
  }
}

export const viewMode = signal<ViewMode>(readView());

export function setViewMode(mode: ViewMode): void {
  viewMode.value = mode;
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Re-render every minute so "now" and the next slot stay current. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ViewSwitch() {
  const tr = t.value;
  const modes: { id: ViewMode; label: string }[] = [
    { id: 'day', label: tr('view.day') },
    { id: 'week', label: tr('view.week') },
  ];
  return (
    <div class="segmented view-switch" role="group" aria-label={tr('view.label')}>
      {modes.map((m) => (
        <button key={m.id} type="button" class="btn" aria-pressed={viewMode.value === m.id} onClick={() => setViewMode(m.id)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function SyncBar({ tz }: { tz: string }) {
  const tr = t.value;
  const [syncError, setSyncError] = useState<string | null>(null);
  const lastSynced = settingsRow.value?.last_synced_at;
  return (
    <>
      <div class="sync-bar small">
        <span class="muted">
          {lastSynced ? tr('status.lastSynced', { time: timeLabel(Date.parse(lastSynced), tz) }) : tr('sync.never')}
          {fromCache.value && ` · ${tr('status.cached')}`}
        </span>
        {!online.value && <span class="badge warn">{tr('status.offline')}</span>}
        <button
          type="button"
          class="btn"
          disabled={syncing.value || !online.value}
          onClick={() =>
            void syncNow()
              .then((r) => setSyncError(r.error ? tr('sync.error', { code: r.error }) : null))
              .catch((e) => setSyncError(errorText(e)))
          }
        >
          {syncing.value ? tr('sync.running') : tr('sync.button')}
        </button>
      </div>
      {syncError && (
        <p role="alert" class="error small">
          {syncError}
        </p>
      )}
    </>
  );
}
