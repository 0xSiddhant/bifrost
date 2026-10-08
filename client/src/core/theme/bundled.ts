import { resolveTheme, type ResolvedTheme, type ThemeFile } from './resolve';

/**
 * The themes this client ships (PLAN-35): every JSON file in
 * `client/src/assets/themes/`, resolved once at load and sorted by name, as
 * the server's listing was. A theme is code now, so a bad one fails
 * `themes.test.ts` in CI rather than rendering wrong on someone's phone.
 */
const files = import.meta.glob<ThemeFile>('../../assets/themes/*.json', {
  eager: true,
  import: 'default',
});

export const BUNDLED_THEMES: readonly ResolvedTheme[] = Object.values(files)
  .map(resolveTheme)
  .sort((a, b) => a.name.localeCompare(b.name));
