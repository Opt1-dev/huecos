import { t } from '../i18n';

/** Supabase Auth error message → text for the user. */
export function authErrorText(message: string): string {
  const tr = t.value;
  if (/invalid login credentials/i.test(message)) return tr('login.badCredentials');
  if (/banned/i.test(message)) return tr('login.banned');
  if (/invite-only/i.test(message)) return tr('join.badCode');
  // The link was used up by someone else at the same moment.
  if (/database error saving new user/i.test(message)) return tr('join.badCode');
  if (/already (been )?registered|already exists/i.test(message)) return tr('join.exists');
  if (/rate limit|after \d+ seconds/i.test(message)) return tr('login.rateLimited');
  if (/email not confirmed/i.test(message)) return tr('login.notConfirmed');
  if (/password/i.test(message) && /(at least|short|weak|characters)/i.test(message)) return tr('join.weak');
  return message;
}
