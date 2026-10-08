import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromRepoRoot } from './config.js';
import { LOCATION_RULES, SECURITY_HEADERS, type LocationRule } from './standalone-rules.js';

/**
 * `web` mode must serve the standalone client exactly as the container does
 * (PLAN-36), so this reads the committed nginx.conf as text and compares rule
 * by rule, as e2e/support/static-server.test.ts does for the harness's copy.
 */
const conf = fs
  .readFileSync(fromRepoRoot('docker', 'nginx-standalone.conf'), 'utf8')
  .replace(/#.*$/gm, '');

function directive(body: string, name: string): string | undefined {
  return new RegExp(`^\\s*${name}\\s+([^;]+);`, 'm').exec(body)?.[1]?.trim();
}

function headers(body: string): Record<string, string> {
  return Object.fromEntries(
    [...body.matchAll(/add_header\s+(\S+)\s+"([^"]*)"\s+always;/g)].map((m) => [m[1], m[2]]),
  );
}

const locations = [...conf.matchAll(/location\s+(=\s+)?(\S+)\s*\{([^}]*)\}/g)].map((m) => ({
  match: (m[1] ? 'exact' : 'prefix') as LocationRule['match'],
  path: m[2] ?? '',
  body: m[3] ?? '',
}));

describe('web mode matches docker/nginx-standalone.conf', () => {
  it('has the same location rules, in the same order', () => {
    const parsed = locations.map(({ match, path, body }): LocationRule => {
      const fallback = directive(body, 'try_files')?.split(/\s+/).at(-1);
      const defaultType = directive(body, 'default_type');
      return {
        match,
        path,
        fallback: fallback === '/index.html' || fallback === '=404' ? fallback : null,
        cacheControl: headers(body)['Cache-Control'] ?? '',
        ...(defaultType ? { defaultType } : {}),
      };
    });
    expect(parsed).toEqual(LOCATION_RULES);
  });

  it('sends the same security headers', () => {
    for (const { path, body } of locations) {
      const security = Object.fromEntries(
        Object.entries(headers(body)).filter(([name]) => name !== 'Cache-Control'),
      );
      expect(security, path).toEqual(SECURITY_HEADERS);
    }
  });
});
