import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applySettingsOverlay, loadConfig, type AppConfig } from './index.js';

/**
 * The server half of PLAN-35's shared settings rules: the standalone site
 * validates its device-local settings with `client/src/core/settings/rules.ts`,
 * and both sides run this one table, so the browser accepts exactly what the
 * Heimdall overlay accepts. A rule changed on one side only fails here or there.
 */
const CASES_FILE = fileURLToPath(
  new URL('../../../../client/src/core/settings/rules.cases.json', import.meta.url),
);

interface RuleCase {
  key: string;
  value: unknown;
  accepted: boolean;
}

const { cases } = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8')) as { cases: RuleCase[] };

const base = loadConfig({
  HEIMDALL_PIN: '4321',
  DEPLOY_PROFILE: 'local',
  STORAGE_ROOT: './storage',
  PORT: '4646',
});

function read(config: AppConfig, key: string): unknown {
  const [area, field] = key.split('.') as [string, string];
  return (config as unknown as Record<string, Record<string, unknown>>)[area]?.[field];
}

describe('shared settings rules (PLAN-35): the server overlay', () => {
  it('has a case table to run', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  for (const { key, value, accepted } of cases) {
    it(`${accepted ? 'accepts' : 'refuses'} ${key} = ${JSON.stringify(value)}`, () => {
      // Start from another accepted value, so "unchanged" can't pass for "accepted".
      const sentinel = cases.find(
        (other) => other.key === key && other.accepted && other.value !== value,
      );
      expect(sentinel, `the table needs a second accepted value for ${key}`).toBeDefined();
      const rows = [
        { key, value: String(sentinel?.value) },
        { key, value: String(value) },
      ];
      expect(read(applySettingsOverlay(base, rows), key)).toBe(accepted ? value : sentinel?.value);
    });
  }
});
