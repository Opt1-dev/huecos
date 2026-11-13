import { useEffect, useState } from 'preact/hooks';
import { locale, t } from '../i18n';
import {
  banAccount,
  banEmail,
  disableSignupCode,
  getSignupCode,
  listAccounts,
  listBannedEmails,
  rotateSignupCode,
  signupLink,
  unbanAccount,
  unbanEmail,
  type AccountRow,
  type BannedEmailRow,
} from '../lib/admin';
import { online, session } from '../lib/session';
import { errorText } from './format';

type Message = { ok: boolean; text: string } | null;

function Status({ message }: { message: Message }) {
  return (
    <p role="status" aria-live="polite" class={message && !message.ok ? 'error small' : 'muted small'}>
      {message?.text ?? ''}
    </p>
  );
}

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
  return { busy, message, setMessage, run };
}

function when(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(Date.parse(iso));
}

// ---------------------------------------------------------------------------
function SignupLinkSection({ onChange }: { onChange: () => void }) {
  const tr = t.value;
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const { busy, message, setMessage, run } = useRunner();

  useEffect(() => {
    getSignupCode()
      .then(setCode)
      .catch((e: unknown) => setMessage({ ok: false, text: errorText(e) }));
  }, []);

  const link = code ? signupLink(code) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <section class="card stack" aria-labelledby="signup-link-h">
      <h2 id="signup-link-h">{tr('link.title')}</h2>
      <p class="muted small">{tr('link.intro')}</p>
      {code === undefined ? (
        <p class="muted small">{tr('common.loading')}</p>
      ) : code ? (
        <>
          <label class="field">
            <span>{tr('link.label')}</span>
            <input readOnly value={link} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          </label>
          <div class="actions">
            <button
              type="button"
              class="btn primary"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(link);
                  return { ok: true, text: tr('link.copied') };
                })
              }
            >
              {tr('link.copy')}
            </button>
            {canShare && (
              <button
                type="button"
                class="btn"
                onClick={() =>
                  void navigator.share({ title: tr('app.name'), text: tr('link.shareText'), url: link }).catch(() => undefined)
                }
              >
                {tr('link.share')}
              </button>
            )}
            <button
              type="button"
              class="btn"
              disabled={busy || !online.value}
              onClick={() =>
                void run(async () => {
                  setCode(await getSignupCode());
                  onChange();
                })
              }
            >
              {tr('admin.refresh')}
            </button>
          </div>
          <div class="actions">
            <button
              type="button"
              class="btn"
              disabled={busy || !online.value}
              onClick={() => {
                if (!confirm(tr('link.confirmRotate'))) return;
                void run(async () => {
                  setCode(await rotateSignupCode());
                  return { ok: true, text: tr('link.rotated') };
                });
              }}
            >
              {tr('link.rotate')}
            </button>
            <button
              type="button"
              class="btn danger"
              disabled={busy || !online.value}
              onClick={() => {
                if (!confirm(tr('link.confirmDisable'))) return;
                void run(async () => {
                  await disableSignupCode();
                  setCode(null);
                  return { ok: true, text: tr('link.disabled') };
                });
              }}
            >
              {tr('link.disable')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="small">{tr('link.none')}</p>
          <button
            type="button"
            class="btn primary"
            disabled={busy || !online.value}
            onClick={() =>
              void run(async () => {
                setCode(await rotateSignupCode());
              })
            }
          >
            {tr('link.create')}
          </button>
        </>
      )}
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function AccountsSection({ accounts, reload }: { accounts: AccountRow[] | null; reload: () => Promise<void> }) {
  const tr = t.value;
  const me = session.value?.user.id;
  const { busy, message, run } = useRunner();

  return (
    <section class="card stack" aria-labelledby="accounts-h">
      <div class="section-head">
        <h2 id="accounts-h">{tr('admin.accounts', { n: accounts?.length ?? 0 })}</h2>
        <button type="button" class="btn small-btn" disabled={busy || !online.value} onClick={() => void run(reload)}>
          {tr('admin.refresh')}
        </button>
      </div>
      {accounts === null ? (
        <p class="muted small">{tr('common.loading')}</p>
      ) : (
        <ul class="admin-list">
          {accounts.map((a) => (
            <li key={a.id} class={a.banned ? 'admin-row banned' : 'admin-row'}>
              <div class="admin-row-text">
                <strong>{a.email ?? '—'}</strong>
                <span class="muted small">
                  {tr('admin.joined', { date: when(a.created_at) })}
                  {' · '}
                  {a.last_sign_in_at ? tr('admin.lastSignIn', { date: when(a.last_sign_in_at) }) : tr('admin.neverSignedIn')}
                </span>
                <span class="admin-badges">
                  {a.is_admin && <span class="badge">{tr('admin.isAdmin')}</span>}
                  {a.id === me && <span class="badge">{tr('admin.you')}</span>}
                  {a.banned && <span class="badge warn">{tr('admin.banned')}</span>}
                </span>
              </div>
              {!a.is_admin && a.id !== me && (
                <button
                  type="button"
                  class={a.banned ? 'btn small-btn' : 'btn small-btn danger'}
                  disabled={busy || !online.value}
                  onClick={() => {
                    if (a.banned) {
                      void run(async () => {
                        await unbanAccount(a.id);
                        await reload();
                        return { ok: true, text: tr('admin.unbannedDone', { email: a.email ?? '' }) };
                      });
                    } else if (confirm(tr('admin.confirmBan', { email: a.email ?? '' }))) {
                      void run(async () => {
                        await banAccount(a.id);
                        await reload();
                        return { ok: true, text: tr('admin.bannedDone', { email: a.email ?? '' }) };
                      });
                    }
                  }}
                >
                  {a.banned ? tr('admin.unban') : tr('admin.ban')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p class="muted small">{tr('admin.banHelp')}</p>
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
function BannedEmailsSection({ banned, reload }: { banned: BannedEmailRow[] | null; reload: () => Promise<void> }) {
  const tr = t.value;
  const [email, setEmail] = useState('');
  const { busy, message, run } = useRunner();

  return (
    <section class="card stack" aria-labelledby="banned-h">
      <h2 id="banned-h">{tr('admin.bannedEmails')}</h2>
      <form
        class="feed-form"
        onSubmit={(e) => {
          e.preventDefault();
          const target = email.trim();
          if (!confirm(tr('admin.confirmBanEmail', { email: target }))) return;
          void run(async () => {
            await banEmail(target);
            setEmail('');
            await reload();
            return { ok: true, text: tr('admin.bannedDone', { email: target }) };
          });
        }}
      >
        <label class="field">
          <span>{tr('admin.banEmailLabel')}</span>
          <input type="email" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </label>
        <button type="submit" class="btn danger" disabled={busy || !online.value || !email.trim()}>
          {tr('admin.ban')}
        </button>
      </form>
      {banned === null ? (
        <p class="muted small">{tr('common.loading')}</p>
      ) : banned.length === 0 ? (
        <p class="muted small">{tr('admin.noBanned')}</p>
      ) : (
        <ul class="admin-list">
          {banned.map((b) => (
            <li key={b.email} class="admin-row">
              <div class="admin-row-text">
                <strong>{b.email}</strong>
                <span class="muted small">
                  {tr('admin.bannedOn', { date: when(b.banned_at) })}
                  {b.has_account ? ` · ${tr('admin.hasAccount')}` : ` · ${tr('admin.noAccount')}`}
                </span>
              </div>
              <button
                type="button"
                class="btn small-btn"
                disabled={busy || !online.value}
                onClick={() =>
                  void run(async () => {
                    await unbanEmail(b.email);
                    await reload();
                    return { ok: true, text: tr('admin.unbannedDone', { email: b.email }) };
                  })
                }
              >
                {tr('admin.unban')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Status message={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
export function AdminView() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [banned, setBanned] = useState<BannedEmailRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [a, b] = await Promise.all([listAccounts(), listBannedEmails()]);
    setAccounts(a);
    setBanned(b);
  }

  useEffect(() => {
    reload().catch((e: unknown) => setError(errorText(e)));
  }, []);

  return (
    <div class="columns">
      <div class="stack">
        <SignupLinkSection onChange={() => void reload().catch(() => undefined)} />
        <BannedEmailsSection banned={banned} reload={reload} />
      </div>
      <div class="stack">
        {error && (
          <p role="alert" class="error small">
            {error}
          </p>
        )}
        <AccountsSection accounts={accounts} reload={reload} />
      </div>
    </div>
  );
}
