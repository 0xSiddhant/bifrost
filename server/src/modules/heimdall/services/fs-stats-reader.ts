import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../../../core/logger/index.js';
import type { FolderUsage, StatsReader } from '../ports.js';

export interface WatchedFolder {
  /** Display label (e.g. 'uploads'). */
  folder: string;
  /** Absolute path. */
  dir: string;
}

/** Recursive on-demand disk accounting for the storage folders. */
export class FsStatsReader implements StatsReader {
  constructor(
    private readonly folders: WatchedFolder[],
    private readonly log: Logger,
  ) {}

  diskUsage(): FolderUsage[] {
    return this.folders.map(({ folder, dir }) => {
      let bytes = 0;
      let files = 0;
      const walk = (current: string): void => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
          // A whole subtree drops out of the total. The number still renders,
          // just wrong and low — which is the worst kind of wrong for a disk
          // figure, since nothing about the UI suggests it is incomplete.
          this.log.warn({ err: error, folder, dir: current }, 'disk usage: directory unreadable, subtree skipped');
          return;
        }
        for (const entry of entries) {
          if (entry.name === '.gitkeep') continue;
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            try {
              bytes += fs.statSync(full).size;
              files += 1;
            } catch (error) {
              // Usually benign: a tmp file vanished between the listing and the
              // stat. Logged at debug rather than warn because it is expected
              // during an upload, and at trace-level default it still lands.
              this.log.debug({ err: error, file: full }, 'disk usage: file vanished mid-walk');
            }
          }
        }
      };
      walk(dir);
      return { folder, bytes, files };
    });
  }
}
