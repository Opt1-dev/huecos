import { t } from '../i18n';
import { MIN_PASSWORD } from '../lib/session';

interface Props {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  idPrefix: string;
}

/** True when both fields are filled, long enough and identical. */
export function passwordsOk(password: string, confirm: string): boolean {
  return password.length >= MIN_PASSWORD && password === confirm;
}

/** New password + confirmation, with inline hints. */
export function PasswordFields({ password, confirm, onPassword, onConfirm, idPrefix }: Props) {
  const tr = t.value;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <>
      <label class="field">
        <span>{tr('join.password')}</span>
        <input
          type="password"
          autocomplete="new-password"
          minLength={MIN_PASSWORD}
          required
          value={password}
          aria-describedby={`${idPrefix}-pw-help`}
          aria-invalid={tooShort}
          onInput={(e) => onPassword((e.target as HTMLInputElement).value)}
        />
      </label>
      <span id={`${idPrefix}-pw-help`} class={tooShort ? 'error small' : 'muted small'}>
        {tr('join.passwordHelp', { n: MIN_PASSWORD })}
      </span>
      <label class="field">
        <span>{tr('join.confirm')}</span>
        <input
          type="password"
          autocomplete="new-password"
          required
          value={confirm}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? `${idPrefix}-mismatch` : undefined}
          onInput={(e) => onConfirm((e.target as HTMLInputElement).value)}
        />
      </label>
      {mismatch && (
        <span id={`${idPrefix}-mismatch`} class="error small">
          {tr('join.mismatch')}
        </span>
      )}
    </>
  );
}
