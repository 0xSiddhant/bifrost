import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCompressible, MIN_BYTES, precompressDir } from './precompress';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bifrost-precompress-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string | Buffer): string {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/** Text that compresses well, the way a real chunk does. */
const SCRIPT = 'export function render(node){return node.children.map(render)}\n'.repeat(200);

describe('precompress (PLAN-40)', () => {
  it('writes a .br and a .gz beside each eligible file, both decoding to the original', async () => {
    const files = [
      write('assets/index-abc.js', SCRIPT),
      write('assets/index-abc.css', SCRIPT.replace(/export/g, '.rule')),
      write('index.html', `<!doctype html>${SCRIPT}`),
      write('runestone/index.html', `<!doctype html>${SCRIPT}`),
      write(
        'manifest.webmanifest',
        JSON.stringify({ icons: Array(80).fill({ src: '/icon.png' }) }),
      ),
    ];

    await precompressDir(dir);

    for (const file of files) {
      const original = readFileSync(file);
      expect(brotliDecompressSync(readFileSync(`${file}.br`)).equals(original), file).toBe(true);
      expect(gunzipSync(readFileSync(`${file}.gz`)).equals(original), file).toBe(true);
    }
  });

  it('leaves small, incompressible, source-map and binary files alone', async () => {
    const small = write('robots.txt', 'User-agent: *\nAllow: /\n');
    // Random bytes do not compress: a copy would be no smaller than the file.
    const random = write('assets/data.json', randomBytes(8 * MIN_BYTES));
    const map = write('assets/index-abc.js.map', SCRIPT);
    const font = write('assets/inter-abc.woff2', SCRIPT);
    const image = write('pwa-512x512.png', SCRIPT);

    const result = await precompressDir(dir);

    for (const file of [small, random, map, font, image]) {
      expect(existsSync(`${file}.br`), file).toBe(false);
      expect(existsSync(`${file}.gz`), file).toBe(false);
    }
    // Only the two text files were even considered.
    expect(result.map((entry) => path.relative(dir, entry.file)).sort()).toEqual([
      'assets/data.json',
      'robots.txt',
    ]);
  });

  it('knows text from everything else by extension', () => {
    for (const name of [
      'a.js',
      'a.mjs',
      'a.css',
      'a.html',
      'a.svg',
      'a.json',
      'a.webmanifest',
      'a.txt',
      'a.xml',
      'a.wasm',
    ]) {
      expect(isCompressible(name), name).toBe(true);
    }
    for (const name of ['a.js.map', 'a.png', 'a.woff2', 'a.js.br', 'a.js.gz', 'a.ico']) {
      expect(isCompressible(name), name).toBe(false);
    }
  });
});
