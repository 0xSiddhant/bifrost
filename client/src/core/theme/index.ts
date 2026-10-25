import { fetchHeimdallAccess } from '../heimdallAccess';
import { BUNDLED_THEMES } from './bundled';
import type { ResolvedTheme, ThemeMode, ThemeSummary } from './resolve';

export type { ResolvedTheme, ThemeMode, ThemeSummary } from './resolve';

/** Visitor's explicit pick — same key PLAN-01 used, values stay compatible. */
const CHOICE_KEY = 'bifrost.theme';
/** Full token map of the applied theme; the index.html FOUC script replays it. */
const CACHE_KEY = 'bifrost.theme.cache';

export interface ThemeEngineState {
  themes: ThemeSummary[];
  activeId: string | null;
}

/**
 * PLAN-04 resolution order, pure for testability:
 * visitor choice → the household default (hub only) → prefers-color-scheme
 * match → first available. An unknown id at any step simply falls through.
 */
export function resolveThemeChoice(input: {
  stored: string | null;
  defaultId: string | null;
  themes: Pick<ThemeSummary, 'id' | 'mode'>[];
  prefersLight: boolean;
}): string | null {
  const { stored, defaultId, themes, prefersLight } = input;
  const has = (id: string | null) => themes.some((theme) => theme.id === id);
  if (stored && has(stored)) return stored;
  if (defaultId && has(defaultId)) return defaultId;
  const wanted: ThemeMode = prefersLight ? 'light' : 'dark';
  return themes.find((theme) => theme.mode === wanted)?.id ?? themes[0]?.id ?? null;
}

type Listener = (state: ThemeEngineState) => void;

/**
 * Applies a theme as CSS custom properties on `:root`. Themes are bundled
 * (PLAN-35), so nothing here touches the network except, in the hub build,
 * one read of the household default. The token cache and the `index.html`
 * replay are unchanged, so first paint is exactly as before.
 */
class ThemeEngine {
  private themes: ThemeSummary[] = BUNDLED_THEMES.map(({ id, name, mode, preview }) => ({
    id,
    name,
    mode,
    preview,
  }));
  private activeId: string | null = null;
  private appliedKeys: string[] = [];
  private readonly listeners = new Set<Listener>();

  getState(): ThemeEngineState {
    return { themes: this.themes, activeId: this.activeId };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replay the cached theme synchronously, then settle on the right one. */
  init(): void {
    const cached = this.readCache();
    if (cached) {
      this.apply(cached, { cache: false });
    }
    if (!__HUB__) {
      // No household on the standalone site: the device's own choice decides.
      this.reconcile(null);
      return;
    }
    fetchHeimdallAccess()
      .then((access) => this.reconcile(access.defaultThemeId))
      .catch(() => {
        // Deliberately silent (PLAN-16a audit): without the household default
        // the device's own choice and colour scheme still pick a correct
        // theme, so this is a designed fallback. It also fires on every load
        // while the hub is down, which would bury the archive for no signal.
        this.reconcile(null);
      });
  }

  /** Explicit visitor pick from the switcher. */
  setTheme(id: string): void {
    writeStorage(CHOICE_KEY, id);
    this.load(id);
  }

  private reconcile(defaultId: string | null): void {
    const choice = resolveThemeChoice({
      stored: readStorage(CHOICE_KEY),
      defaultId,
      themes: this.themes,
      prefersLight: window.matchMedia('(prefers-color-scheme: light)').matches,
    });
    if (choice) this.load(choice);
    else this.notify();
  }

  private load(id: string): void {
    const theme = BUNDLED_THEMES.find((candidate) => candidate.id === id);
    if (theme) this.apply(theme, { cache: true });
    else this.notify();
  }

  private apply(theme: ResolvedTheme, options: { cache: boolean }): void {
    const root = document.documentElement;
    // Clear what the previous theme set: a theme that omits an optional token
    // must fall back to the stylesheet default, not inherit its predecessor's.
    for (const key of this.appliedKeys) root.style.removeProperty(key);
    for (const [key, value] of Object.entries(theme.tokens)) root.style.setProperty(key, value);
    this.appliedKeys = Object.keys(theme.tokens);
    root.style.colorScheme = theme.mode;
    // data-theme keeps CSS attribute hooks and observers (QrCard) working.
    root.setAttribute('data-theme', theme.id);
    this.activeId = theme.id;
    if (options.cache) {
      writeStorage(
        CACHE_KEY,
        JSON.stringify({ id: theme.id, mode: theme.mode, tokens: theme.tokens }),
      );
    }
    this.notify();
  }

  private readCache(): ResolvedTheme | null {
    try {
      const raw = readStorage(CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw) as { id: string; mode: ThemeMode; tokens: unknown };
      if (!cached.id || typeof cached.tokens !== 'object' || cached.tokens === null) return null;
      return {
        id: cached.id,
        name: cached.id,
        mode: cached.mode === 'light' ? 'light' : 'dark',
        preview: { bg: '', accent: '' },
        tokens: cached.tokens as Record<string, string>,
      };
    } catch {
      return null;
    }
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

/**
 * localStorage that cannot crash the page: Safari's private mode and a
 * cleared or blocked store throw on access. Deliberately silent, the designed
 * fallback the coding rules name for `core/theme`: the theme simply is not
 * remembered for next time.
 */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // See readStorage.
  }
}

export const themeEngine = new ThemeEngine();

export function initTheme(): void {
  themeEngine.init();
}
