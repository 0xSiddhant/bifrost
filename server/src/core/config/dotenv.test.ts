import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ignoredKeysWarning, LAUNCHER_KEYS, loadDotenv } from './dotenv.js';

/** How a run is shaped comes from the launcher, never from .env (owner, 2026-10-09). */
describe('loadDotenv', () => {
  const touched = [
    'BIFROST_RUN',
    'MDNS_ADVERTISER',
    'OTEL_ENABLED',
    'DOTENV_TEST_KEY',
    'DOTENV_TEST_SET',
  ];
  const saved = Object.fromEntries(touched.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const key of touched) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function envFile(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-dotenv-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, content);
    return file;
  }

  it('loads every other key, skips the launcher keys, and names the ones it skipped', () => {
    for (const key of touched) delete process.env[key];
    const ignored = loadDotenv(
      envFile('BIFROST_RUN=api\nOTEL_ENABLED=true\nDOTENV_TEST_KEY=kept\n'),
    );
    expect(ignored).toEqual(['BIFROST_RUN', 'OTEL_ENABLED']);
    expect(process.env.DOTENV_TEST_KEY).toBe('kept');
    expect(process.env.BIFROST_RUN).toBeUndefined();
    expect(process.env.OTEL_ENABLED).toBeUndefined();
  });

  it('keeps what the launcher set, for launcher keys and the rest alike', () => {
    process.env.BIFROST_RUN = 'full';
    process.env.DOTENV_TEST_SET = 'from the launcher';
    loadDotenv(envFile('BIFROST_RUN=web\nDOTENV_TEST_SET=from .env\n'));
    expect(process.env.BIFROST_RUN).toBe('full');
    expect(process.env.DOTENV_TEST_SET).toBe('from the launcher');
  });

  it('treats a missing .env as nothing to load', () => {
    expect(loadDotenv(path.join(os.tmpdir(), 'no-such-dir-bifrost', '.env'))).toEqual([]);
  });

  it('warns only when something was skipped', () => {
    expect(ignoredKeysWarning([])).toBeUndefined();
    expect(ignoredKeysWarning(['MDNS_ADVERTISER'])).toMatch(/^MDNS_ADVERTISER in \.env is ignored/);
    expect(LAUNCHER_KEYS).toEqual(['BIFROST_RUN', 'MDNS_ADVERTISER', 'OTEL_ENABLED']);
  });
});
