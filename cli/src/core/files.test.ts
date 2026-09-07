import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chunk,
  displayPath,
  expandUploadInputs,
  findEntry,
  localNameFor,
  type DownloadEntry,
} from './files.js';
import { EXIT } from './output.js';
import { failure } from '../test/failure.js';

/**
 * The pure decisions inside `files.ts`. The HTTP either side of them is covered
 * against a real server in `files.int.test.ts`; what is here is the branching
 * that has to be right before a request is made at all.
 */

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-files-'));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function write(relative: string, contents = 'x'): string {
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

describe('expandUploadInputs', () => {
  it('takes named files as they are', () => {
    const a = write('a.txt', 'aa');
    const b = write('b.txt', 'bbb');

    const expanded = expandUploadInputs([a, b]);

    expect(expanded.files).toEqual([
      { path: a, name: 'a.txt', size: 2 },
      { path: b, name: 'b.txt', size: 3 },
    ]);
    expect(expanded.hidden).toBe(0);
    expect(expanded.nested).toBe(0);
  });

  it('expands a directory to the files directly inside it', () => {
    write('docs/one.txt');
    write('docs/two.txt');

    const expanded = expandUploadInputs([path.join(workspace, 'docs')]);

    expect(expanded.files.map((file) => file.name)).toEqual(['one.txt', 'two.txt']);
  });

  it('skips hidden files, so `push .` never puts a .env on the share', () => {
    write('mix/notes.txt');
    write('mix/.env', 'SECRET=1');
    write('mix/.DS_Store');

    const expanded = expandUploadInputs([path.join(workspace, 'mix')]);

    expect(expanded.files.map((file) => file.name)).toEqual(['notes.txt']);
    expect(expanded.hidden).toBe(2);
  });

  it('skips sub-directories rather than flattening a tree that has nowhere to land', () => {
    write('tree/top.txt');
    write('tree/nested/deep.txt');

    const expanded = expandUploadInputs([path.join(workspace, 'tree')]);

    expect(expanded.files.map((file) => file.name)).toEqual(['top.txt']);
    expect(expanded.nested).toBe(1);
  });

  it('mixes files and directories in one invocation, de-duplicating overlaps', () => {
    const loose = write('loose.txt');
    const inside = write('docs/one.txt');

    const expanded = expandUploadInputs([loose, path.join(workspace, 'docs'), inside]);

    expect(expanded.files.map((file) => file.name)).toEqual(['loose.txt', 'one.txt']);
  });

  it('refuses a path that does not exist, with the not-found code', async () => {
    const error = await failure(
      Promise.resolve().then(() => expandUploadInputs([path.join(workspace, 'ghost.txt')])),
    );

    expect(error.message).toContain('no such file or folder');
    expect(error.exitCode).toBe(EXIT.notFound);
  });

  it('refuses an empty directory rather than sending an empty request', async () => {
    fs.mkdirSync(path.join(workspace, 'empty'));
    const error = await failure(
      Promise.resolve().then(() => expandUploadInputs([path.join(workspace, 'empty')])),
    );

    expect(error.message).toContain('holds no files');
  });

  it('refuses a directory of nothing but hidden files, for the same reason', async () => {
    write('dots/.hidden');
    const error = await failure(
      Promise.resolve().then(() => expandUploadInputs([path.join(workspace, 'dots')])),
    );

    expect(error.message).toContain('holds no files');
  });
});

describe('chunk', () => {
  it('splits into batches the server will accept whole', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    expect(chunk([], 5)).toEqual([]);
  });

  it('treats a nonsense limit as "all of it" rather than looping forever', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
    expect(chunk([1, 2, 3], Number.NaN)).toEqual([[1, 2, 3]]);
  });
});

const entry = (
  name: string,
  parent: string | null,
  type: 'file' | 'folder' = 'file',
): DownloadEntry => ({
  id: `${parent ?? ''}/${name}`,
  name,
  size: 10,
  mtime: 1,
  ext: '.txt',
  type,
  parent,
});

describe('findEntry', () => {
  const entries = [
    entry('shared.txt', null),
    entry('Trip', null, 'folder'),
    entry('Work', null, 'folder'),
    entry('shared.txt', 'Trip'),
    entry('notes.txt', 'Trip'),
    entry('notes.txt', 'Work'),
  ];

  it('finds a root file, a folder, and a file inside a folder', () => {
    expect(findEntry(entries, 'shared.txt').parent).toBeNull();
    expect(findEntry(entries, 'Trip').type).toBe('folder');
    expect(displayPath(findEntry(entries, 'Trip/notes.txt'))).toBe('Trip/notes.txt');
  });

  it('lets the exact path win, so a root file keeps its own bare name', () => {
    // `shared.txt` exists at the root AND inside Trip. The root one is not
    // ambiguous — it is exactly what the bare name spells.
    expect(findEntry(entries, 'shared.txt').parent).toBeNull();
    expect(findEntry(entries, 'Trip/shared.txt').parent).toBe('Trip');
  });

  it('reports the ambiguity when two folders hold the name and the root does not', async () => {
    const error = await failure(Promise.resolve().then(() => findEntry(entries, 'notes.txt')));

    expect(error.message).toContain('matches more than one entry');
    expect(error.message).toContain('Trip/notes.txt');
    expect(error.message).toContain('Work/notes.txt');
    expect(error.exitCode).toBe(EXIT.notFound);
  });

  it('tolerates the shapes a shell produces — ./name and a trailing slash', () => {
    expect(findEntry(entries, './shared.txt').parent).toBeNull();
    expect(findEntry(entries, 'Trip/').type).toBe('folder');
  });

  it('points at the listing when nothing matches', async () => {
    const error = await failure(Promise.resolve().then(() => findEntry(entries, 'nowhere.txt')));

    expect(error.message).toContain('bifrost pull --list');
    expect(error.exitCode).toBe(EXIT.notFound);
  });
});

describe('localNameFor', () => {
  it('names a folder as the zip it actually arrives as', () => {
    expect(localNameFor(entry('notes.txt', null))).toBe('notes.txt');
    expect(localNameFor(entry('Trip', null, 'folder'))).toBe('Trip.zip');
  });
});
