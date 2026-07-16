import { apiGet } from './api';
import { bifrostEvents } from './sse';

export type ThemeMode = 'dark' | 'light';

export interface ThemeSummary {
  id: string;
  name: string;
  mode: ThemeMode;
  preview: { bg: string; accent: string };
  builtIn: boolean;
  warnings: string[];
}

export interface ResolvedTheme extends ThemeSummary {
  tokens: Record<string, string>;
}

interface ThemeListing {
  defaultId: string | null;
  themes: ThemeSummary[];
}

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
 * visitor choice → explicit server default → prefers-color-scheme match →
 * first available.
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

class ThemeEngine {
  private themes: ThemeSummary[] = [];
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

  /** Replay the cached theme synchronously, then reconcile against the server. */
  init(): void {
    const cached = this.readCache();
    if (cached) {
      this.apply(cached, { cache: false });
    }
    void this.refresh();
    bifrostEvents.on('theme.updated', (payload) => {
      const { themes } = payload as { themes: ThemeSummary[] };
      this.themes = themes;
      void this.reconcile();
    });
  }

  /** Explicit visitor pick from the switcher. */
  async setTheme(id: string): Promise<void> {
    localStorage.setItem(CHOICE_KEY, id);
    await this.load(id);
  }

  private async refresh(): Promise<void> {
    try {
      const listing = await apiGet<ThemeListing>('/api/themes');
      this.themes = listing.themes;
      await this.reconcile(listing.defaultId);
    } catch {
      // Offline or pre-PLAN-04 server: cached/stylesheet tokens keep working.
      this.notify();
    }
  }

  private async reconcile(defaultId?: string | null): Promise<void> {
    const choice = resolveThemeChoice({
      stored: localStorage.getItem(CHOICE_KEY),
      defaultId: defaultId ?? null,
      themes: this.themes,
      prefersLight: window.matchMedia('(prefers-color-scheme: light)').matches,
    });
    if (choice) {
      // Re-fetch even when the id matches — a watcher edit may have changed tokens.
      await this.load(choice);
    } else {
      this.notify();
    }
  }

  private async load(id: string): Promise<void> {
    try {
      this.apply(await apiGet<ResolvedTheme>(`/api/themes/${id}`), { cache: true });
    } catch {
      this.notify();
    }
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
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ id: theme.id, mode: theme.mode, tokens: theme.tokens }),
      );
    }
    this.notify();
  }

  private readCache(): ResolvedTheme | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw) as { id: string; mode: ThemeMode; tokens: unknown };
      if (!cached.id || typeof cached.tokens !== 'object' || cached.tokens === null) return null;
      return {
        id: cached.id,
        name: cached.id,
        mode: cached.mode === 'light' ? 'light' : 'dark',
        preview: { bg: '', accent: '' },
        builtIn: true,
        warnings: [],
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

export const themeEngine = new ThemeEngine();

export function initTheme(): void {
  themeEngine.init();
}
