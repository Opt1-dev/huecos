import { signal } from '@preact/signals';
import { t, type MessageKey } from '../i18n';
import { online, signOut } from '../lib/session';
import { useEffect } from 'preact/hooks';
import { clearCache, loadAll, startRealtime, stopRealtime } from '../lib/data';
import { PlannerView } from './DayView';
import { SettingsView } from './SettingsView';
import { AdminView } from './AdminView';
import { isAdmin, loadAdminFlag } from '../lib/admin';

const TABS = [
  { id: 'day', label: 'tabs.day' },
  { id: 'rendus', label: 'tabs.rendus' },
  { id: 'notes', label: 'tabs.notes' },
  { id: 'settings', label: 'tabs.settings' },
  { id: 'admin', label: 'tabs.admin' },
] as const satisfies readonly { id: string; label: MessageKey }[];

/** The Admin tab only exists for admins. */
function visibleTabs() {
  return TABS.filter((tab) => tab.id !== 'admin' || isAdmin.value === true);
}

type TabId = (typeof TABS)[number]['id'];

const TAB_KEY = 'huecos.tab';
function readTab(): TabId {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((tab) => tab.id === saved) ? (saved as TabId) : 'day';
  } catch {
    return 'day';
  }
}
const activeTab = signal<TabId>(readTab());

function selectTab(id: TabId) {
  activeTab.value = id;
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* ignore */
  }
}

function onTabKeyDown(event: KeyboardEvent) {
  const tabs = visibleTabs();
  const index = tabs.findIndex((tab) => tab.id === activeTab.value);
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  const next = tabs[(index + delta + tabs.length) % tabs.length]!;
  selectTab(next.id);
  document.getElementById(`tab-${next.id}`)?.focus();
}

export function Shell() {
  const tr = t.value;
  const tabs = visibleTabs();
  // A saved "admin" tab for someone who isn't (or is no longer) an admin.
  const current = activeTab.value === 'admin' && isAdmin.value !== true ? 'day' : activeTab.value;
  useEffect(() => {
    void loadAll();
    void loadAdminFlag();
    startRealtime();
    const reload = () => {
      if (document.visibilityState === 'visible') void loadAll();
    };
    document.addEventListener('visibilitychange', reload);
    window.addEventListener('online', reload);
    return () => {
      stopRealtime();
      document.removeEventListener('visibilitychange', reload);
      window.removeEventListener('online', reload);
    };
  }, []);
  // On a phone the tab bar scrolls sideways: keep the selected tab visible.
  useEffect(() => {
    document.getElementById(`tab-${current}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current, tabs.length]);

  return (
    <div class="shell">
      <header class="topbar">
        <h1 class="brand">{tr('app.name')}</h1>
        <div class="topbar-status">
          {!online.value && <span class="badge warn">{tr('status.offline')}</span>}
          <button type="button" class="btn ghost" onClick={() => void clearCache().then(signOut)}>
            {tr('session.signOut')}
          </button>
        </div>
      </header>

      <nav class="tabs" role="tablist" aria-label={tr('tabs.label')} onKeyDown={onTabKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === current;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              class="tab"
              onClick={() => selectTab(tab.id)}
            >
              {tr(tab.label)}
            </button>
          );
        })}
      </nav>

      <main
        id={`panel-${current}`}
        role="tabpanel"
        aria-labelledby={`tab-${current}`}
        class="panel"
        tabIndex={0}
      >
        {current === 'day' ? (
          <PlannerView />
        ) : current === 'settings' ? (
          <SettingsView />
        ) : current === 'admin' ? (
          <AdminView />
        ) : (
          <div class="columns">
            <section class="card">
              <h2>{tr(TABS.find((tab) => tab.id === current)!.label)}</h2>
              <p class="muted">{tr('placeholder.comingSoon')}</p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
