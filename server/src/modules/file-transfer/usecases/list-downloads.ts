import type { DownloadEntry } from '../../../core/bus/events.js';
import type { DownloadRegistry } from '../ports.js';

export class ListDownloadsUseCase {
  constructor(private readonly registry: DownloadRegistry) {}

  execute(): DownloadEntry[] {
    return [...this.registry.list()].sort((a, b) => b.mtime - a.mtime);
  }
}
