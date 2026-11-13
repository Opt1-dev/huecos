import { signal, computed } from '@preact/signals';
import { fr, type MessageKey, type Dictionary } from './fr';
import { es } from './es';
import { en } from './en';

export const LOCALES = ['fr', 'es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = { fr: 'Français', es: 'Español', en: 'English' };

const dictionaries: Record<Locale, Dictionary> = { fr, es, en };
const STORAGE_KEY = 'huecos.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Saved choice first, then the browser language, then French. */
export function detectLocale(saved: string | null, browserLanguages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const lang of browserLanguages) {
    const short = lang.slice(0, 2).toLowerCase();
    if (isLocale(short)) return short;
  }
  return 'fr';
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const locale = signal<Locale>(
  detectLocale(readSaved(), typeof navigator === 'undefined' ? [] : navigator.languages),
);

export function setLocale(next: Locale): void {
  locale.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode: keep the choice for this session only */
  }
  document.documentElement.lang = next;
}

export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function translate(loc: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  return format(dictionaries[loc][key], params);
}

/** Reactive translator: components re-render when the locale signal changes. */
export const t = computed(
  () => (key: MessageKey, params?: Record<string, string | number>) => translate(locale.value, key, params),
);

export { dictionaries };
export type { MessageKey };
