import { describe, expect, it } from 'vitest';
import { fr } from './fr';
import { es } from './es';
import { en } from './en';
import { detectLocale, format } from './index';

describe('dictionaries', () => {
  const frKeys = Object.keys(fr).sort();

  it.each([
    ['es', es],
    ['en', en],
  ])('%s has exactly the French keys', (_name, dict) => {
    expect(Object.keys(dict).sort()).toEqual(frKeys);
  });

  it.each([
    ['es', es],
    ['en', en],
  ])('%s keeps the same {placeholders} as French', (_name, dict) => {
    for (const key of frKeys) {
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(dict[key as keyof typeof fr]), key).toEqual(placeholders(fr[key as keyof typeof fr]));
    }
  });
});

describe('detectLocale', () => {
  it('prefers the saved choice', () => {
    expect(detectLocale('en', ['es-ES'])).toBe('en');
  });
  it('falls back to the browser language', () => {
    expect(detectLocale(null, ['de-DE', 'es-ES'])).toBe('es');
  });
  it('ignores an invalid saved value and defaults to French', () => {
    expect(detectLocale('xx', ['de-DE'])).toBe('fr');
  });
});

describe('format', () => {
  it('fills named parameters and leaves unknown ones', () => {
    expect(format('Synchro {time} {other}', { time: '14:05' })).toBe('Synchro 14:05 {other}');
  });
});
