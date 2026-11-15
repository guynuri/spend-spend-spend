export type Theme = 'light' | 'dark' | 'system';
const LS_KEY = 'mz_theme';

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && mq().matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, t);
  } catch {
    /* storage unavailable */
  }
  applyTheme(t);
}

export function initTheme() {
  applyTheme(storedTheme());
  mq().addEventListener('change', () => applyTheme(storedTheme()));
}
