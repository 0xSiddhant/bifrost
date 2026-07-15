import fs from 'node:fs';
import path from 'node:path';
import type { EventBus } from '../../../core/bus/index.js';
import type { Logger } from '../../../core/logger/index.js';
import type { UploadAuditRepository } from '../ports.js';

/**
 * Minimal upload audit recorder (full audit UI is PLAN-06): persists
 * `file.uploaded` events and, on boot, seeds rows for files already sitting in
 * uploads/ (so metadata for PLAN-02-era uploads still shows). Metadata only.
 */
export class UploadAuditRecorder {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly repo: UploadAuditRepository,
    private readonly uploadsDir: string,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  start(): void {
    this.reconcile();
    this.unsubscribe = this.bus.on('file.uploaded', (event) => {
      this.repo.record({
        storedName: event.storedName,
        originalName: event.originalName,
        size: event.size,
        uploadedAt: event.uploadedAt,
        uploaderHint: event.uploaderHint ?? null,
      });
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Seed (insert-or-ignore) audit rows from the current uploads/ contents. */
  private reconcile(): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.uploadsDir, { withFileTypes: true });
    } catch {
      return;
    }
    let seeded = 0;
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === '.gitkeep') continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(path.join(this.uploadsDir, entry.name));
      } catch {
        continue;
      }
      // Stored names are `<timestamp>-<sanitized>`; recover both halves.
      const dash = entry.name.indexOf('-');
      const timestamp = dash > 0 ? Number(entry.name.slice(0, dash)) : NaN;
      const originalName = dash > 0 ? entry.name.slice(dash + 1) : entry.name;
      this.repo.seed({
        storedName: entry.name,
        originalName,
        size: stat.size,
        uploadedAt: Number.isFinite(timestamp) ? timestamp : Math.round(stat.mtimeMs),
        uploaderHint: null,
      });
      seeded += 1;
    }
    if (seeded > 0) this.log.info({ seeded }, 'upload audit reconciled from disk');
  }
}
