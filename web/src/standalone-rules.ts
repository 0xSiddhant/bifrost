import fs from 'node:fs';
import path from 'node:path';

/**
 * How `web` mode serves the standalone build (PLAN-36): the location rules of
 * the container's committed `docker/nginx-standalone.conf`, so the standalone
 * client behaves the same locally, on the LAN and on the VPS.
 * `standalone-rules.test.ts` parses that file and fails if the two disagree,
 * as `e2e/support/static-server.test.ts` does for the e2e harness's copy.
 */

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

/** nginx's choice: an exact match wins, otherwise the longest prefix. */
export function ruleFor(pathname: string): LocationRule {
  const exact = LOCATION_RULES.find((rule) => rule.match === 'exact' && rule.path === pathname);
  if (exact) return exact;
  const [longest] = LOCATION_RULES.filter(
    (rule) => rule.match === 'prefix' && pathname.startsWith(rule.path),
  ).sort((a, b) => b.path.length - a.path.length);
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
    // Deliberately silent: no such file is the fallback case, not a failure.
    return null;
  }
}

export interface Resolution {
  file: string | null;
  rule: LocationRule;
}

/** What the container answers for a path: the file, the shell, or nothing (a 404). */
export function resolveStandalone(root: string, pathname: string): Resolution {
  const rule = ruleFor(pathname);
  const file = fileFor(root, pathname);
  if (file) return { file, rule };
  if (rule.fallback === '/index.html') {
    // nginx's try_files makes an internal redirect, so the shell's own rule applies.
    return { file: fileFor(root, '/index.html'), rule: ruleFor('/index.html') };
  }
  return { file: null, rule };
}
