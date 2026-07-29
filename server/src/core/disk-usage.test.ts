import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { diskUsage, totalBytes } from './disk-usage.js';

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
    fs.writeFileSync(path.join(root, 'downloads', 'c.bin'), Buffer.alloc(500));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const folders = () => [
    { folder: 'uploads', dir: path.join(root, 'uploads') },
    { folder: 'downloads', dir: path.join(root, 'downloads') },
  ];

  it('sums bytes and files recursively, ignoring .gitkeep', () => {
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
});
