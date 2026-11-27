import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FsDownloadReader } from './fs-download-reader.js';

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
    await expect(reader.remove('escape', 'folder')).rejects.toThrow('escapes downloads/');
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

    await reader.remove('Trip photos/a.jpg', 'file');

    expect(fs.existsSync(path.join(folder, 'a.jpg'))).toBe(false);
    expect(fs.readFileSync(path.join(folder, 'b.jpg'), 'utf8')).toBe('second');
  });

  it('removes a folder and its contents after confinement', async () => {
    const folder = path.join(downloads, 'Trip photos');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'a.jpg'), 'first');

    await reader.remove('Trip photos', 'folder');

    expect(fs.existsSync(folder)).toBe(false);
  });

  it('refuses to delete a symlink or an entry whose type changed', async () => {
    fs.writeFileSync(path.join(downloads, 'notes.txt'), 'notes');
    fs.mkdirSync(path.join(downloads, 'folder'));
    fs.symlinkSync(path.join(downloads, 'notes.txt'), path.join(downloads, 'link.txt'));

    await expect(reader.remove('link.txt', 'file')).rejects.toThrow('symbolic link');
    await expect(reader.remove('notes.txt', 'folder')).rejects.toThrow('type changed');
    await expect(reader.remove('folder', 'file')).rejects.toThrow('type changed');
    expect(fs.readFileSync(path.join(downloads, 'notes.txt'), 'utf8')).toBe('notes');
    expect(fs.existsSync(path.join(downloads, 'folder'))).toBe(true);
  });
});
