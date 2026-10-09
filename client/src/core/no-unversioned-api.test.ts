import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PLAN-37 criterion 5: the client and the CLI call only versioned paths. The
 * hub still answers the old unversioned ones (as v1, with a `Deprecation`
 * header), so a call that slipped back to one would work and nothing else
 * would notice. This reads every production source file as text, the way
 * PLAN-32's `routes.spec.ts` reads `App.tsx`, and fails on any string literal
 * naming `/api/` without a version after it (`/api/x`, `/edda/api/x`).
 *
 * Build hub paths from `API_V1` (`core/api.ts`; the CLI's in `core/client.ts`).
 * Comments are prose and are not read. Tests are not read either: they name
 * old paths on purpose, to prove the CLI's fallback.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Each file allowed to name an unversioned path, and why. */
const ALLOWED: Record<string, string> = {
  'cli/src/core/client.ts':
    'the fallback for a hub from before PLAN-37 must name the prefix it falls back to',
};

const SOURCE = /\.(ts|tsx)$/;
const NOT_PRODUCTION = /\.test\.tsx?$|\/test\//;

function sources(dir: string): string[] {
  return readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(relative);
    return SOURCE.test(entry.name) && !NOT_PRODUCTION.test(relative) ? [relative] : [];
  });
}

const COMMENT = /^\s*(\/\/|\/\*|\*)/;
/** A quoted or template literal holding `/api/` with no `v<n>` after it. */
const UNVERSIONED = /(['"`])(?:(?!\1)[^\\\n]|\\.)*?\/api\/(?!v\d)/;

/** `file:line: text` for every unversioned literal in `text`. */
export function unversionedLiterals(file: string, text: string): string[] {
  return text
    .split('\n')
    .flatMap((line, index) =>
      !COMMENT.test(line) && UNVERSIONED.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
    );
}

describe('no unversioned API path in the client or the CLI (PLAN-37)', () => {
  const files = [...sources('client/src'), ...sources('cli/src')];

  it('reads both trees', () => {
    expect(files).toContain('client/src/core/api.ts');
    expect(files).toContain('cli/src/core/client.ts');
    expect(files.some((file) => NOT_PRODUCTION.test(file))).toBe(false);
  });

  it('finds none outside the allowlist', () => {
    const hits = files
      .filter((file) => !(file in ALLOWED))
      .flatMap((file) => unversionedLiterals(file, readFileSync(path.join(REPO, file), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('keeps each allowlisted file needed: it still names an unversioned path', () => {
    for (const file of Object.keys(ALLOWED)) {
      const text = readFileSync(path.join(REPO, file), 'utf8');
      expect(unversionedLiterals(file, text).length, file).toBeGreaterThan(0);
    }
  });

  it('would catch each shape of an unversioned call, and pass the versioned ones', () => {
    const flagged = (line: string) => unversionedLiterals('x.ts', line).length > 0;
    expect(flagged("apiGet('/api/clipboard')")).toBe(true);
    expect(flagged('apiGet("/api/clipboard")')).toBe(true);
    expect(flagged('apiGet(`/api/edda/${slug}`)')).toBe(true);
    expect(flagged('href={`/runestone/api/${slug}`}')).toBe(true);
    expect(flagged('fetch(`${base}/api/health`)')).toBe(true);
    expect(flagged('apiGet(`${API_V1}/clipboard`)')).toBe(false);
    expect(flagged("fetch('/api/v1/health')")).toBe(false);
    expect(flagged('`/edda${API_V1}/${slug}`')).toBe(false);
    expect(flagged("export const API_V1 = '/api/v1';")).toBe(false);
    expect(flagged(' * calls `/api/clipboard` directly')).toBe(false);
  });
});
