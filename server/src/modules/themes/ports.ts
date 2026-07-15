import type { ThemeSummary } from '../../core/bus/events.js';

export type ThemeMode = 'dark' | 'light';

/** A theme file exactly as authored (post-ajv). */
export interface ThemeFile {
  id: string;
  name: string;
  mode: ThemeMode;
  tokens: Record<string, string>;
}

/** Authored tokens + derived defaults for everything omitted. */
export interface ResolvedTheme extends ThemeSummary {
  tokens: Record<string, string>;
}

export function toSummary(theme: ResolvedTheme): ThemeSummary {
  return {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    preview: theme.preview,
    builtIn: theme.builtIn,
    warnings: theme.warnings,
  };
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ThemeValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super('theme failed validation');
    this.name = 'ThemeValidationError';
  }
}

/** Filesystem access to themes/ — usecases never touch fs directly. */
export interface ThemeStore {
  /** [fileName, rawJsonText] pairs for every *.json in themes/. */
  listFiles(): Promise<[string, string][]>;
  readFile(fileName: string): Promise<string | null>;
  writeFile(fileName: string, content: string): Promise<void>;
  deleteFile(fileName: string): Promise<void>;
}

/** In-memory validated set, owned by the loader/watcher. */
export interface ThemeRegistry {
  list(): ResolvedTheme[];
  get(id: string): ResolvedTheme | null;
  fileNameOf(id: string): string | null;
}
