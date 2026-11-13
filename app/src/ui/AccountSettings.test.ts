import { describe, expect, it } from 'vitest';
import { newPasswordOk } from './AccountSettings';

describe('newPasswordOk', () => {
  it('needs the current password', () => expect(newPasswordOk('', 'nouveau-mdp')).toBe(false));
  it('needs at least 8 characters', () => expect(newPasswordOk('ancien-mdp', 'court')).toBe(false));
  it('refuses the same password', () => expect(newPasswordOk('pareil-123', 'pareil-123')).toBe(false));
  it('accepts a different, long enough password', () => expect(newPasswordOk('ancien-mdp', 'nouveau-mdp')).toBe(true));
});
