/**
 * Brotli and gzip copies of every text file a client build writes (PLAN-40):
 * `assets/index-abc.js` gains `assets/index-abc.js.br` (quality 11) and
 * `assets/index-abc.js.gz` (level 9) beside it.
 *
 * The web host serves them with `@fastify/static`'s `preCompressed`, and the
 * standalone nginx with `gzip_static`, so nothing compresses per request:
 * maximum-quality Brotli is too slow to run on every response on the owner's
 * Mac, and costs nothing here. Node's own `zlib` does both, the PLAN-25
 * precedent, so there is no new dependency.
 *
 * Runs in `closeBundle`, over the written output directory rather than the
 * bundle, so it also covers what Vite copies from `public/` (copied in
 * `renderStart`, long before this) and the standalone build's SEO pages.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type { Plugin } from 'vite';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/**
 * Text, by extension. Fonts and images are compressed formats already, and
 * source maps are skipped: only devtools fetch them, and they outweigh the
 * rest of the build together.
 */
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|txt|xml|wasm)$/;

/** Below this, a compressed copy saves less than a request's own headers. */
export const MIN_BYTES = 1024;

/** A copy that saves less than this is not worth the extra file. */
export const MIN_SAVING = 0.1;

export interface Compressed {
  file: string;
  bytes: number;
  br: number | null;
  gz: number | null;
}

export function isCompressible(file: string): boolean {
  return COMPRESSIBLE.test(file);
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(full) : Promise.resolve([full]);
    }),
  );
  return nested.flat();
}

/** Write `.br` and `.gz` beside one file, each only if it saves enough. */
export async function precompressFile(file: string): Promise<Compressed> {
  const source = await readFile(file);
  const result: Compressed = { file, bytes: source.length, br: null, gz: null };
  if (source.length < MIN_BYTES) return result;
  const worthIt = (size: number) => size <= source.length * (1 - MIN_SAVING);
  const [br, gz] = await Promise.all([
    brotli(source, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    }),
    gzip(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
  ]);
  if (worthIt(br.length)) {
    await writeFile(`${file}.br`, br);
    result.br = br.length;
  }
  if (worthIt(gz.length)) {
    await writeFile(`${file}.gz`, gz);
    result.gz = gz.length;
  }
  return result;
}

/** Every eligible file under `dir`, compressed in parallel (zlib runs on the thread pool). */
export async function precompressDir(dir: string): Promise<Compressed[]> {
  const files = (await filesUnder(dir)).filter(isCompressible);
  return Promise.all(files.map(precompressFile));
}

export function precompressPlugin(): Plugin {
  let outDir = '';
  return {
    name: 'bifrost-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler(error) {
        // A failed build has nothing worth compressing. Rolldown hands over
        // only some failures here; the build exits non-zero either way.
        if (error) return;
        const written = await precompressDir(outDir);
        const br = written.filter((entry) => entry.br !== null);
        const raw = br.reduce((sum, entry) => sum + entry.bytes, 0);
        const packed = br.reduce((sum, entry) => sum + (entry.br ?? 0), 0);
        this.info(
          `precompressed ${br.length} of ${written.length} text files: ` +
            `${Math.round(raw / 1024)} KB → ${Math.round(packed / 1024)} KB with Brotli`,
        );
      },
    },
  };
}
