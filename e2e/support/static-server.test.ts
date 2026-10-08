import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOCATION_RULES,
  NGINX_CONF,
  resolve,
  ruleFor,
  SECURITY_HEADERS,
  type LocationRule,
} from './static-server.js';

/**
 * The e2e static server and the container's nginx must answer alike (PLAN-35
 * criterion 18), or the standalone journeys prove a fallback nobody deploys.
 * This reads the committed nginx.conf as text and compares rule by rule.
 */

interface NginxLocation {
  match: 'exact' | 'prefix';
  path: string;
  body: string;
}

const conf = fs.readFileSync(NGINX_CONF, 'utf8').replace(/#.*$/gm, '');

function locations(source: string): NginxLocation[] {
  return [...source.matchAll(/location\s+(=\s+)?(\S+)\s*\{([^}]*)\}/g)].map((match) => ({
    match: match[1] ? 'exact' : 'prefix',
    path: match[2] ?? '',
    body: match[3] ?? '',
  }));
}

function directive(body: string, name: string): string | undefined {
  return new RegExp(`^\\s*${name}\\s+([^;]+);`, 'm').exec(body)?.[1]?.trim();
}

function headers(body: string): Record<string, string> {
  return Object.fromEntries(
    [...body.matchAll(/add_header\s+(\S+)\s+"([^"]*)"\s+always;/g)].map((m) => [m[1], m[2]]),
  );
}

function asRule(location: NginxLocation): LocationRule {
  const tryFiles = directive(location.body, 'try_files');
  const fallback = tryFiles?.split(/\s+/).at(-1);
  const defaultType = directive(location.body, 'default_type');
  return {
    match: location.match,
    path: location.path,
    fallback: fallback === '/index.html' || fallback === '=404' ? fallback : null,
    cacheControl: headers(location.body)['Cache-Control'] ?? '',
    ...(defaultType ? { defaultType } : {}),
  };
}

describe('the static server matches docker/nginx-standalone.conf', () => {
  const parsed = locations(conf);

  it('has the same location rules, in the same order', () => {
    expect(parsed.map(asRule)).toEqual(LOCATION_RULES);
  });

  it('sends the same security headers from every location (add_header does not inherit)', () => {
    for (const location of parsed) {
      const security = Object.fromEntries(
        Object.entries(headers(location.body)).filter(([name]) => name !== 'Cache-Control'),
      );
      expect(security, location.path).toEqual(SECURITY_HEADERS);
    }
  });

  it('can reach no backend, and does not name its version', () => {
    expect(conf).not.toMatch(/proxy_pass|fastcgi_pass|uwsgi_pass|grpc_pass/);
    expect(directive(conf, 'server_tokens')).toBe('off');
    expect(directive(conf, 'listen')).toBe('8080');
  });
});

describe('resolve', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-static-'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(root, 'favicon.svg'), '<svg/>');
    fs.writeFileSync(path.join(root, 'assets', 'index-abc123.js'), '');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves a hashed asset with the immutable cache', () => {
    const hit = resolve(root, '/assets/index-abc123.js');
    expect(hit.status).toBe(200);
    expect(hit.rule.cacheControl).toContain('immutable');
  });

  it('answers a missing asset with 404, never the shell', () => {
    expect(resolve(root, '/assets/gone-000000.js')).toMatchObject({ status: 404, file: null });
  });

  it('hands deep links and server paths to the uncached shell', () => {
    for (const pathname of ['/', '/runestone/abc', '/api/health', '/go/x', '/edda/api/raw/1']) {
      const hit = resolve(root, pathname);
      expect(hit.status, pathname).toBe(200);
      expect(hit.file, pathname).toBe(path.join(root, 'index.html'));
      expect(hit.rule.cacheControl, pathname).toBe('no-cache');
    }
  });

  it('serves a named file at the root as itself', () => {
    expect(resolve(root, '/favicon.svg').file).toBe(path.join(root, 'favicon.svg'));
  });

  it('never leaves the root', () => {
    expect(resolve(root, '/../../etc/passwd').file).toBe(path.join(root, 'index.html'));
  });

  it('picks rules as nginx does: exact first, then the longest prefix', () => {
    expect(ruleFor('/index.html').match).toBe('exact');
    expect(ruleFor('/assets/x.js').path).toBe('/assets/');
    expect(ruleFor('/anything').path).toBe('/');
  });
});
