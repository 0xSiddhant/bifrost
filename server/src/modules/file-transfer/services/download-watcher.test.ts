import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { DownloadEntry } from '../../../core/bus/events.js';
import { EventBus } from '../../../core/bus/index.js';
import { downloadIdFor } from '../../../core/download-id.js';
import type { Logger } from '../../../core/logger/index.js';
import { DownloadWatcherService } from './download-watcher.js';

const log: Logger = pino({ level: 'silent' });

/**
 * The watcher's own contract at PLAN-24's depth of one: what it indexes, what
 * it deliberately does not, and the shape of the entries it hands the client.
 * Everything here comes from the *initial scan*, which is also the boot
 * reconciliation — the live-event half is covered in watcher-sse.int.test.ts.
 */
describe('DownloadWatcherService at depth 1', () => {
  let downloads: string;
  let watcher: DownloadWatcherService;

  beforeEach(() => {
    downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-watch-unit-'));
  });

  afterEach(async () => {
    await watcher?.stop();
    fs.rmSync(downloads, { recursive: true, force: true });
  });

  async function scan(): Promise<DownloadEntry[]> {
    watcher = new DownloadWatcherService(downloads, new EventBus(), log);
    await watcher.start();
    return watcher.list();
  }

  const write = (relative: string, content = 'x') => {
    const file = path.join(downloads, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  it('lists root files, folders and one level of children in one flat array', async () => {
    write('root.txt', 'root');
    write('Trip photos/a.jpg', 'aa');
    write('Trip photos/b.jpg', 'bbb');

    const entries = await scan();
    const byName = new Map(entries.map((entry) => [`${entry.parent ?? ''}/${entry.name}`, entry]));

    expect(byName.get('/root.txt')).toMatchObject({ type: 'file', parent: null, ext: '.txt' });
    expect(byName.get('/Trip photos')).toMatchObject({
      type: 'folder',
      parent: null,
      size: 0,
      ext: '',
    });
    expect(byName.get('Trip photos/a.jpg')).toMatchObject({
      type: 'file',
      parent: 'Trip photos',
      size: 2,
    });
    expect(byName.get('Trip photos/b.jpg')).toMatchObject({ type: 'file', parent: 'Trip photos' });
    expect(entries).toHaveLength(4);
  });

  it('never emits a folder row for the watched root itself', async () => {
    write('root.txt');

    const entries = await scan();
    expect(entries.filter((entry) => entry.type === 'folder')).toEqual([]);
  });

  /** Criterion 9: two levels down is silently absent, not an error. */
  it('does not index a file two levels deep', async () => {
    write('Trip photos/Raw/deep.jpg');

    const entries = await scan();
    expect(entries.map((entry) => entry.name).sort()).toEqual(['Trip photos']);
  });

  it('ignores dot-prefixed files and folders at every level', async () => {
    write('.DS_Store');
    write('.hidden/inside.txt');
    write('Trip photos/.DS_Store');
    write('Trip photos/keep.jpg');

    const entries = await scan();
    expect(entries.map((entry) => entry.name).sort()).toEqual(['Trip photos', 'keep.jpg']);
  });

  /**
   * Ids hash the path *relative to downloads/*, which is what lets the previews
   * module re-derive the same id from its own independent scan.
   */
  it('derives a nested file id from its folder-qualified path', async () => {
    write('Trip photos/a.jpg');

    const entries = await scan();
    const nested = entries.find((entry) => entry.name === 'a.jpg');
    expect(nested?.id).toBe(downloadIdFor('Trip photos/a.jpg'));
    expect(watcher.resolveEntry(downloadIdFor('Trip photos/a.jpg'))).toMatchObject({
      name: 'a.jpg',
      parent: 'Trip photos',
    });
    // The bare basename is a different entry entirely, and does not exist.
    expect(watcher.resolveEntry(downloadIdFor('a.jpg'))).toBeNull();
  });

  it('emits download.removed for a folder and its children when the folder goes', async () => {
    write('Trip photos/a.jpg');
    const bus = new EventBus();
    const removed = vi.fn();
    watcher = new DownloadWatcherService(downloads, bus, log);
    await watcher.start();
    bus.on('download.removed', removed);

    fs.rmSync(path.join(downloads, 'Trip photos'), { recursive: true, force: true });

    await vi.waitFor(
      () => {
        const names = removed.mock.calls.map((call) => (call[0] as DownloadEntry).name).sort();
        expect(names).toEqual(['Trip photos', 'a.jpg']);
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(watcher.list()).toEqual([]);
  }, 15_000);
});
