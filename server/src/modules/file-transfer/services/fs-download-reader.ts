import fs, { type Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  DownloadChangedError,
  DownloadTypeChangedError,
  DownloadUnsafeEntryError,
  type DownloadContent,
  type DownloadDeleteSnapshot,
  type DownloadReader,
} from '../ports.js';
import { DownloadFolderLock } from './download-folder-lock.js';

/**
 * Streams files out of downloads/ — after proving, via realpath, that the
 * resolved target actually lives inside downloads/ (security default in
 * rules/coding.md). Symlinks pointing elsewhere are refused.
 *
 * `name` is the path relative to downloads/, so PLAN-24's one level of
 * nesting (`Trip/report.pdf`) needed no change here: the prefix check already
 * generalizes to it.
 */
export class FsDownloadReader implements DownloadReader {
  constructor(
    private readonly downloadsDir: string,
    private readonly folderLock = new DownloadFolderLock(),
  ) {}

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

  /**
   * The folder flavour of the same check, for the zip route: usecases may not
   * touch fs, so this is where a folder id becomes a path safe to read from.
   */
  async confineFolder(name: string): Promise<string> {
    const resolved = await this.confine(name);
    const stat = await fsp.stat(resolved);
    if (!stat.isDirectory()) throw new Error('not a directory');
    return resolved;
  }

  async remove(
    name: string,
    type: 'file' | 'folder',
    snapshot: DownloadDeleteSnapshot,
  ): Promise<void> {
    if (type === 'folder') {
      return this.folderLock.run(name, () => this.removeUnlocked(name, type, snapshot));
    }
    return this.removeUnlocked(name, type, snapshot);
  }

  private async removeUnlocked(
    name: string,
    type: 'file' | 'folder',
    snapshot: DownloadDeleteSnapshot,
  ): Promise<void> {
    const resolved = await this.confine(name);
    const root = await fsp.realpath(this.downloadsDir);
    if (resolved === root) throw new DownloadUnsafeEntryError('cannot remove downloads root');
    if (snapshot.type !== type) throw new DownloadTypeChangedError('download type changed');

    const target = path.join(this.downloadsDir, name);
    const initial = await fsp.lstat(target);
    this.assertEntryType(initial, type);
    this.assertEntrySnapshot(initial, type, snapshot);
    if (type === 'folder') await this.assertFolderContents(target, snapshot);

    const currentRealpath = await fsp.realpath(target);
    if (currentRealpath !== resolved) {
      throw new DownloadUnsafeEntryError('download path changed during deletion');
    }
    if (type === 'folder') await this.assertFolderContents(target, snapshot);

    const current = await fsp.lstat(target);
    this.assertSameEntry(initial, current);
    this.assertEntryType(current, type);
    this.assertEntrySnapshot(current, type, snapshot);

    if (type === 'folder') await fsp.rm(target, { recursive: true });
    else await fsp.unlink(target);
  }

  private async confine(name: string): Promise<string> {
    const root = await fsp.realpath(this.downloadsDir);
    const resolved = await fsp.realpath(path.join(this.downloadsDir, name));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new DownloadUnsafeEntryError('path escapes downloads/');
    }
    return resolved;
  }

  private assertEntryType(stat: Stats, type: 'file' | 'folder'): void {
    if (stat.isSymbolicLink()) throw new DownloadUnsafeEntryError('cannot remove a symbolic link');
    if ((type === 'file' && !stat.isFile()) || (type === 'folder' && !stat.isDirectory())) {
      throw new DownloadTypeChangedError('download type changed after listing');
    }
  }

  private assertEntrySnapshot(
    stat: Stats,
    type: 'file' | 'folder',
    snapshot: DownloadDeleteSnapshot,
  ): void {
    const size = type === 'file' ? stat.size : 0;
    if (
      snapshot.type !== type ||
      snapshot.size !== size ||
      (type === 'file' && snapshot.mtime !== Math.round(stat.mtimeMs))
    ) {
      throw new DownloadChangedError('download changed after listing');
    }
  }

  private assertSameEntry(before: Stats, after: Stats): void {
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new DownloadChangedError('download changed during deletion');
    }
  }

  private async assertFolderContents(
    folderPath: string,
    snapshot: DownloadDeleteSnapshot,
  ): Promise<void> {
    const children = await fsp.readdir(folderPath, { withFileTypes: true });
    if (
      children.some((child) => !child.isFile() || child.name.startsWith('.')) ||
      children.length !== snapshot.children.length
    ) {
      throw new DownloadChangedError(
        'folder contains hidden, nested, or changed entries; refresh the listing',
      );
    }

    const actual: DownloadDeleteSnapshot['children'] = [];
    for (const child of children) {
      let stat: Stats;
      try {
        stat = await fsp.lstat(path.join(folderPath, child.name));
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          throw new DownloadChangedError(
            'folder contents changed after listing; refresh the listing',
          );
        }
        throw error;
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new DownloadUnsafeEntryError('folder contains a symbolic link or non-file entry');
      }
      actual.push({
        name: child.name,
        size: stat.size,
        mtime: Math.round(stat.mtimeMs),
      });
    }

    const expectedSorted = [...snapshot.children].sort((a, b) => a.name.localeCompare(b.name));
    const actualSorted = actual.sort((a, b) => a.name.localeCompare(b.name));
    if (
      expectedSorted.length !== actualSorted.length ||
      expectedSorted.some(
        (expected, index) =>
          expected.name !== actualSorted[index]?.name ||
          expected.size !== actualSorted[index]?.size ||
          expected.mtime !== actualSorted[index]?.mtime,
      )
    ) {
      throw new DownloadChangedError(
        'folder contents changed after listing; refresh the listing',
      );
    }
  }
}
