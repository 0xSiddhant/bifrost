import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { createApp, type RunningApp } from '../app.js';
import { loadConfig, type AppConfig } from '../core/config/index.js';
import type { Logger } from '../core/logger/index.js';

/**
 * The one way a server test builds an app (PLAN-32b).
 *
 * It supplies what every suite used to spell out by hand: the four required
 * keys, a fresh temp `STORAGE_ROOT` and `API_CONTRACT_CHECK=strict`, so a
 * route whose schema would rewrite its bytes fails the test that exercises it.
 * A suite passes only the keys it cares about; a `STORAGE_ROOT` override wins,
 * for the suites that seed files before boot or restart over the same data.
 *
 * Nothing here reads `process.env`: a developer's own `.env` never leaks in.
 * The caller removes the storage root (`app.config.storage.root`) when done.
 */

export type TestEnv = Record<string, string | undefined>;

export const TEST_PIN = '4321';

export function testConfig(overrides: TestEnv = {}): AppConfig {
  return loadConfig({
    DEPLOY_PROFILE: 'local',
    PORT: '4646',
    HEIMDALL_PIN: TEST_PIN,
    API_CONTRACT_CHECK: 'strict',
    ...overrides,
    STORAGE_ROOT: overrides.STORAGE_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-test-')),
  });
}

export interface TestAppOptions {
  /** Defaults to a silent logger; suites that assert on log lines pass their own. */
  logger?: Logger;
}

export async function createTestApp(
  overrides: TestEnv = {},
  options: TestAppOptions = {},
): Promise<RunningApp> {
  return createApp(testConfig(overrides), { logger: options.logger ?? pino({ level: 'silent' }) });
}
