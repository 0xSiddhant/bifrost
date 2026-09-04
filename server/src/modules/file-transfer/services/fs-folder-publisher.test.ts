import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FolderConflictError } from '../ports.js';
import { FsFolderPublisher } from './fs-folder-publisher.js';

describe('FsFolderPublisher', () => {
  let root: string;
  let downloads: string;
  let tmpDir: string;
  let publisher: FsFolderPublisher;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-folderpub-'));
    downloads = path.join(root, 'downloads');
    tmpDir = path.join(root, 'tmp');
    fs.mkdirSync(downloads);
    fs.mkdirSync(tmpDir);
    publisher = new FsFolderPublisher(downloads);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A fresh tmp file with private 0600, exactly as writeTmp leaves one. */
  function tmpFile(content: string): string {
    const file = path.join(tmpDir, `tmp-${Math.random().toString(16).slice(2)}`);
    fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
  }

  it('creates a missing folder and lands the file inside it at 0644', async () => {
    const placed = await publisher.publish(tmpFile('holiday'), 'Trip photos', 'a.jpg');

    expect(placed).toEqual({ finalName: 'a.jpg', folder: 'Trip photos' });
    const file = path.join(downloads, 'Trip photos', 'a.jpg');
    expect(fs.readFileSync(file, 'utf8')).toBe('holiday');
    expect(fs.statSync(file).mode & 0o777).toBe(0o644);
    // The tmp copy is always discarded — success or failure.
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('appends to a folder that already exists, never creating a second one', async () => {
    await publisher.publish(tmpFile('one'), 'Trip photos', 'a.jpg');
    await publisher.publish(tmpFile('two'), 'Trip photos', 'b.jpg');

    expect(fs.readdirSync(downloads)).toEqual(['Trip photos']);
    expect(fs.readdirSync(path.join(downloads, 'Trip photos')).sort()).toEqual(['a.jpg', 'b.jpg']);
    // Criterion 3: the file that was already there is untouched.
    expect(fs.readFileSync(path.join(downloads, 'Trip photos', 'a.jpg'), 'utf8')).toBe('one');
  });

  it('suffixes a name that collides inside the folder, via placeFile', async () => {
    await publisher.publish(tmpFile('first'), 'Trip photos', 'a.jpg');
    const second = await publisher.publish(tmpFile('second'), 'Trip photos', 'a.jpg');

    expect(second.finalName).toBe('a-1.jpg');
    expect(fs.readFileSync(path.join(downloads, 'Trip photos', 'a.jpg'), 'utf8')).toBe('first');
  });

  it('rejects a destination that is already a plain file, not a folder', async () => {
    fs.writeFileSync(path.join(downloads, 'Photos'), 'a root file, not a folder');
    const tmp = tmpFile('payload');

    await expect(publisher.publish(tmp, 'Photos', 'a.jpg')).rejects.toBeInstanceOf(
      FolderConflictError,
    );
    // Still a file, still its own content, and no tmp junk left behind.
    expect(fs.statSync(path.join(downloads, 'Photos')).isFile()).toBe(true);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  /**
   * Criterion 6: two devices racing the same brand-new name. One wins the
   * mkdir and the other gets EEXIST — and the loser's stat finds the directory
   * either way, so both succeed into the one folder.
   */
  it('lets concurrent uploads into the same new folder both succeed', async () => {
    const results = await Promise.all([
      publisher.publish(tmpFile('a'), 'Shared', 'a.txt'),
      publisher.publish(tmpFile('b'), 'Shared', 'b.txt'),
      publisher.publish(tmpFile('c'), 'Shared', 'c.txt'),
    ]);

    expect(results.map((r) => r.folder)).toEqual(['Shared', 'Shared', 'Shared']);
    expect(fs.readdirSync(downloads)).toEqual(['Shared']);
    expect(fs.readdirSync(path.join(downloads, 'Shared')).sort()).toEqual([
      'a.txt',
      'b.txt',
      'c.txt',
    ]);
  });

  /**
   * The kill-test invariant, reproduced at the seam a signal cannot reliably
   * land on: `placeFile` is a single link() syscall, so a crash before it
   * leaves the folder empty — never a partial or zero-byte file.
   */
  it('leaves at worst an empty folder when the placement never happens', async () => {
    await fsp.mkdir(path.join(downloads, 'Interrupted'));

    expect(fs.readdirSync(path.join(downloads, 'Interrupted'))).toEqual([]);
    // …and the next upload simply reuses it rather than tripping over it.
    const placed = await publisher.publish(tmpFile('later'), 'Interrupted', 'a.txt');
    expect(placed.finalName).toBe('a.txt');
  });
});
