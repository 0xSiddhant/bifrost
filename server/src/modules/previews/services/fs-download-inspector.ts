import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { downloadIdFor } from '../../../core/download-id.js';
import type { DownloadInspector } from '../ports.js';

const TEXT_SAMPLE_BYTES = 4096;

export class FsDownloadInspector implements DownloadInspector {
  constructor(private readonly downloadsDir: string) {}

  /** On-demand scan — the folder is small and this needs no watcher state. */
  async findNameById(id: string): Promise<string | null> {
    const entries = await fsp.readdir(this.downloadsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      if (downloadIdFor(entry.name) === id) return entry.name;
    }
    return null;
  }

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

  private async confine(name: string): Promise<string> {
    const root = await fsp.realpath(this.downloadsDir);
    const resolved = await fsp.realpath(path.join(this.downloadsDir, name));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('path escapes downloads/');
    }
    return resolved;
  }
}
