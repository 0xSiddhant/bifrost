// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../heimdallAccess', () => ({
  fetchHeimdallAccess: () => Promise.resolve({ defaultThemeId: null }),
}));

const { INSTANT_CLASS, themeEngine } = await import('.');

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
    await vi.waitFor(() => expect(root.getAttribute('data-theme')).toBe('daybreak'));

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
});
