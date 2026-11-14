import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../shared/i18n/en.json';
import he from '../shared/i18n/he.json';
import type { Locale } from '../shared/money';

const LS_KEY = 'mz_locale';

export function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === 'he' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function deviceLocale(): Locale | null {
  for (const l of navigator.languages ?? [navigator.language]) {
    const p = l.toLowerCase().slice(0, 2);
    if (p === 'he' || p === 'iw') return 'he';
    if (p === 'en') return 'en';
  }
  return null;
}

/** users.locale → localStorage → device → DEFAULT_LOCALE (en). */
export function resolveLocale(userLocale?: string | null): Locale {
  if (userLocale === 'he' || userLocale === 'en') return userLocale;
  return storedLocale() ?? deviceLocale() ?? 'en';
}

export function applyDocumentLocale(l: Locale) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'he' ? 'rtl' : 'ltr';
}

export async function setLocale(l: Locale) {
  try {
    localStorage.setItem(LS_KEY, l);
  } catch {
    /* storage unavailable */
  }
  applyDocumentLocale(l);
  await i18n.changeLanguage(l);
}

const initial = resolveLocale();
applyDocumentLocale(initial);

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, he: { translation: he } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const currentLocale = (): Locale => (i18n.language === 'he' ? 'he' : 'en');
export default i18n;
