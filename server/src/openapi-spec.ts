import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './core/config/index.js';
import { SERVER_ROOT } from './core/paths.js';

/**
 * Builds the OpenAPI description from the app itself (PLAN-32): the `local`
 * profile — every module — on a scratch storage root, configured by the four
 * required keys alone. Defaults only, never the developer's `.env`, so two
 * machines generate the same file. `npm run api:spec` writes it to
 * `server/openapi.json`; `openapi.test.ts` fails when that file is stale.
 */

export const OPENAPI_FILE = path.join(SERVER_ROOT, 'openapi.json');

export async function generateOpenApiSpec(): Promise<Record<string, unknown>> {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-openapi-'));
  try {
    const app = await createApp(
      loadConfig({
        DEPLOY_PROFILE: 'local',
        PORT: '4646',
        HEIMDALL_PIN: '0000',
        STORAGE_ROOT: storageRoot,
      }),
      { logger: pino({ level: 'silent' }) },
    );
    try {
      await app.fastify.ready();
      return app.fastify.swagger() as unknown as Record<string, unknown>;
    } finally {
      await app.shutdown('openapi spec generated');
    }
  } finally {
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

/** The committed file's exact text: two-space JSON with a trailing newline. */
export function formatOpenApiSpec(spec: Record<string, unknown>): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
