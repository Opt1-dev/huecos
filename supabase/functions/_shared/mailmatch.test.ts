import { describe, expect, it } from 'vitest';
import { htmlToText, matchMail, type MailText } from './mailmatch.ts';

const mail = (extra: Partial<MailText> = {}): MailText => ({
  subject: 'María ha hecho un comentario en la tarea UT4',
  body: 'Hola Tomás, la profesora ha aportado alguna retroalimentación en su entrega de la tarea UT4 – Formularios. Puede consultarla en la plataforma.',
  senderName: 'Plataforma CESUR',
  senderAddress: 'noreply-plataforma@cesurformacion.com',
  ...extra,
});

describe('matchMail', () => {
  it('finds a keyword in the text, ignoring case and accents, with an excerpt', () => {
    const m = matchMail(mail(), [{ keyword: 'Retroalimentacion', sender: null }]);
    expect(m?.keywords).toEqual(['Retroalimentacion']);
    expect(m?.snippet).toContain('retroalimentación en su entrega');
  });

  it('finds a keyword in the subject', () => {
    const m = matchMail(mail({ body: '' }), [{ keyword: 'comentario', sender: null }]);
    expect(m?.keywords).toEqual(['comentario']);
    expect(m?.snippet).toBe('María ha hecho un comentario en la tarea UT4');
  });

  it('lists every keyword found', () => {
    const m = matchMail(mail(), [
      { keyword: 'retroalimentación', sender: null },
      { keyword: 'UT4', sender: null },
      { keyword: 'examen', sender: null },
    ]);
    expect(m?.keywords).toEqual(['retroalimentación', 'UT4']);
  });

  it('respects the sender filter (address or name)', () => {
    expect(matchMail(mail(), [{ keyword: 'tarea', sender: 'cesurformacion.com' }])).not.toBeNull();
    expect(matchMail(mail(), [{ keyword: 'tarea', sender: 'plataforma cesur' }])).not.toBeNull();
    expect(matchMail(mail(), [{ keyword: 'tarea', sender: 'gmail.com' }])).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchMail(mail(), [{ keyword: 'factura', sender: null }])).toBeNull();
    expect(matchMail(mail(), [])).toBeNull();
  });

  it('keeps the excerpt short and marks the cuts', () => {
    const long = `${'mot '.repeat(200)}urgent ${'suite '.repeat(200)}`;
    const m = matchMail(mail({ body: long }), [{ keyword: 'urgent', sender: null }]);
    expect(m!.snippet.length).toBeLessThanOrEqual(245);
    expect(m!.snippet.startsWith('…')).toBe(true);
    expect(m!.snippet.endsWith('…')).toBe(true);
    expect(m!.snippet).toContain('urgent');
  });
});

describe('htmlToText', () => {
  it('drops tags, styles and entities', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Bonjour&nbsp;Tom&amp;s</p><p>Ligne 2</p>')).toBe('Bonjour Tom&s\n Ligne 2');
  });
});
