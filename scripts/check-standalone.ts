/**
 * The standalone build must not be able to reach a server (PLAN-35). Every
 * request path is compiled to a stub behind `__HUB__`, so the real paths
 * should not be in the bundle at all; this reads `client/dist-standalone/`
 * and fails on any `/api/`, `EventSource` or `/go/` that survived.
 *
 * Runs after every `npm run build:standalone` (and so in the Docker build),
 * because a forgotten `fetch` in a shared component is exactly the bug this
 * exists to catch. Exits 1 with each hit and the text around it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STANDALONE_DIR = path.join(ROOT, 'client', 'dist-standalone');

const NEEDLES = ['/api/', 'EventSource', '/go/'];

/**
 * Text the stubs and the Bifröst sheet may carry: what the sheet says about a
 * server path is a message, not a request. Kept to whole sentences so a real
 * path cannot hide inside an allowance.
 */
export const ALLOWED = [
  // terser's DOM property table (Loki's minify transform) names every global.
  'EventException.EventSource.EventTarget',
] as const;

export interface Hit {
  file: string;
  needle: string;
  context: string;
}

export function findHits(text: string, file: string, allowed: readonly string[] = ALLOWED): Hit[] {
  let scrubbed = text;
  for (const phrase of allowed) scrubbed = scrubbed.split(phrase).join('');
  const hits: Hit[] = [];
  for (const needle of NEEDLES) {
    let at = scrubbed.indexOf(needle);
    while (at !== -1) {
      hits.push({ file, needle, context: scrubbed.slice(Math.max(0, at - 60), at + 60) });
      at = scrubbed.indexOf(needle, at + needle.length);
    }
  }
  return hits;
}

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return /\.(js|mjs|html|css|json|webmanifest)$/.test(entry.name) ? [full] : [];
  });
}

export function checkStandalone(dir = STANDALONE_DIR): Hit[] {
  if (!fs.existsSync(dir)) throw new Error(`${dir} does not exist — run npm run build:standalone`);
  return filesUnder(dir).flatMap((file) =>
    findHits(fs.readFileSync(file, 'utf8'), path.relative(dir, file)),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = checkStandalone();
  if (hits.length === 0) {
    console.log('standalone bundle: no /api/, EventSource or /go/ — it cannot reach a server');
  } else {
    console.error(`standalone bundle: ${hits.length} hit(s) that could reach a server:`);
    for (const hit of hits)
      console.error(`  ${hit.file}  ${hit.needle}  …${hit.context.replace(/\s+/g, ' ')}…`);
    process.exit(1);
  }
}
