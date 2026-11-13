import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { online, sendPasswordReset, session, signInWithPassword, updatePassword } from '../lib/session';
import { MIN_PASSWORD, newPasswordOk } from './passwordRules';
import { authErrorText } from './authText';

type Message = { ok: boolean; text: string } | null;

function Status({ message }: { message: Message }) {
  return (
    <p role="status" aria-live="polite" class={message && !message.ok ? 'error small' : 'muted small'}>
      {message?.text ?? ''}
    </p>
  );
}

/** Change the password: current password, then a different new one. */
export function AccountSettings() {
  const tr = t.value;
  const email = session.value?.user.email ?? '';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const same = next.length > 0 && next === current;

  async function submit(e: Event) {
    e.preventDefault();
    if (!newPasswordOk(current, next)) return;
    setBusy(true);
    setMessage(null);
    // Check the current password first: updateUser alone doesn't ask for it.
    const check = await signInWithPassword(email, current);
    if (check.error) {
      setBusy(false);
      const wrong = /invalid login credentials/i.test(check.error);
      return setMessage({ ok: false, text: wrong ? tr('account.wrongCurrent') : authErrorText(check.error) });
    }
    const { error } = await updatePassword(next);
    setBusy(false);
    if (error) return setMessage({ ok: false, text: authErrorText(error) });
    setCurrent('');
    setNext('');
    setMessage({ ok: true, text: tr('account.passwordSaved') });
  }

  async function forgot() {
    setBusy(true);
    setMessage(null);
    const { error } = await sendPasswordReset(email);
    setBusy(false);
    setMessage(error ? { ok: false, text: authErrorText(error) } : { ok: true, text: tr('account.resetSent', { email }) });
  }

  return (
    <section class="card stack" aria-labelledby="account-h">
      <h2 id="account-h">{tr('account.title')}</h2>
      {email && <p class="muted small">{tr('account.signedInAs', { email })}</p>}
      <form class="stack" onSubmit={(e) => void submit(e)}>
        <h3 class="small">{tr('account.changePassword')}</h3>
        <label class="field">
          <span>{tr('account.current')}</span>
          <input
            type="password"
            autocomplete="current-password"
            required
            value={current}
            onInput={(e) => setCurrent((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>{tr('account.new')}</span>
          <input
            type="password"
            autocomplete="new-password"
            minLength={MIN_PASSWORD}
            required
            value={next}
            aria-invalid={tooShort || same}
            aria-describedby="account-new-help"
            onInput={(e) => setNext((e.target as HTMLInputElement).value)}
          />
        </label>
        <span id="account-new-help" class={tooShort || same ? 'error small' : 'muted small'}>
          {same ? tr('account.same') : tr('account.newHelp', { n: MIN_PASSWORD })}
        </span>
        <button type="submit" class="btn primary" disabled={busy || !online.value || !newPasswordOk(current, next)}>
          {tr('account.savePassword')}
        </button>
        <button type="button" class="btn ghost" disabled={busy || !online.value || !email} onClick={() => void forgot()}>
          {tr('account.noPassword')}
        </button>
      </form>
      <Status message={message} />
    </section>
  );
}
