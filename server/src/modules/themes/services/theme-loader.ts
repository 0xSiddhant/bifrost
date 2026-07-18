import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { ThemeSummary } from '../../../core/bus/events.js';
import type { EventBus } from '../../../core/bus/index.js';
import type { Logger } from '../../../core/logger/index.js';
import { resolveTheme } from '../resolve.js';
import {
  ThemeValidationError,
  toSummary,
  type ResolvedTheme,
  type ThemeRegistry,
  type ThemeStore,
} from '../ports.js';
import type { ThemeValidator } from './theme-validator.js';

export const BUILT_IN_THEME_IDS = new Set(['aurora', 'daybreak', 'ghibli-dusk', 'olympus']);

interface LoadedTheme {
  theme: ResolvedTheme;
  fileName: string;
}

/**
 * Owns the validated in-memory set. Boot scan is synchronous with module
 * registration; afterwards a chokidar watch on themes/ keeps the set live —
 * drop a JSON in Finder and every open client hears `theme.updated`. An
 * invalid file is skipped with a structured log line and never crashes boot.
 */
export class ThemeLoaderService implements ThemeRegistry {
  private readonly themes = new Map<string, LoadedTheme>();
  private watcher: FSWatcher | null = null;
  private ready = false;

  constructor(
    private readonly themesDir: string,
    private readonly store: ThemeStore,
    private readonly validator: ThemeValidator,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    for (const [fileName, raw] of await this.store.listFiles()) {
      this.loadOne(fileName, raw);
    }
    this.log.info({ themes: this.themes.size }, 'themes loaded from boot scan');

    this.watcher = watch(this.themesDir, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      ignored: (target, stats) =>
        Boolean(stats?.isFile()) && !path.basename(target).endsWith('.json'),
    });
    const onFile = (file: string) => {
      void this.reloadFromDisk(path.basename(file));
    };
    this.watcher.on('add', onFile);
    this.watcher.on('change', onFile);
    this.watcher.on('unlink', (file) => this.removeByFileName(path.basename(file)));
    this.watcher.on('error', (error) => this.log.error({ err: error }, 'themes watcher error'));
    await new Promise<void>((resolve) => this.watcher?.once('ready', () => resolve()));
    this.ready = true;
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  list(): ResolvedTheme[] {
    return [...this.themes.values()]
      .map((loaded) => loaded.theme)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ResolvedTheme | null {
    return this.themes.get(id)?.theme ?? null;
  }

  fileNameOf(id: string): string | null {
    return this.themes.get(id)?.fileName ?? null;
  }

  summaries(): ThemeSummary[] {
    return this.list().map(toSummary);
  }

  /** Registry write path shared by watcher events and the POST usecase. */
  async reloadFromDisk(fileName: string): Promise<void> {
    const raw = await this.store.readFile(fileName);
    if (raw === null) return;
    this.loadOne(fileName, raw);
    this.announce();
  }

  removeByFileName(fileName: string): void {
    for (const [id, loaded] of this.themes) {
      if (loaded.fileName !== fileName) continue;
      this.themes.delete(id);
      this.log.info({ theme: id, fileName }, 'theme removed');
      if (BUILT_IN_THEME_IDS.has(id)) {
        this.log.warn({ theme: id }, 'built-in theme file deleted from disk');
      }
    }
    this.announce();
  }

  private loadOne(fileName: string, raw: string): void {
    try {
      const parsed = this.validator.parse(raw);
      const existing = this.themes.get(parsed.id);
      if (existing && existing.fileName !== fileName) {
        this.log.warn(
          { theme: parsed.id, fileName, existingFile: existing.fileName },
          'duplicate theme id — file skipped',
        );
        return;
      }
      const theme = resolveTheme(parsed, BUILT_IN_THEME_IDS.has(parsed.id));
      this.themes.set(parsed.id, { theme, fileName });
      for (const warning of theme.warnings) {
        this.log.warn({ theme: parsed.id, warning }, 'theme contrast warning');
      }
      this.log.info({ theme: parsed.id, fileName }, 'theme loaded');
    } catch (error) {
      if (error instanceof ThemeValidationError) {
        this.log.error(
          { fileName, issues: error.issues },
          'invalid theme file skipped — app keeps running',
        );
      } else {
        this.log.error({ fileName, err: error }, 'theme file could not be read');
      }
    }
  }

  private announce(): void {
    if (this.ready) this.bus.emit('theme.updated', { themes: this.summaries() });
  }
}
