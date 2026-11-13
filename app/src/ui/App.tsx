import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { clearJoinCode, joinCode, passwordRecovery, session, updatePassword } from '../lib/session';
import { Join } from './Join';
import { Login } from './Login';
import { PasswordFields, passwordsOk } from './PasswordFields';
import { Shell } from './Shell';
import { UpdatePrompt } from './UpdatePrompt';
import { authErrorText } from './authText';

export function App() {
  const [code, setCode] = useState(joinCode);
  const signedIn = Boolean(session.value);

  // Already signed in: the sign-up link has nothing to do.
  useEffect(() => {
    if (signedIn && code) {
      clearJoinCode();
      setCode(null);
    }
  }, [signedIn, code]);

  if (session.value === undefined) return <div class="splash" aria-busy="true" />;
  return (
    <>
      {session.value ? <Shell /> : code ? <Join code={code} onSignIn={() => setCode(null)} /> : <Login />}
      {session.value && passwordRecovery.value && <NewPasswordDialog />}
      <UpdatePrompt />
    </>
  );
}

/** Shown after opening a password-reset link. */
function NewPasswordDialog() {
  const tr = t.value;
  const ref = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await updatePassword(password);
    setBusy(false);
    if (err) setError(authErrorText(err));
  }

  return (
    <dialog ref={ref} class="dialog" aria-labelledby="newpw-title" onClose={() => (passwordRecovery.value = false)}>
      <form class="stack" onSubmit={(e) => void submit(e)}>
        <h2 id="newpw-title">{tr('account.newPasswordTitle')}</h2>
        <PasswordFields idPrefix="recover" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <p role="alert" class="error small">
          {error ?? ''}
        </p>
        <div class="actions">
          <button type="submit" class="btn primary" disabled={busy || !passwordsOk(password, confirm)}>
            {tr('account.savePassword')}
          </button>
          <button type="button" class="btn ghost" onClick={() => ref.current?.close()}>
            {tr('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
