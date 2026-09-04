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
 *
 * Since PLAN-24 the listing is **one level deep**: root files, top-level
 * folders, and those folders' files, all in one flat array the client filters
 * by `parent`. chokidar's own `depth: 1` is what enforces the limit — nothing
 * in here counts path segments — so a file two levels down is simply never
 * seen, which is the intended behaviour rather than a case to reject.
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
      // depth 1 is the whole "one level of folders" rule (PLAN-24 supersedes
      // the depth-0 decision of 2026-07-12).
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
      ignoreInitial: false,
      alwaysStat: true,
      depth: 1,
      ignored: (target) => this.isHidden(target),
    });

    this.watcher.on('add', (file, stats) => this.upsert(file, stats, 'download.added'));
    this.watcher.on('change', (file, stats) => this.upsert(file, stats, 'download.changed'));
    this.watcher.on('unlink', (file) => this.remove(this.relative(file)));
    this.watcher.on('addDir', (dir, stats) => this.upsertFolder(dir, stats));
    // chokidar fires a per-file `unlink` for a removed directory's contents as
    // well, so the children clean themselves up through the handler above —
    // no cascade logic here, in whatever order the events land.
    this.watcher.on('unlinkDir', (dir) => this.remove(this.relative(dir)));
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

  resolveEntry(id: string): DownloadEntry | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * Dot-prefixed names are hidden on every level — a `.trash` folder as much
   * as a `.DS_Store` file, and `placeFile`'s `.bifrost-inflight-*` staging
   * copies. The watched root itself is never hidden, whatever it is called.
   */
  private isHidden(target: string): boolean {
    const relative = this.relative(target);
    return relative !== '' && relative.split(path.sep).some((part) => part.startsWith('.'));
  }

  /** Path relative to downloads/, always with '/' separators for ids. */
  private relative(target: string): string {
    return path.relative(this.downloadsDir, target);
  }

  private upsert(
    file: string,
    stats: Stats | undefined,
    event: 'download.added' | 'download.changed',
  ): void {
    const relative = this.relative(file);
    const dirname = path.dirname(relative);
    const name = path.basename(relative);
    const entry: DownloadEntry = {
      // Keyed on the relative path, so `report.pdf` and `Trip/report.pdf` are
      // two entries — and previews re-derives the very same id from a scan.
      id: idFor(relative.split(path.sep).join('/')),
      name,
      size: stats?.size ?? 0,
      mtime: Math.round(stats?.mtimeMs ?? 0),
      ext: path.extname(name).toLowerCase(),
      type: 'file',
      parent: dirname === '.' ? null : dirname,
    };
    this.entries.set(entry.id, entry);
    if (this.ready) this.bus.emit(event, entry);
  }

  private upsertFolder(dir: string, stats: Stats | undefined): void {
    const relative = this.relative(dir);
    // chokidar announces the watched root itself; that is not a folder row.
    // It also announces the *directories inside* a first-level folder — it
    // simply never descends into them — so a second-level directory arrives
    // here and is dropped: a folder's parent is always the root, and its
    // contents were never indexed to show.
    if (relative === '' || relative.includes(path.sep)) return;
    const entry: DownloadEntry = {
      id: idFor(relative),
      name: relative,
      // Folders carry no size of their own: the client sums the children it
      // already has from this same feed, so the figure can never drift.
      size: 0,
      mtime: Math.round(stats?.mtimeMs ?? 0),
      ext: '',
      type: 'folder',
      parent: null,
    };
    this.entries.set(entry.id, entry);
    if (this.ready) this.bus.emit('download.added', entry);
  }

  private remove(relative: string): void {
    const entry = this.entries.get(idFor(relative.split(path.sep).join('/')));
    if (!entry) return;
    this.entries.delete(entry.id);
    if (this.ready) this.bus.emit('download.removed', entry);
  }
}
