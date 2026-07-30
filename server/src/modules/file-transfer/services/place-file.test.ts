import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_DEDUPE_ATTEMPTS, placeFile, sweepPublishedDuplicates } from './place-file.js';

describe('placeFile', () => {
  let root: string;
  let dir: string;
  let source: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-place-'));
    dir = path.join(root, 'target');
    fs.mkdirSync(dir);
    source = path.join(root, 'source.bin');
    fs.writeFileSync(source, 'the payload');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('uses the desired name when nothing is in the way', async () => {
    const placed = await placeFile(dir, source, 'report.pdf');

    expect(placed).toEqual({ finalName: 'report.pdf', renamed: false });
    expect(fs.readFileSync(path.join(dir, 'report.pdf'), 'utf8')).toBe('the payload');
    // The source is the caller's to remove — a move unlinks it, an upload
    // discards its tmp file.
    expect(fs.existsSync(source)).toBe(true);
  });

  it('suffixes on collision, keeping the extension', async () => {
    fs.writeFileSync(path.join(dir, 'report.pdf'), 'first');
    expect(await placeFile(dir, source, 'report.pdf')).toEqual({
      finalName: 'report-1.pdf',
      renamed: true,
    });

    fs.writeFileSync(path.join(dir, 'report-1.pdf'), 'second');
    expect(await placeFile(dir, source, 'report.pdf')).toEqual({
      finalName: 'report-2.pdf',
      renamed: true,
    });
  });

  it('handles an extension-less name', async () => {
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'first');
    expect(await placeFile(dir, source, 'LICENSE')).toEqual({
      finalName: 'LICENSE-1',
      renamed: true,
    });
  });

  it('never overwrites what is already there', async () => {
    fs.writeFileSync(path.join(dir, 'report.pdf'), 'do not clobber me');
    await placeFile(dir, source, 'report.pdf');
    expect(fs.readFileSync(path.join(dir, 'report.pdf'), 'utf8')).toBe('do not clobber me');
  });

  // Criterion 23: the old loop was unbounded, and its comment excused that with
  // the timestamp prefix this plan removed.
  it('caps its probing and falls back to a random suffix', async () => {
    for (let index = 1; index <= MAX_DEDUPE_ATTEMPTS; index += 1) {
      fs.writeFileSync(path.join(dir, `report-${index}.pdf`), 'taken');
    }
    fs.writeFileSync(path.join(dir, 'report.pdf'), 'taken');
    const link = vi.spyOn(fsp, 'link');

    const placed = await placeFile(dir, source, 'report.pdf');

    expect(placed.renamed).toBe(true);
    expect(placed.finalName).toMatch(/^report-[0-9a-f]{4}\.pdf$/);
    // Bounded work: the desired name, MAX_DEDUPE_ATTEMPTS numbered probes, and
    // then one random. Without the cap this folder would grow the scan forever.
    expect(link.mock.calls.length).toBeLessThanOrEqual(MAX_DEDUPE_ATTEMPTS + 2);
  });

  // Criterion 24: the old open(wx)+rename could strand an empty file under the
  // final name. `link()` makes the reservation and the content one syscall.
  it('never leaves a zero-byte file behind when the placement fails', async () => {
    vi.spyOn(fsp, 'link').mockRejectedValue(Object.assign(new Error('nope'), { code: 'EIO' }));

    await expect(placeFile(dir, source, 'report.pdf')).rejects.toThrow('nope');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  // Criterion 13: uploads/ and downloads/ are independently configurable, so
  // they can land on different volumes, where link() fails with EXDEV.
  it('falls back to a fsynced copy when the folders are on different filesystems', async () => {
    const realLink = fsp.link.bind(fsp);
    vi.spyOn(fsp, 'link').mockImplementation(async (from, to) => {
      // Only the cross-device hop fails; the staging copy's same-directory
      // link (which is how the fallback finishes) must still work.
      if (String(from) === source) {
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      }
      return realLink(from, to);
    });

    const placed = await placeFile(dir, source, 'report.pdf');

    expect(placed).toEqual({ finalName: 'report.pdf', renamed: false });
    expect(fs.readFileSync(path.join(dir, 'report.pdf'), 'utf8')).toBe('the payload');
    // No staging copy left behind, hidden or otherwise.
    expect(fs.readdirSync(dir)).toEqual(['report.pdf']);
  });

  it('cleans up the staging copy when the cross-device placement fails', async () => {
    vi.spyOn(fsp, 'link').mockRejectedValue(
      Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' }),
    );

    await expect(placeFile(dir, source, 'report.pdf')).rejects.toThrow();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('sweepPublishedDuplicates', () => {
  let root: string;
  let uploads: string;
  let downloads: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-sweep-'));
    uploads = path.join(root, 'uploads');
    downloads = path.join(root, 'downloads');
    fs.mkdirSync(uploads);
    fs.mkdirSync(downloads);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes an upload that a crash left hard-linked into downloads/', async () => {
    fs.writeFileSync(path.join(uploads, 'report.pdf'), 'payload');
    fs.linkSync(path.join(uploads, 'report.pdf'), path.join(downloads, 'report.pdf'));

    expect(await sweepPublishedDuplicates(uploads, downloads)).toEqual(['report.pdf']);
    expect(fs.existsSync(path.join(uploads, 'report.pdf'))).toBe(false);
    expect(fs.readFileSync(path.join(downloads, 'report.pdf'), 'utf8')).toBe('payload');
  });

  it('leaves a different file that merely shares a name', async () => {
    fs.writeFileSync(path.join(uploads, 'report.pdf'), 'the upload');
    fs.writeFileSync(path.join(downloads, 'report.pdf'), 'a different file entirely');

    expect(await sweepPublishedDuplicates(uploads, downloads)).toEqual([]);
    expect(fs.readFileSync(path.join(uploads, 'report.pdf'), 'utf8')).toBe('the upload');
  });

  it('does nothing when downloads/ is empty or missing', async () => {
    fs.writeFileSync(path.join(uploads, 'report.pdf'), 'payload');
    expect(await sweepPublishedDuplicates(uploads, downloads)).toEqual([]);
    expect(await sweepPublishedDuplicates(uploads, path.join(root, 'nope'))).toEqual([]);
    expect(fs.existsSync(path.join(uploads, 'report.pdf'))).toBe(true);
  });
});
