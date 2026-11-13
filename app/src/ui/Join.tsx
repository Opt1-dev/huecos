import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { clearJoinCode, signUpWithPassword } from '../lib/session';
import { LanguagePicker } from './LanguagePicker';
import { PasswordFields, passwordsOk } from './PasswordFields';
import { authErrorText } from './authText';

/** Sign-up page reached through the permanent ?join=… link. */
export function Join({ code, onSignIn }: { code: string; onSignIn: () => void }) {
  const tr = t.value;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!passwordsOk(password, confirm)) return;
    setBusy(true);
    setError(null);
    const { error: err, signedIn } = await signUpWithPassword(email.trim(), password, code);
    setBusy(false);
    if (err) return setError(authErrorText(err));
    // Signed in: the session listener shows the app. Otherwise a confirmation email was sent.
    if (signedIn) clearJoinCode();
    else setCheckEmail(true);
  }

  return (
    <main class="login">
      <div class="card login-card">
        <h1 class="brand">{tr('app.name')}</h1>
        <p class="muted">{tr('app.tagline')}</p>
        <h2>{tr('join.title')}</h2>
        {checkEmail ? (
          <p role="status">{tr('join.checkEmail')}</p>
        ) : (
          <form class="stack" onSubmit={(e) => void submit(e)}>
            <label class="field">
              <span>{tr('login.email')}</span>
              <input
                type="email"
                required
                autocomplete="email"
                value={email}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </label>
            <PasswordFields
              idPrefix="join"
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
            />
            <button type="submit" class="btn primary" disabled={busy || !email.trim() || !passwordsOk(password, confirm)}>
              {busy ? tr('join.creating') : tr('join.submit')}
            </button>
          </form>
        )}
        <p role="alert" class="error small">
          {error ?? ''}
        </p>
        <button
          type="button"
          class="btn ghost"
          onClick={() => {
            clearJoinCode();
            onSignIn();
          }}
        >
          {tr('join.haveAccount')}
        </button>
        <LanguagePicker />
      </div>
    </main>
  );
}
