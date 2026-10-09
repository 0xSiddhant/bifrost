import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fromRepoRoot } from './paths.js';

/**
 * The standalone site, served the way its container serves it (PLAN-35), for
 * the Playwright `standalone` project: `client/dist-standalone/` with the
 * location rules of `docker/nginx-standalone.conf`. `static-server.test.ts`
 * parses that file and checks these rules match it, so the journeys exercise
 * the fallback the owner actually deploys.
 */

export const STANDALONE_DIR = fromRepoRoot('client', 'dist-standalone');
export const NGINX_CONF = fromRepoRoot('docker', 'nginx-standalone.conf');

export interface LocationRule {
  /** `exact` is nginx's `location = …`; `prefix` a plain `location …`. */
  match: 'exact' | 'prefix';
  path: string;
  /** What a path with no file becomes: the shell, a 404, or (exact rules) the file itself. */
  fallback: '/index.html' | '=404' | null;
  cacheControl: string;
  /** nginx `default_type`, for an extension the type table does not name. */
  defaultType?: string;
}

export const LOCATION_RULES: readonly LocationRule[] = [
  {
    match: 'prefix',
    path: '/assets/',
    fallback: '=404',
    cacheControl: 'public, max-age=31536000, immutable',
    defaultType: 'text/javascript',
  },
  { match: 'exact', path: '/index.html', fallback: null, cacheControl: 'no-cache' },
  {
    match: 'exact',
    path: '/manifest.webmanifest',
    fallback: null,
    cacheControl: 'no-cache',
    defaultType: 'application/manifest+json',
  },
  { match: 'prefix', path: '/', fallback: '/index.html', cacheControl: 'no-cache' },
];

/** On every response, as nginx's `add_header … always`. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** nginx's choice: an exact match wins, otherwise the longest prefix. */
export function ruleFor(pathname: string): LocationRule {
  const exact = LOCATION_RULES.find((rule) => rule.match === 'exact' && rule.path === pathname);
  if (exact) return exact;
  const prefixes = LOCATION_RULES.filter(
    (rule) => rule.match === 'prefix' && pathname.startsWith(rule.path),
  ).sort((a, b) => b.path.length - a.path.length);
  const [longest] = prefixes;
  if (!longest) throw new Error(`no location matches ${pathname}`);
  return longest;
}

/** A file under `root` for this path, or null; never a path outside it. */
function fileFor(root: string, pathname: string): string | null {
  const resolved = path.resolve(root, `.${path.posix.normalize(pathname)}`);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

export interface Resolution {
  status: 200 | 404;
  file: string | null;
  rule: LocationRule;
}

/** What the container answers for a path: the file, the shell, or a 404. */
export function resolve(root: string, pathname: string): Resolution {
  const rule = ruleFor(pathname);
  const file = fileFor(root, pathname);
  if (file) return { status: 200, file, rule };
  if (rule.fallback === '/index.html') {
    // nginx's try_files makes an internal redirect, so the shell's own rule applies.
    return { status: 200, file: fileFor(root, '/index.html'), rule: ruleFor('/index.html') };
  }
  return { status: 404, file: null, rule };
}

export interface StaticSite {
  baseUrl: string;
  /** Every path requested, in order: the journeys' no-request guard reads it. */
  requests: string[];
  stop(): Promise<void>;
}

export async function startStaticSite(root = STANDALONE_DIR): Promise<StaticSite> {
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error(`no standalone build in ${root} — run \`./bifrost build --standalone\` first`);
  }
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push(url.pathname);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // nginx's static handler answers 405 to anything but GET and HEAD.
      response.writeHead(405).end();
      return;
    }
    const { status, file, rule } = resolve(root, decodeURIComponent(url.pathname));
    response.setHeader('Cache-Control', rule.cacheControl);
    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>404 Not Found</h1>');
      return;
    }
    const type = TYPES[path.extname(file)] ?? rule.defaultType ?? 'application/octet-stream';
    response.writeHead(status, { 'Content-Type': type });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    stop: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
