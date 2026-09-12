import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { downloadIdFor } from '../../../core/download-id.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadInspector, FileInspector } from '../ports.js';

const TEXT_SAMPLE_BYTES = 4096;

/**
 * Inspects files inside one folder. Every read resolves through `realpath` and
 * must land inside that folder — since PLAN-17b this same class also serves
 * uploads/, which is writable by anyone on the LAN, so the confinement is now
 * doing real work rather than defence in depth.
 */
export class FsFileInspector implements FileInspector {
  constructor(protected readonly dir: string) {}

  async stat(name: string): Promise<{ size: number }> {
    const stat = await fsp.stat(await this.confine(name));
    if (!stat.isFile()) throw new Error('not a regular file');
    return { size: stat.size };
  }

  async sniffMime(name: string): Promise<string | undefined> {
    const detected = await fileTypeFromFile(await this.confine(name));
    return detected?.mime;
  }

  async looksLikeText(name: string): Promise<boolean> {
    const handle = await fsp.open(await this.confine(name), 'r');
    try {
      const buffer = Buffer.alloc(TEXT_SAMPLE_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, TEXT_SAMPLE_BYTES, 0);
      return !buffer.subarray(0, bytesRead).includes(0);
    } finally {
      await handle.close();
    }
  }

  protected async confine(name: string): Promise<string> {
    const root = await fsp.realpath(this.dir);
    const resolved = await fsp.realpath(path.join(this.dir, name));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('path escapes the inspected folder');
    }
    return resolved;
  }
}

/** Downloads additionally resolve the opaque listing id to a filename. */
export class FsDownloadInspector extends FsFileInspector implements DownloadInspector {
  constructor(
    dir: string,
    private readonly log: Logger,
  ) {
    super(dir);
  }

  /**
   * On-demand scan — the folder is small and this needs no watcher state, which
   * is the independence from file-transfer's registry that lets both modules
   * derive the same id without talking (decisions.md, 2026-07-14).
   *
   * Since PLAN-24 it walks **one** level of subdirectories, hashing the path
   * relative to downloads/ exactly as the watcher does — the same depth the
   * listing shows, so a file the app never lists is never previewable either.
   */
  async findNameById(id: string): Promise<string | null> {
    const entries = await fsp.readdir(this.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isFile()) {
        if (downloadIdFor(entry.name) === id) return entry.name;
        continue;
      }
      if (!entry.isDirectory()) continue;
      for (const child of await this.readFolder(entry.name)) {
        const relative = `${entry.name}/${child}`;
        if (downloadIdFor(relative) === id) return relative;
      }
    }
    return null;
  }

  private async readFolder(folder: string): Promise<string[]> {
    try {
      const children = await fsp.readdir(path.join(this.dir, folder), { withFileTypes: true });
      return children.filter((c) => c.isFile() && !c.name.startsWith('.')).map((c) => c.name);
    } catch (error) {
      // A folder removed between the two readdirs, or one this process cannot
      // read: it holds nothing resolvable either way, and the scan must go on
      // to the remaining folders rather than fail the whole lookup.
      this.log.warn({ err: error, folder }, 'could not scan a downloads subfolder');
      return [];
    }
  }
}
