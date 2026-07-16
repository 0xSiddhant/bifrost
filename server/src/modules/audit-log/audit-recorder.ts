import type { EventBus } from '../../core/bus/index.js';
import type { ClipboardEntry } from '../../core/bus/events.js';
import type { AuditRepository } from './ports.js';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

function clipSummary(entry: ClipboardEntry): string {
  if (entry.kind === 'code') return `code snippet${entry.lang ? ` (${entry.lang})` : ''}`;
  const text = entry.text.replace(/\s+/g, ' ').trim();
  return `"${text.length > 48 ? `${text.slice(0, 48)}…` : text}"`;
}

/**
 * The pure bus subscriber (architecture rule 2 showcase). Turns cross-module
 * events into audit rows. Nothing imports this module; deleting it stops
 * recording but breaks no other feature.
 */
export class AuditRecorder {
  private unsubscribes: Array<() => void> = [];

  constructor(
    private readonly repo: AuditRepository,
    private readonly bus: EventBus,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    const push = (event: string, deviceId: string | null, ip: string | null, summary: string) =>
      this.repo.append({ ts: this.now(), event, deviceId, ip, summary });

    this.unsubscribes.push(
      this.bus.on('file.uploaded', (event) =>
        push('file.uploaded', null, event.uploaderHint ?? null, `uploaded ${event.originalName} (${fmtBytes(event.size)})`),
      ),
      this.bus.on('download.added', (entry) =>
        push('download.added', null, null, `download available: ${entry.name}`),
      ),
      this.bus.on('download.removed', (entry) =>
        push('download.removed', null, null, `download removed: ${entry.name}`),
      ),
      this.bus.on('clipboard.updated', (change) => {
        if (change.action === 'add') {
          push('clipboard.updated', change.entry.deviceId, null, clipSummary(change.entry));
        }
      }),
      this.bus.on('heimdall.login', (event) =>
        push('heimdall.login', null, event.ip, `admin login ${event.outcome}`),
      ),
      this.bus.on('settings.updated', (event) =>
        push('settings.updated', null, null, `settings updated (shortcut ${event.shortcut}, ${event.tapCount} taps)`),
      ),
    );
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }
}
