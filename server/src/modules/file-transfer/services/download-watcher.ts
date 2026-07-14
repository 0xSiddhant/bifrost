import type { Stats } from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { DownloadEntry } from '../../../core/bus/events.js';
import type { EventBus } from '../../../core/bus/index.js';
import { downloadIdFor as idFor } from '../../../core/download-id.js';
import type { Logger } from '../../../core/logger/index.js';
import type { DownloadRegistry } from '../ports.js';

/**
 * Watches downloads/ with chokidar and owns the listing registry. The initial
 * scan IS the boot reconciliation (silent — no bus noise for files that were
 * already there); after `ready`, every add/change/unlink becomes a bus event,
 * which module.ts relays to the SSE hub.
 */
export class DownloadWatcherService implements DownloadRegistry {
  private readonly entries = new Map<string, DownloadEntry>();
  private watcher: FSWatcher | null = null;
  private ready = false;

  constructor(
    private readonly downloadsDir: string,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  start(): Promise<void> {
    this.watcher = watch(this.downloadsDir, {
      // awaitWriteFinish debounces half-copied files (Finder drags, scp);
      // depth 0 keeps the listing flat — subfolders are out of scope.
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
      ignoreInitial: false,
      alwaysStat: true,
      depth: 0,
      ignored: (target, stats) =>
        Boolean(stats?.isFile()) && path.basename(target).startsWith('.'),
    });

    this.watcher.on('add', (file, stats) => this.upsert(file, stats, 'download.added'));
    this.watcher.on('change', (file, stats) => this.upsert(file, stats, 'download.changed'));
    this.watcher.on('unlink', (file) => this.remove(file));
    this.watcher.on('error', (error) => this.log.error({ err: error }, 'downloads watcher error'));

    return new Promise((resolve) => {
      this.watcher?.once('ready', () => {
        this.ready = true;
        this.log.info({ files: this.entries.size }, 'downloads reconciled from initial scan');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  list(): DownloadEntry[] {
    return [...this.entries.values()];
  }

  resolveName(id: string): string | null {
    return this.entries.get(id)?.name ?? null;
  }

  private upsert(
    file: string,
    stats: Stats | undefined,
    event: 'download.added' | 'download.changed',
  ): void {
    const name = path.basename(file);
    const entry: DownloadEntry = {
      id: idFor(name),
      name,
      size: stats?.size ?? 0,
      mtime: Math.round(stats?.mtimeMs ?? 0),
      ext: path.extname(name).toLowerCase(),
    };
    this.entries.set(entry.id, entry);
    if (this.ready) this.bus.emit(event, entry);
  }

  private remove(file: string): void {
    const name = path.basename(file);
    const entry = this.entries.get(idFor(name));
    if (!entry) return;
    this.entries.delete(entry.id);
    if (this.ready) this.bus.emit('download.removed', entry);
  }
}
