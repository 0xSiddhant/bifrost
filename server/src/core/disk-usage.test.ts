import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { diskUsage, listFiles, totalBytes } from './disk-usage.js';

const silent = pino({ level: 'silent' });

/**
 * The walk moved out of `heimdall/services` into `core/` in PLAN-16b, so the
 * metrics module could reach it without importing another module. The matching
 * "Heimdall still reports the same numbers" test lives on the Heimdall side —
 * core may not import a module, not even in a test.
 */
describe('core disk usage', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-disk-'));
    fs.mkdirSync(path.join(root, 'uploads', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'downloads'), { recursive: true });
    fs.writeFileSync(path.join(root, 'uploads', 'a.bin'), Buffer.alloc(1000));
    fs.writeFileSync(path.join(root, 'uploads', 'nested', 'b.bin'), Buffer.alloc(2000));
    fs.writeFileSync(path.join(root, 'uploads', '.gitkeep'), '');
    // The OS's, not the user's — and 6 KB of it showed up as "uploads" in the
    // owner's Heimdall before PLAN-17b (criterion 27).
    fs.writeFileSync(path.join(root, 'uploads', '.DS_Store'), Buffer.alloc(6144));
    fs.writeFileSync(path.join(root, 'downloads', 'c.bin'), Buffer.alloc(500));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const folders = () => [
    { folder: 'uploads', dir: path.join(root, 'uploads') },
    { folder: 'downloads', dir: path.join(root, 'downloads') },
  ];

  it('sums bytes and files recursively, ignoring every dot-file', () => {
    expect(diskUsage(folders(), silent)).toEqual([
      { folder: 'uploads', bytes: 3000, files: 2 },
      { folder: 'downloads', bytes: 500, files: 1 },
    ]);
  });

  it('totals every watched folder', () => {
    expect(totalBytes(diskUsage(folders(), silent))).toBe(3500);
  });

  it('reports zero for a folder that does not exist rather than throwing', () => {
    const usage = diskUsage([{ folder: 'ghost', dir: path.join(root, 'nope') }], silent);
    expect(usage).toEqual([{ folder: 'ghost', bytes: 0, files: 0 }]);
  });

  it('warns when a subtree is unreadable, because the total silently reads low', () => {
    const log = pino({ level: 'silent' });
    const warn = vi.spyOn(log, 'warn');
    diskUsage([{ folder: 'ghost', dir: path.join(root, 'nope') }], log);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  describe('listFiles', () => {
    it('lists one flat folder with sizes and mtimes, skipping dot-files', () => {
      const listed = listFiles(path.join(root, 'uploads'), silent);

      // Flat: `nested/` is a directory, and the listing is of files.
      expect(listed.map((entry) => entry.name)).toEqual(['a.bin']);
      expect(listed[0]?.bytes).toBe(1000);
      expect(listed[0]?.mtime).toBeGreaterThan(0);
    });

    it('filters exactly what the totals filter — one helper, both readers', () => {
      const dir = path.join(root, 'uploads');
      const listedBytes = listFiles(dir, silent).reduce((sum, entry) => sum + entry.bytes, 0);
      const nested = listFiles(path.join(dir, 'nested'), silent);
      const walked = diskUsage([{ folder: 'uploads', dir }], silent)[0];

      expect(listedBytes + nested.reduce((sum, entry) => sum + entry.bytes, 0)).toBe(walked?.bytes);
    });

    it('answers with an empty list, and a line, for a folder it cannot read', () => {
      const log = pino({ level: 'silent' });
      const warn = vi.spyOn(log, 'warn');
      expect(listFiles(path.join(root, 'nope'), log)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
