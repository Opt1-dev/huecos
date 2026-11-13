import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { sendMagicLink } from '../lib/session';
import { LanguagePicker } from './LanguagePicker';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

export function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const tr = t.value;

  async function onSubmit(event: Event) {
    event.preventDefault();
    setState({ kind: 'sending' });
    const { error } = await sendMagicLink(email.trim());
    setState(error ? { kind: 'error', message: error } : { kind: 'sent' });
  }

  return (
    <main class="login">
      <div class="card login-card">
        <h1 class="brand">{tr('app.name')}</h1>
        <p class="muted">{tr('app.tagline')}</p>
        <h2>{tr('login.title')}</h2>
        <form onSubmit={onSubmit} class="stack">
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
          <button type="submit" class="btn primary" disabled={state.kind === 'sending'}>
            {state.kind === 'sending' ? tr('login.sending') : tr('login.submit')}
          </button>
        </form>
        <p role="status" aria-live="polite" class={state.kind === 'error' ? 'error' : 'muted'}>
          {state.kind === 'sent' && tr('login.sent')}
          {state.kind === 'error' && tr('login.error', { message: state.message })}
        </p>
        <p class="muted small">{tr('login.inviteOnly')}</p>
        <LanguagePicker />
      </div>
    </main>
  );
}
