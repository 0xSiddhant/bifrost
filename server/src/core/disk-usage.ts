import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger/index.js';

/**
 * Recursive on-demand disk accounting for the storage folders.
 *
 * This lives in `core/` because two modules need it and modules may never
 * import each other: Heimdall renders it as the Storage section, and `metrics`
 * samples it as `diskMb`. One walker, one set of numbers — two implementations
 * would eventually disagree and nobody would know which was right.
 *
 * **It is synchronous on purpose and expensive on purpose.** `readdirSync` over
 * a large uploads tree blocks the event loop for as long as it takes, which is
 * exactly why the metrics module samples it on a slow cycle rather than every
 * snapshot: a per-snapshot walk would manufacture the lag spike the snapshot
 * exists to detect, and the sampler would then faithfully record its own noise.
 */

export interface WatchedFolder {
  /** Display label (e.g. 'uploads'). */
  folder: string;
  /** Absolute path. */
  dir: string;
}

export interface FolderUsage {
  folder: string;
  bytes: number;
  files: number;
}

/** One file as a listing shows it. */
export interface FileEntry {
  name: string;
  bytes: number;
  /** Epoch milliseconds. */
  mtime: number;
}

/**
 * Dot-entries are the operating system's, not the user's: `.DS_Store` is not
 * an upload, `.gitkeep` only exists so the folder survives git, and the
 * in-flight copies this module's siblings write are hidden on purpose. They
 * must be skipped by *every* reader — the totals and the listing disagreeing
 * about what is in a folder is worse than either number being wrong.
 */
export function isUserFile(name: string): boolean {
  return !name.startsWith('.');
}

/**
 * Flat listing of one directory — name, size, mtime. Reading the directory is
 * the point: a listing derived from a table drifts the moment a file is
 * deleted outside the app, and then shows rows for files that are gone.
 */
export function listFiles(dir: string, log: Logger): FileEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // An unreadable folder renders as empty, which reads exactly like "nothing
    // has been sent yet" — the one line that tells the two apart.
    log.warn({ err: error, dir }, 'file listing: directory unreadable');
    return [];
  }
  const files: FileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isUserFile(entry.name)) continue;
    try {
      const stat = fs.statSync(path.join(dir, entry.name));
      files.push({ name: entry.name, bytes: stat.size, mtime: Math.round(stat.mtimeMs) });
    } catch (error) {
      // Deleted between the listing and the stat — expected while a move is in
      // flight, so it is not a warning, but the row silently vanishes.
      log.debug({ err: error, dir, file: entry.name }, 'file listing: file vanished mid-scan');
    }
  }
  return files;
}

export function diskUsage(folders: readonly WatchedFolder[], log: Logger): FolderUsage[] {
  return folders.map(({ folder, dir }) => {
    let bytes = 0;
    let files = 0;
    const walk = (current: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (error) {
        // A whole subtree drops out of the total. The number still renders, just
        // wrong and low — the worst kind of wrong for a disk figure, since
        // nothing about it suggests it is incomplete.
        log.warn({ err: error, folder, dir: current }, 'disk usage: directory unreadable, subtree skipped');
        return;
      }
      for (const entry of entries) {
        // Same filter as the listing: `.DS_Store` counted 6 KB toward "uploads"
        // in the owner's Heimdall while never appearing as an upload anywhere.
        if (!isUserFile(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            bytes += fs.statSync(full).size;
            files += 1;
          } catch (error) {
            // Usually benign: a tmp file vanished between the listing and the
            // stat. Debug rather than warn because it is expected during an
            // upload — at the trace-level default it still lands.
            log.debug({ err: error, file: full }, 'disk usage: file vanished mid-walk');
          }
        }
      }
    };
    walk(dir);
    return { folder, bytes, files };
  });
}

/** Total bytes across every watched folder. */
export function totalBytes(usage: readonly FolderUsage[]): number {
  return usage.reduce((sum, entry) => sum + entry.bytes, 0);
}
