import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../../../core/logger/index.js';
import {
  UploadNotFoundError,
  type DownloadContent,
  type UploadFile,
  type UploadsStore,
} from '../ports.js';
import { placeFile } from './place-file.js';

/**
 * The uploads/ folder as a staging area (PLAN-17b).
 *
 * Until this plan, uploads/ had no read route at all — that was a deliberate
 * decision, now deliberately superseded: a sender needs to see what they just
 * sent, fix its name, delete a mistake, or publish it to everyone. What does
 * *not* change is the confinement: every name is resolved with `realpath` and
 * proven to sit inside uploads/ before anything touches it, so a symlink or a
 * `..` in the parameter dead-ends here rather than in the filesystem.
 */
export class FsUploadsStore implements UploadsStore {
  constructor(
    private readonly uploadsDir: string,
    private readonly downloadsDir: string,
    private readonly log: Logger,
  ) {}

  async stat(name: string): Promise<UploadFile> {
    const resolved = await this.confine(name);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new UploadNotFoundError(`${name} is not a regular file`);
    return { name, size: stat.size, mtime: Math.round(stat.mtimeMs) };
  }

  async open(name: string, slice?: { start: number; end: number }): Promise<DownloadContent> {
    const resolved = await this.confine(name);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new UploadNotFoundError(`${name} is not a regular file`);
    return {
      stream: fs.createReadStream(resolved, slice ? { start: slice.start, end: slice.end } : {}),
      size: stat.size,
    };
  }

  async rename(name: string, desiredName: string): Promise<{ finalName: string; renamed: boolean }> {
    const resolved = await this.confine(name);
    if (desiredName === name) return { finalName: name, renamed: false };
    const placed = await placeFile(this.uploadsDir, resolved, desiredName);
    await fsp.rm(resolved, { force: true });
    return placed;
  }

  async remove(name: string): Promise<void> {
    const resolved = await this.confine(name);
    await fsp.rm(resolved, { force: true });
  }

  async publish(name: string): Promise<{ finalName: string; renamed: boolean; size: number }> {
    const resolved = await this.confine(name);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new UploadNotFoundError(`${name} is not a regular file`);

    // Link first, unlink second: the file is complete under its new name
    // before it stops existing under the old one, so a crash can strand a
    // duplicate but never a gap and never a half-written file. The duplicate
    // is swept at the next boot (`sweepPublishedDuplicates`).
    const placed = await placeFile(this.downloadsDir, resolved, name);
    await fsp.rm(resolved, { force: true });
    return { ...placed, size: stat.size };
  }

  /**
   * Resolve `name` to a real file inside uploads/. The name is a single path
   * segment by route schema; this is the second lock — `realpath` follows
   * symlinks, so a link planted in uploads/ pointing at ~/.ssh resolves outside
   * the root and is refused here rather than served.
   */
  private async confine(name: string): Promise<string> {
    if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
      throw new UploadNotFoundError(`illegal upload name: ${name}`);
    }
    let root: string;
    let resolved: string;
    try {
      root = await fsp.realpath(this.uploadsDir);
      resolved = await fsp.realpath(path.join(this.uploadsDir, name));
    } catch {
      // ENOENT is the common case (already moved, already deleted, or a name
      // the caller invented) and is not worth a line; the route turns it into
      // the 404 the stale-card path expects.
      throw new UploadNotFoundError(`no such upload: ${name}`);
    }
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      // Not ordinary: something inside uploads/ points outside it. Whether it
      // is a probe or a stray symlink, it is the one case worth a line.
      this.log.warn({ name, resolved }, 'upload path escapes uploads/ — refused');
      throw new UploadNotFoundError('path escapes uploads/');
    }
    return resolved;
  }
}
