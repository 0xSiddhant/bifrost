// Copies pdf.js's wasm decoders into client/public/ so the built client can
// serve them (PLAN-29).
//
// pdf.js 6 moved three subsystems out of JavaScript and into WebAssembly, each
// fetched at runtime from a directory named by `getDocument({ wasmUrl })`:
// JBIG2 **and CCITTFax** (jbig2.wasm), JPEG 2000 (openjpeg.wasm) and colour
// management (qcms_bg.wasm). Leave `wasmUrl` unset and pdf.js builds the URL
// `"null" + filename`, fails to fetch it, fails again importing the JS
// fallback, warns, and **drops the image** — a scanned deck then presents as
// blank white slides with no error anywhere. That is the whole reason this
// script exists.
//
// A Vite `?url` import cannot do this job: `wasmUrl` is a directory prefix and
// Vite hashes each filename, so `${prefix}openjpeg.wasm` would name a file that
// was emitted as `openjpeg-a1b2c3.wasm`. Files copied into `public/` keep their
// names, which is exactly what pdf.js needs.
//
// Generated, never committed — `gen-build-info.ts` and `gen-man.ts`'s pattern —
// so a `pdfjs-dist` upgrade cannot leave a stale decoder behind.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const source = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'wasm');
const target = path.join(repoRoot, 'client', 'public', 'pdfjs-wasm');

if (!fs.existsSync(source)) {
  throw new Error(`pdfjs-dist ships no wasm/ directory at ${source}`);
}

// Replaced wholesale rather than merged: a file that stopped shipping upstream
// must stop being served here too.
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

const copied = fs.readdirSync(target);
const bytes = copied.reduce((total, name) => total + fs.statSync(path.join(target, name)).size, 0);
process.stdout.write(
  `pdf-wasm: ${copied.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) → client/public/pdfjs-wasm/\n`,
);
