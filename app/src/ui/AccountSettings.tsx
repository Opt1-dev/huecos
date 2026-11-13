import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { online, session, updatePassword } from '../lib/session';
import { PasswordFields, passwordsOk } from './PasswordFields';
import { authErrorText } from './authText';

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
