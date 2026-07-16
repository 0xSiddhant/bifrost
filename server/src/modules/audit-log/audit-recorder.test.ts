import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/bus/index.js';
import { AuditRecorder } from './audit-recorder.js';
import { PruneAuditUseCase } from './usecases/list-audit.js';
import type { AuditRecord, AuditRepository, NewAuditRecord } from './ports.js';

class FakeAudit implements AuditRepository {
  rows: NewAuditRecord[] = [];
  prunedBefore: number | null = null;

  append(record: NewAuditRecord): void {
    this.rows.push(record);
  }
  page(): { total: number; items: AuditRecord[] } {
    return { total: 0, items: [] };
  }
  distinctEvents(): string[] {
    return [];
  }
  pruneBefore(ts: number): number {
    this.prunedBefore = ts;
    return 2;
  }
}

describe('AuditRecorder', () => {
  it('records each cross-module event with an actor and summary', () => {
    const repo = new FakeAudit();
    const bus = new EventBus();
    new AuditRecorder(repo, bus, () => 5000).start();

    bus.emit('file.uploaded', {
      originalName: 'a.jpg',
      storedName: '1-a.jpg',
      size: 2048,
      uploadedAt: 1,
      uploaderHint: '10.0.0.5',
    });
    bus.emit('download.added', { id: 'x', name: 'b.zip', size: 1, mtime: 1, ext: '.zip' });
    bus.emit('clipboard.updated', {
      action: 'add',
      entry: { id: 'c1', text: 'hi', kind: 'text', lang: null, deviceId: 'dev-9', createdAt: 1 },
    });
    bus.emit('clipboard.updated', { action: 'delete', id: 'c1' }); // must be ignored
    bus.emit('heimdall.login', { outcome: 'failure', ip: '10.0.0.9' });

    const events = repo.rows.map((r) => r.event);
    expect(events).toEqual(['file.uploaded', 'download.added', 'clipboard.updated', 'heimdall.login']);
    expect(repo.rows[0]).toMatchObject({ ts: 5000, ip: '10.0.0.5' });
    expect(repo.rows[0]?.summary).toContain('a.jpg');
    expect(repo.rows[2]).toMatchObject({ deviceId: 'dev-9' });
    expect(repo.rows[3]).toMatchObject({ ip: '10.0.0.9', summary: 'admin login failure' });
  });

  it('stops recording after stop()', () => {
    const repo = new FakeAudit();
    const bus = new EventBus();
    const recorder = new AuditRecorder(repo, bus, () => 1);
    recorder.start();
    recorder.stop();
    bus.emit('heimdall.login', { outcome: 'success', ip: '1.1.1.1' });
    expect(repo.rows).toHaveLength(0);
  });
});

describe('PruneAuditUseCase', () => {
  it('prunes rows older than the retention window', () => {
    const repo = new FakeAudit();
    const now = 90 * 24 * 60 * 60 * 1000 + 1000; // just past 90 days
    const removed = new PruneAuditUseCase(repo, 90, () => now).execute();
    expect(removed).toBe(2);
    expect(repo.prunedBefore).toBe(1000); // now - 90 days
  });
});
