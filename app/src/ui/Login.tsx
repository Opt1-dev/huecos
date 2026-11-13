import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { normalizeCode, sendMagicLink, verifyEmailCode } from '../lib/session';
import { LanguagePicker } from './LanguagePicker';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string };

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
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const tr = t.value;
  const digits = normalizeCode(code);
  const busy = state.kind === 'sending' || state.kind === 'verifying';

  async function onSend(event: Event) {
    event.preventDefault();
    setState({ kind: 'sending' });
    const { error } = await sendMagicLink(email.trim());
    if (error) {
      // Supabase answers 429 "email rate limit exceeded" or "only request this after N seconds".
      const limited = /rate limit|after d+ seconds/i.test(error);
      setState({ kind: 'error', message: limited ? tr('login.rateLimited') : error });
    } else {
      setState({ kind: 'sent' });
      setShowCode(LOGIN_CODE_ENABLED);
    }
  }

  async function onVerify(event: Event) {
    event.preventDefault();
    setState({ kind: 'verifying' });
    const { error } = await verifyEmailCode(email.trim(), digits);
    // On success the session listener swaps this screen for the app.
    setState(error ? { kind: 'error', message: tr('login.codeError') } : { kind: 'idle' });
  }

  return (
    <main class="login">
      <div class="card login-card">
        <h1 class="brand">{tr('app.name')}</h1>
        <p class="muted">{tr('app.tagline')}</p>
        <h2>{tr('login.title')}</h2>
        <form onSubmit={onSend} class="stack">
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
          <button type="submit" class="btn primary" disabled={busy}>
            {state.kind === 'sending' ? tr('login.sending') : tr('login.submit')}
          </button>
        </form>

        <p role="status" aria-live="polite" class={state.kind === 'error' ? 'error' : 'muted'}>
          {state.kind === 'sent' && tr('login.sent')}
          {state.kind === 'error' && tr('login.error', { message: state.message })}
        </p>

        {!LOGIN_CODE_ENABLED ? null : showCode ? (
          <form onSubmit={onVerify} class="stack">
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
        )}

        <p class="muted small">{tr('login.inviteOnly')}</p>
        <LanguagePicker />
      </div>
    </main>
  );
}
