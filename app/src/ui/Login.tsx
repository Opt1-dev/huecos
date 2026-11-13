import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { normalizeCode, sendMagicLink, sendPasswordReset, signInWithPassword, verifyEmailCode } from '../lib/session';
import { LanguagePicker } from './LanguagePicker';
import { authErrorText } from './authText';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'resetSent' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string };

type Mode = 'password' | 'link';
const MODE_KEY = 'huecos.loginMode';
function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'link' ? 'link' : 'password';
  } catch {
    return 'password';
  }
}
const mode = signal<Mode>(readMode());
function setMode(m: Mode) {
  mode.value = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
}

/**
 * The 6-digit code needs {{ .Token }} in the "Magic link or OTP" email template,
 * which Supabase only lets us edit once a custom SMTP sender is configured.
 * Switch this on together with that template change.
 */
export const LOGIN_CODE_ENABLED = false;

const CODE_MIN = 6;
const CODE_MAX = 10;

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const tr = t.value;
  const digits = normalizeCode(code);
  const busy = state.kind === 'sending' || state.kind === 'verifying';

  async function onPassword(event: Event) {
    event.preventDefault();
    setState({ kind: 'sending' });
    const { error } = await signInWithPassword(email.trim(), password);
    // On success the session listener swaps this screen for the app.
    setState(error ? { kind: 'error', message: authErrorText(error) } : { kind: 'idle' });
  }

  async function onForgot() {
    if (!email.trim()) return setState({ kind: 'error', message: tr('login.emailFirst') });
    setState({ kind: 'sending' });
    const { error } = await sendPasswordReset(email.trim());
    setState(error ? { kind: 'error', message: authErrorText(error) } : { kind: 'resetSent' });
  }

  async function onSend(event: Event) {
    event.preventDefault();
    setState({ kind: 'sending' });
    const { error } = await sendMagicLink(email.trim());
    if (error) {
      setState({ kind: 'error', message: authErrorText(error) });
    } else {
      setState({ kind: 'sent' });
      setShowCode(LOGIN_CODE_ENABLED);
    }
  }

  async function onVerify(event: Event) {
    event.preventDefault();
    setState({ kind: 'verifying' });
    const { error } = await verifyEmailCode(email.trim(), digits);
    setState(error ? { kind: 'error', message: tr('login.codeError') } : { kind: 'idle' });
  }

  const emailField = (
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
  );

  return (
    <main class="login">
      <div class="card login-card">
        <h1 class="brand">{tr('app.name')}</h1>
        <p class="muted">{tr('app.tagline')}</p>
        <h2>{tr('login.title')}</h2>
        <div class="segmented" role="group" aria-label={tr('login.how')}>
          <button
            type="button"
            class="btn"
            aria-pressed={mode.value === 'password'}
            onClick={() => {
              setMode('password');
              setState({ kind: 'idle' });
            }}
          >
            {tr('login.withPassword')}
          </button>
          <button
            type="button"
            class="btn"
            aria-pressed={mode.value === 'link'}
            onClick={() => {
              setMode('link');
              setState({ kind: 'idle' });
            }}
          >
            {tr('login.withLink')}
          </button>
        </div>

        {mode.value === 'password' ? (
          <form onSubmit={(e) => void onPassword(e)} class="stack">
            {emailField}
            <label class="field">
              <span>{tr('login.password')}</span>
              <input
                type="password"
                required
                autocomplete="current-password"
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              />
            </label>
            <button type="submit" class="btn primary" disabled={busy || !email.trim() || !password}>
              {state.kind === 'sending' ? tr('login.signingIn') : tr('login.signIn')}
            </button>
            <button type="button" class="btn ghost" disabled={busy} onClick={() => void onForgot()}>
              {tr('login.forgot')}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void onSend(e)} class="stack">
            {emailField}
            <button type="submit" class="btn primary" disabled={busy}>
              {state.kind === 'sending' ? tr('login.sending') : tr('login.submit')}
            </button>
          </form>
        )}

        <p role="status" aria-live="polite" class={state.kind === 'error' ? 'error' : 'muted'}>
          {state.kind === 'sent' && tr('login.sent')}
          {state.kind === 'resetSent' && tr('login.resetSent')}
          {state.kind === 'error' && state.message}
        </p>

        {mode.value === 'link' && LOGIN_CODE_ENABLED && (
          showCode ? (
            <form onSubmit={(e) => void onVerify(e)} class="stack">
              <label class="field">
                <span>{tr('login.code')}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autocomplete="one-time-code"
                  maxLength={CODE_MAX + 4}
                  required
                  value={code}
                  aria-describedby="code-help"
                  onInput={(e) => setCode((e.target as HTMLInputElement).value)}
                />
              </label>
              <span id="code-help" class="muted small">
                {tr('login.codeHelp')}
              </span>
              <button
                type="submit"
                class="btn primary"
                disabled={busy || !email.trim() || digits.length < CODE_MIN || digits.length > CODE_MAX}
              >
                {state.kind === 'verifying' ? tr('login.verifying') : tr('login.verify')}
              </button>
            </form>
          ) : (
            <button type="button" class="btn ghost" onClick={() => setShowCode(true)}>
              {tr('login.haveCode')}
            </button>
          )
        )}

        <p class="muted small">{tr('login.inviteOnly')}</p>
        <LanguagePicker />
      </div>
    </main>
  );
}
