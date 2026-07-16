import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DownloadContent, DownloadReader } from '../ports.js';

/**
 * Streams files out of downloads/ — after proving, via realpath, that the
 * resolved target actually lives inside downloads/ (security default in
 * rules/coding.md). Symlinks pointing elsewhere are refused.
 */
export class FsDownloadReader implements DownloadReader {
  constructor(private readonly downloadsDir: string) {}

  async stat(name: string): Promise<{ size: number }> {
    const resolved = await this.confine(name);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error('not a regular file');
    return { size: stat.size };
  }

  async open(name: string, slice?: { start: number; end: number }): Promise<DownloadContent> {
    const resolved = await this.confine(name);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error('not a regular file');
    return {
      stream: fs.createReadStream(resolved, slice ? { start: slice.start, end: slice.end } : {}),
      size: stat.size,
    };
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
