// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DEFAULT_THEME } from './builtInDefault';

vi.mock('../heimdallAccess', () => ({
  fetchHeimdallAccess: () => Promise.resolve({ defaultThemeId: null }),
}));

const { INSTANT_CLASS, themeEngine } = await import('.');
const { BUNDLED_THEMES } = await import('./bundled');

/**
 * PLAN-40: the theme a page settles on as it loads must not fade in. A first
 * visit painted the stylesheet's defaults, then faded every colour to its
 * real theme, and each fading colour was an animation the compositor cannot
 * run. A visitor's own pick still fades.
 */
describe('applying a theme', () => {
  const root = document.documentElement;
  /** Whether transitions were off at each token write. */
  let instantAtWrite: boolean[];

  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = ((query: string) =>
      ({
        matches: query === '(prefers-color-scheme: light)',
        media: query,
      }) as MediaQueryList) as typeof window.matchMedia;
    instantAtWrite = [];
    const setProperty = root.style.setProperty.bind(root.style);
    vi.spyOn(root.style, 'setProperty').mockImplementation((name, value) => {
      instantAtWrite.push(root.classList.contains(INSTANT_CLASS));
      setProperty(name, value);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles on the first-visit theme at once, then turns transitions back on', async () => {
    themeEngine.init();
    await vi.waitFor(() => expect(root.getAttribute('data-theme')).toBe(BUILT_IN_DEFAULT_THEME));

    expect(instantAtWrite.length).toBeGreaterThan(10);
    expect(instantAtWrite.every(Boolean)).toBe(true);
    expect(root.classList.contains(INSTANT_CLASS)).toBe(false);
  });

  it("fades a visitor's own pick", () => {
    themeEngine.setTheme('tokyo');

    expect(root.getAttribute('data-theme')).toBe('tokyo');
    expect(instantAtWrite.length).toBeGreaterThan(10);
    expect(instantAtWrite.some(Boolean)).toBe(false);
  });

  it('replays a cached theme at once too', async () => {
    themeEngine.setTheme('olympus');
    instantAtWrite = [];

    themeEngine.init();

    // The cache replay is synchronous; the settle after it follows.
    expect(instantAtWrite.length).toBeGreaterThan(10);
    expect(instantAtWrite.every(Boolean)).toBe(true);
    await vi.waitFor(() => expect(root.classList.contains(INSTANT_CLASS)).toBe(false));
  });

  it('replays a cache an older build wrote as this build defines the theme', async () => {
    // Codex review: a pre-PLAN-40 cache has no --accent-text, so replaying it
    // as written showed the stylesheet's accent text until the household
    // default settled, and that request has no timeout.
    const tokyo = BUNDLED_THEMES.find((theme) => theme.id === 'tokyo')!;
    const legacyTokens = { ...tokyo.tokens };
    delete legacyTokens['--accent-text'];
    localStorage.setItem(
      'bifrost.theme.cache',
      JSON.stringify({ id: 'tokyo', mode: 'dark', tokens: legacyTokens }),
    );

    themeEngine.init();

    // Synchronously, before the household default answers.
    expect(root.getAttribute('data-theme')).toBe('tokyo');
    expect(root.style.getPropertyValue('--accent-text')).toBe(tokyo.tokens['--accent-text']);
    const refreshed = JSON.parse(localStorage.getItem('bifrost.theme.cache')!) as {
      tokens: Record<string, string>;
    };
    expect(refreshed.tokens['--accent-text']).toBe(tokyo.tokens['--accent-text']);
    await vi.waitFor(() => expect(root.getAttribute('data-theme')).toBe(BUILT_IN_DEFAULT_THEME));
  });
});
