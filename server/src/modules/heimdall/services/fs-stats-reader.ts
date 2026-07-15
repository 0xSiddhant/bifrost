import fs from 'node:fs';
import path from 'node:path';
import type { FolderUsage, StatsReader } from '../ports.js';

export interface WatchedFolder {
  /** Display label (e.g. 'uploads'). */
  folder: string;
  /** Absolute path. */
  dir: string;
}

/** Recursive on-demand disk accounting for the storage folders. */
export class FsStatsReader implements StatsReader {
  constructor(private readonly folders: WatchedFolder[]) {}

  diskUsage(): FolderUsage[] {
    return this.folders.map(({ folder, dir }) => {
      let bytes = 0;
      let files = 0;
      const walk = (current: string): void => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
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
            } catch {
              // vanished mid-walk — skip
            }
          }
        }
      };
      walk(dir);
      return { folder, bytes, files };
    });
  }
}
