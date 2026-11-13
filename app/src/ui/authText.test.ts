import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { authErrorText } from './authText';

describe('authErrorText', () => {
  const tr = t.value;
  it.each([
    ['Invalid login credentials', 'login.badCredentials'],
    ['Huecos is invite-only. Ask the owner for an invitation.', 'join.badCode'],
    ['User already registered', 'join.exists'],
    ['email rate limit exceeded', 'login.rateLimited'],
    ['For security purposes, you can only request this after 42 seconds.', 'login.rateLimited'],
    ['Email not confirmed', 'login.notConfirmed'],
    ['Password should be at least 6 characters.', 'join.weak'],
  ] as const)('%s', (message, key) => {
    expect(authErrorText(message)).toBe(tr(key));
  });

  it('keeps unknown messages', () => {
    expect(authErrorText('Something else')).toBe('Something else');
  });
});
