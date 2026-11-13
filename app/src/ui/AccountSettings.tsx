import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { amIAdmin, disableSignupCode, getSignupCode, rotateSignupCode, signupLink } from '../lib/admin';
import { online, session, updatePassword } from '../lib/session';
import { PasswordFields, passwordsOk } from './PasswordFields';
import { authErrorText } from './authText';
import { errorText } from './format';

type Message = { ok: boolean; text: string } | null;

function Status({ message }: { message: Message }) {
  return (
    <p role="status" aria-live="polite" class={message && !message.ok ? 'error small' : 'muted small'}>
      {message?.text ?? ''}
    </p>
  );
}

/** Signed-in email and password (useful for accounts created with an email link). */
export function AccountSettings() {
  const tr = t.value;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) return setMessage({ ok: false, text: authErrorText(error) });
    setPassword('');
    setConfirm('');
    setMessage({ ok: true, text: tr('account.passwordSaved') });
  }

  return (
    <section class="card stack" aria-labelledby="account-h">
      <h2 id="account-h">{tr('account.title')}</h2>
      <p class="muted small">{tr('account.signedInAs', { email: session.value?.user.email ?? '' })}</p>
      <form class="stack" onSubmit={(e) => void submit(e)}>
        <h3 class="small">{tr('account.password')}</h3>
        <p class="muted small">{tr('account.passwordHelp')}</p>
        <PasswordFields idPrefix="account" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <button type="submit" class="btn primary" disabled={busy || !online.value || !passwordsOk(password, confirm)}>
          {tr('account.savePassword')}
        </button>
      </form>
      <Status message={message} />
    </section>
  );
}

/** Admins: the permanent sign-up link (copy, share, replace, disable). */
export function SignupLinkSettings() {
  const tr = t.value;
  const [admin, setAdmin] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    let alive = true;
    void amIAdmin().then(async (yes) => {
      if (!alive || !yes) return;
      setAdmin(true);
      try {
        const c = await getSignupCode();
        if (alive) setCode(c);
      } catch (e) {
        if (alive) setMessage({ ok: false, text: errorText(e) });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!admin) return null;

  async function run(fn: () => Promise<Message>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const link = code ? signupLink(code) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <section class="card stack" aria-labelledby="signup-link-h">
      <h2 id="signup-link-h">{tr('link.title')}</h2>
      <p class="muted small">{tr('link.intro')}</p>
      {code ? (
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
                return null;
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
