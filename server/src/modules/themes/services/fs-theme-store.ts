import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ThemeStore } from '../ports.js';

/** themes/*.json on disk. File names are `<id>.json`; ids are schema-constrained. */
export class FsThemeStore implements ThemeStore {
  constructor(private readonly themesDir: string) {}

  async listFiles(): Promise<[string, string][]> {
    const entries = await fsp.readdir(this.themesDir, { withFileTypes: true }).catch(() => []);
    const files: [string, string][] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('.')) continue;
      const content = await fsp.readFile(path.join(this.themesDir, entry.name), 'utf8');
      files.push([entry.name, content]);
    }
    return files;
  }

  async readFile(fileName: string): Promise<string | null> {
    try {
      return await fsp.readFile(path.join(this.themesDir, this.confine(fileName)), 'utf8');
    } catch {
      return null;
    }
  }

  async writeFile(fileName: string, content: string): Promise<void> {
    await fsp.mkdir(this.themesDir, { recursive: true });
    await fsp.writeFile(path.join(this.themesDir, this.confine(fileName)), content, 'utf8');
  }

  async deleteFile(fileName: string): Promise<void> {
    await fsp.rm(path.join(this.themesDir, this.confine(fileName)), { force: true });
  }

  /** File names come from validated ids, but never trust a path segment anyway. */
  private confine(fileName: string): string {
    const base = path.basename(fileName);
    if (base !== fileName || !/^[a-z0-9-]+\.json$/.test(base)) {
      throw new Error(`illegal theme file name: ${fileName}`);
    }
    return base;
  }
}
