import { LOCALES, LOCALE_NAMES, locale, setLocale, isLocale, t } from '../i18n';

export function LanguagePicker() {
  return (
    <label class="field inline">
      <span>{t.value('settings.language')}</span>
      <select
        value={locale.value}
        onChange={(e) => {
          const value = (e.target as HTMLSelectElement).value;
          if (isLocale(value)) setLocale(value);
        }}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
