export type ThemeName = 'aurora' | 'daybreak';

const STORAGE_KEY = 'bifrost.theme';

/**
 * Theme = one attribute on <html>. The theme engine (PLAN-04) replaces the
 * hardcoded list with JSON-defined themes; the mechanism stays identical.
 * Caching the choice locally is explicitly allowed (rules: theme may cache).
 */
export function getTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'daybreak' ? 'daybreak' : 'aurora';
}

export function applyTheme(theme: ThemeName): void {
  if (theme === 'aurora') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

export function initTheme(): void {
  applyTheme(getTheme());
}
