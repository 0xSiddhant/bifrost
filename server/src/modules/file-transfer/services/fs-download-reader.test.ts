import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DownloadDeleteSnapshot } from '../ports.js';
import { FsDownloadReader } from './fs-download-reader.js';

function fileSnapshot(downloads: string, name: string): DownloadDeleteSnapshot {
  const stat = fs.statSync(path.join(downloads, name));
  const parent = path.dirname(name);
  const entryName = path.basename(name);
  return {
    name: entryName,
    parent: parent === '.' ? null : parent,
    ext: path.extname(entryName).toLowerCase(),
    type: 'file',
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    children: [],
  };
}

function folderSnapshot(
  downloads: string,
  name: string,
  children: string[],
): DownloadDeleteSnapshot {
  const stat = fs.statSync(path.join(downloads, name));
  return {
    name,
    parent: null,
    ext: '',
    type: 'folder',
    size: 0,
    mtime: Math.round(stat.mtimeMs),
    children: children.map((child) => {
      const childStat = fs.statSync(path.join(downloads, name, child));
      return { name: child, size: childStat.size, mtime: Math.round(childStat.mtimeMs) };
    }),
  };
}

/**
 * The confinement corpus, extended to PLAN-24's one level of nesting: reading a
 * folder is the same realpath-prefix proof as reading a file, and it must fail
 * for exactly the same reasons.
 */
describe('FsDownloadReader.confineFolder', () => {
  let root: string;
  let downloads: string;
  let reader: FsDownloadReader;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-reader-'));
    downloads = path.join(root, 'downloads');
    fs.mkdirSync(downloads);
    fs.mkdirSync(path.join(root, 'secrets'));
    fs.writeFileSync(path.join(root, 'secrets', 'app.db'), 'SQLite');
    reader = new FsDownloadReader(downloads);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves a real folder inside downloads/', async () => {
    fs.mkdirSync(path.join(downloads, 'Trip photos'));

    const resolved = await reader.confineFolder('Trip photos');

    expect(resolved).toBe(fs.realpathSync(path.join(downloads, 'Trip photos')));
  });

  it('refuses a name that is a file rather than a directory', async () => {
    fs.writeFileSync(path.join(downloads, 'notes.txt'), 'hi');

    await expect(reader.confineFolder('notes.txt')).rejects.toThrow('not a directory');
  });

  it('refuses a symlink that resolves outside downloads/', async () => {
    fs.symlinkSync(path.join(root, 'secrets'), path.join(downloads, 'escape'));

    await expect(reader.confineFolder('escape')).rejects.toThrow('escapes downloads/');
    await expect(
      reader.remove('escape', 'folder', {
        name: 'escape',
        parent: null,
        ext: '',
        type: 'folder',
        size: 0,
        mtime: 0,
        children: [],
      }),
    ).rejects.toThrow('escapes downloads/');
    expect(fs.readFileSync(path.join(root, 'secrets', 'app.db'), 'utf8')).toBe('SQLite');
  });

  it('refuses traversal spelled into the name', async () => {
    for (const name of ['../secrets', '..', 'Trip/../../secrets']) {
      await expect(reader.confineFolder(name), name).rejects.toThrow();
    }
  });

  it('serves a file one level down, which the same prefix check already covers', async () => {
    fs.mkdirSync(path.join(downloads, 'Trip photos'));
    fs.writeFileSync(path.join(downloads, 'Trip photos', 'a.jpg'), 'bytes');

    expect(await reader.stat('Trip photos/a.jpg')).toEqual({ size: 5 });
    const { stream, size } = await reader.open('Trip photos/a.jpg');
    expect(size).toBe(5);
    // Read it out: createReadStream opens lazily, and an unread handle would
    // race the temp folder's teardown.
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('bytes');
  });

  it('removes a nested file without affecting its sibling', async () => {
    const folder = path.join(downloads, 'Trip photos');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'a.jpg'), 'first');
    fs.writeFileSync(path.join(folder, 'b.jpg'), 'second');

    await reader.remove(
      'Trip photos/a.jpg',
      'file',
      fileSnapshot(downloads, 'Trip photos/a.jpg'),
    );

    expect(fs.existsSync(path.join(folder, 'a.jpg'))).toBe(false);
    expect(fs.readFileSync(path.join(folder, 'b.jpg'), 'utf8')).toBe('second');
  });

  it('removes a folder and its contents after confinement', async () => {
    const folder = path.join(downloads, 'Trip photos');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'a.jpg'), 'first');

    await reader.remove('Trip photos', 'folder', folderSnapshot(downloads, 'Trip photos', ['a.jpg']));

    expect(fs.existsSync(folder)).toBe(false);
  });

  it('refuses folder deletion when hidden, nested, or newly added entries were not listed', async () => {
    const folder = path.join(downloads, 'Trip photos');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'a.jpg'), 'first');
    const snapshot = folderSnapshot(downloads, 'Trip photos', ['a.jpg']);

    fs.writeFileSync(path.join(folder, '.bifrost-inflight-copy'), 'pending');
    await expect(reader.remove('Trip photos', 'folder', snapshot)).rejects.toThrow('hidden, nested');
    fs.unlinkSync(path.join(folder, '.bifrost-inflight-copy'));

    fs.mkdirSync(path.join(folder, 'Raw'));
    await expect(reader.remove('Trip photos', 'folder', snapshot)).rejects.toThrow('hidden, nested');
    fs.rmdirSync(path.join(folder, 'Raw'));

    fs.writeFileSync(path.join(folder, 'new.jpg'), 'new');
    await expect(reader.remove('Trip photos', 'folder', snapshot)).rejects.toThrow('changed');
    expect(fs.existsSync(path.join(folder, 'a.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'new.jpg'))).toBe(true);
  });

  it('refuses to delete a symlink or an entry whose type changed', async () => {
    fs.writeFileSync(path.join(downloads, 'notes.txt'), 'notes');
    fs.mkdirSync(path.join(downloads, 'folder'));
    fs.symlinkSync(path.join(downloads, 'notes.txt'), path.join(downloads, 'link.txt'));

    await expect(
      reader.remove('link.txt', 'file', fileSnapshot(downloads, 'link.txt')),
    ).rejects.toThrow('symbolic link');
    await expect(
      reader.remove('notes.txt', 'folder', {
        name: 'notes.txt',
        parent: null,
        ext: '.txt',
        type: 'folder',
        size: 0,
        mtime: 0,
        children: [],
      }),
    ).rejects.toThrow('type changed');
    await expect(
      reader.remove('folder', 'file', {
        name: 'folder',
        parent: null,
        ext: '',
        type: 'file',
        size: 0,
        mtime: 0,
        children: [],
      }),
    ).rejects.toThrow('type changed');
    expect(fs.readFileSync(path.join(downloads, 'notes.txt'), 'utf8')).toBe('notes');
    expect(fs.existsSync(path.join(downloads, 'folder'))).toBe(true);
  });
});
