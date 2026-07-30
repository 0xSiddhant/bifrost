import { diskUsage, type WatchedFolder } from '../../../core/disk-usage.js';
import type { Logger } from '../../../core/logger/index.js';
import type { FolderUsage, StatsReader } from '../ports.js';

export type { WatchedFolder };

/**
 * Heimdall's view of the storage folders. The walk itself lives in
 * `core/disk-usage` because the `metrics` module needs the same numbers and
 * modules may never import each other (PLAN-16b); this stays as the adapter
 * that satisfies Heimdall's own `StatsReader` port.
 */
export class FsStatsReader implements StatsReader {
  constructor(
    private readonly folders: WatchedFolder[],
    private readonly log: Logger,
  ) {}

  diskUsage(): FolderUsage[] {
    return diskUsage(this.folders, this.log);
  }
}
