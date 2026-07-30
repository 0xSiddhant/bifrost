import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { diskUsage } from '../../../core/disk-usage.js';
import { FsStatsReader } from './fs-stats-reader.js';

const silent = pino({ level: 'silent' });

/**
 * Guards the PLAN-16b lift: the recursive walk moved into `core/disk-usage` so
 * the metrics module could sample it without importing another module. What
 * Heimdall's Storage section reports must not have moved with it.
 */
describe('FsStatsReader after the lift into core', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-stats-'));
    fs.mkdirSync(path.join(root, 'uploads', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'uploads', 'a.bin'), Buffer.alloc(1000));
    fs.writeFileSync(path.join(root, 'uploads', 'nested', 'b.bin'), Buffer.alloc(2000));
    fs.writeFileSync(path.join(root, 'uploads', '.gitkeep'), '');
    fs.writeFileSync(path.join(root, 'logs', 'app.1.log'), Buffer.alloc(4096));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports exactly what the core walker reports', () => {
    const folders = [
      { folder: 'uploads', dir: path.join(root, 'uploads') },
      { folder: 'logs', dir: path.join(root, 'logs') },
    ];
    expect(new FsStatsReader(folders, silent).diskUsage()).toEqual([
      { folder: 'uploads', bytes: 3000, files: 2 },
      { folder: 'logs', bytes: 4096, files: 1 },
    ]);
    expect(new FsStatsReader(folders, silent).diskUsage()).toEqual(diskUsage(folders, silent));
  });
});
