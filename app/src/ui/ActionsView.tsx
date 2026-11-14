import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { locale, t, type MessageKey } from '../i18n';
import {
  addKeyword,
  checkMailNow,
  connectMicrosoft,
  deleteDoneHits,
  deleteKeyword,
  disconnectMailbox,
  mailAccounts,
  mailChecking,
  mailHits,
  mailKeywords,
  setHitDone,
} from '../lib/mail';
import { online } from '../lib/session';
import { errorText } from './format';

type Message = { ok: boolean; text: string } | null;

/** Set by the Shell when the app comes back from Microsoft's sign-in. */
export const mailReturnMessage = signal<Message>(null);

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

const when = (iso: string) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(Date.parse(iso));

/** Error codes from the server → text. */
export function mailErrorText(code: string): string {
  const tr = t.value;
  const known = ['reconnect', 'admin_consent', 'cancelled', 'expired', 'not_configured', 'too_soon'];
  return known.includes(code) ? tr(`act.err.${code}` as MessageKey) : tr('act.err.other', { code });
}

// ---------------------------------------------------------------------------
function HitsSection() {
  const tr = t.value;
  const { busy, message, run } = useRunner();
  const todo = mailHits.value.filter((h) => !h.done);
  const done = mailHits.value.filter((h) => h.done);
  const address = (id: string) => mailAccounts.value.find((a) => a.id === id)?.address ?? '';

  const row = (h: (typeof todo)[number]) => (
    <li key={h.id} class={h.done ? 'hit-row done' : 'hit-row'}>
      <div class="hit-head">
        <strong class="hit-subject">{h.subject || tr('act.noSubject')}</strong>
        <span class="muted small">
          {h.sender_name || h.sender_address} · {when(h.received_at)}
          {mailAccounts.value.length > 1 && ` · ${address(h.account_id)}`}
        </span>
      </div>
      <ul class="chip-list" aria-label={tr('act.foundKeywords')}>
        {h.keywords.map((k) => (
          <li key={k} class="chip keyword-chip">
            <span>{k}</span>
          </li>
        ))}
      </ul>
      {h.snippet && <p class="hit-snippet small">{h.snippet}</p>}
      <div class="actions">
        {h.web_link && (
          <a class="btn small-btn" href={h.web_link} target="_blank" rel="noopener noreferrer">
            {tr('act.open')}
          </a>
        )}
        <button
          type="button"
          class={h.done ? 'btn small-btn' : 'btn small-btn primary'}
          disabled={busy || !online.value}
          onClick={() => void run(() => setHitDone(h.id, !h.done))}
        >
          {h.done ? tr('act.undo') : tr('act.done')}
        </button>
      </div>
    </li>
  );

  return (
    <section class="card stack" aria-labelledby="hits-h">
      <div class="section-head">
        <h2 id="hits-h">{tr('act.todo', { n: todo.length })}</h2>
        <button
          type="button"
          class="btn small-btn"
          disabled={mailChecking.value || !online.value || mailAccounts.value.length === 0}
          onClick={() =>
            void run(async () => {
              const { error } = await checkMailNow();
              return error ? { ok: false, text: mailErrorText(error) } : { ok: true, text: tr('act.checked') };
            })
          }
        >
          {mailChecking.value ? tr('act.checking') : tr('act.checkNow')}
        </button>
      </div>
      {todo.length === 0 ? <p class="muted small">{tr('act.nothing')}</p> : <ul class="hit-list">{todo.map(row)}</ul>}
      {done.length > 0 && (
        <details class="graded-group">
          <summary>{tr('act.doneGroup', { n: done.length })}</summary>
          <ul class="hit-list">{done.map(row)}</ul>
          <button
            type="button"
            class="btn small-btn danger"
            disabled={busy || !online.value}
            onClick={() => {
              if (confirm(tr('act.confirmClear', { n: done.length }))) void run(() => deleteDoneHits());
            }}
          >
            {tr('act.clearDone')}
          </button>
        </details>
      )}
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function KeywordsSection() {
  const tr = t.value;
  const [keyword, setKeyword] = useState('');
  const [sender, setSender] = useState('');
  const { busy, message, run } = useRunner();
  return (
    <section class="card stack" aria-labelledby="keywords-h">
      <h2 id="keywords-h">{tr('act.keywords')}</h2>
      <p class="muted small">{tr('act.keywordsHelp')}</p>
      {mailKeywords.value.length === 0 ? (
        <p class="muted small">{tr('act.noKeywords')}</p>
      ) : (
        <ul class="chip-list">
          {mailKeywords.value.map((k) => (
            <li key={k.id} class="chip keyword-chip">
              <span>
                {k.keyword}
                {k.sender && <span class="muted"> · {tr('act.from', { sender: k.sender })}</span>}
              </span>
              <button
                type="button"
                class="chip-x"
                aria-label={tr('act.removeKeyword', { keyword: k.keyword })}
                disabled={busy || !online.value}
                onClick={() => void run(() => deleteKeyword(k.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        class="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await addKeyword(keyword, sender || null);
            setKeyword('');
            setSender('');
          });
        }}
      >
        <label class="field">
          <span>{tr('act.keyword')}</span>
          <input value={keyword} required minLength={2} maxLength={100} onInput={(e) => setKeyword((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{tr('act.sender')}</span>
          <input
            value={sender}
            maxLength={200}
            placeholder={tr('act.senderPlaceholder')}
            onInput={(e) => setSender((e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="submit" class="btn" disabled={busy || !online.value || keyword.trim().length < 2}>
          {tr('act.addKeyword')}
        </button>
      </form>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function MailboxesSection() {
  const tr = t.value;
  const { busy, message, run } = useRunner();
  return (
    <section class="card stack" aria-labelledby="mailboxes-h">
      <h2 id="mailboxes-h">{tr('act.mailboxes')}</h2>
      <p class="muted small">{tr('act.privacy')}</p>
      {mailAccounts.value.length === 0 ? (
        <p class="muted small">{tr('act.noMailbox')}</p>
      ) : (
        <ul class="admin-list">
          {mailAccounts.value.map((a) => (
            <li key={a.id} class="admin-row">
              <div class="admin-row-text">
                <strong>{a.address}</strong>
                <span class="muted small">
                  {tr(`act.provider.${a.provider}` as MessageKey)}
                  {' · '}
                  {a.last_checked_at ? tr('act.lastCheck', { date: when(a.last_checked_at) }) : tr('act.neverChecked')}
                </span>
                {a.last_error && <span class="error small">{mailErrorText(a.last_error)}</span>}
              </div>
              <div class="actions">
                {a.last_error === 'reconnect' && (
                  <button
                    type="button"
                    class="btn small-btn"
                    disabled={busy || !online.value}
                    onClick={() =>
                      void run(async () => {
                        const { error } = await connectMicrosoft();
                        return error ? { ok: false, text: mailErrorText(error) } : null;
                      })
                    }
                  >
                    {tr('act.reconnect')}
                  </button>
                )}
                <button
                  type="button"
                  class="btn small-btn danger"
                  disabled={busy || !online.value}
                  onClick={() => {
                    if (confirm(tr('act.confirmDisconnect', { address: a.address }))) void run(() => disconnectMailbox(a.id));
                  }}
                >
                  {tr('act.disconnect')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div class="actions">
        <button
          type="button"
          class="btn primary"
          disabled={busy || !online.value}
          onClick={() =>
            void run(async () => {
              const { error } = await connectMicrosoft();
              return error ? { ok: false, text: mailErrorText(error) } : null;
            })
          }
        >
          {tr('act.connectMicrosoft')}
        </button>
      </div>
      <p class="muted small">{tr('act.googleSoon')}</p>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
export function ActionsView() {
  const ret = mailReturnMessage.value;
  useEffect(() => {
    // Show the sign-in result once.
    if (ret) {
      const id = setTimeout(() => (mailReturnMessage.value = null), 15_000);
      return () => clearTimeout(id);
    }
  }, [ret]);
  return (
    <div class="columns">
      <div class="stack">
        {ret && (
          <p role="status" class={ret.ok ? 'notice ok' : 'notice'}>
            {ret.text}
          </p>
        )}
        <HitsSection />
      </div>
      <div class="stack">
        <KeywordsSection />
        <MailboxesSection />
      </div>
    </div>
  );
}
