import os from 'node:os';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { REPO_ROOT } from '../../support/paths.js';
import { startServer, type E2EServer, type StartServerOptions } from '../../support/server.js';
import { Client, Recorder, type Recorded } from './http.js';

/**
 * One API suite file's server and recorder (PLAN-33). The file's last test is
 * the same for every file: every response it received met `openapi.json`, and
 * none leaked a filesystem path or a stack frame.
 */

export interface ApiSuite {
  server: E2EServer;
  recorder: Recorder;
  /** A client with its own cookie jar and device id. */
  client(deviceId?: string): Client;
}

/** `at fn (/x/y.js:12:34)` or `at /x/y.js:12:34` — a stack frame, minified or not. */
const STACK_FRAME = /\bat (?:[^\s()]+ )?\(?(?:file:\/\/)?\/[^\s():]+:\d+:\d+\)?/;

/** Bodies worth scanning: what the API writes, not what a test uploaded or a built asset. */
function scannable(entry: Recorded): boolean {
  const type = entry.headers.get('content-type') ?? '';
  return /^application\/json|^text\/(plain|html|event-stream)/.test(type);
}

export function hygieneProblems(recorder: Recorder, server: E2EServer): string[] {
  const home = os.homedir();
  const needles = [server.storageRoot, REPO_ROOT, ...(home && home !== '/' ? [home] : [])];
  if (server.canary) needles.push(server.canary.contents);
  const problems: string[] = [];
  for (const entry of recorder.responses) {
    if (server.canary && entry.text.includes(server.canary.contents)) {
      problems.push(`${entry.method} ${entry.path}: the canary's contents`);
      continue;
    }
    if (!scannable(entry)) continue;
    const leaked = needles.find((needle) => entry.text.includes(needle));
    if (leaked) problems.push(`${entry.method} ${entry.path}: a filesystem path (${leaked})`);
    else if (STACK_FRAME.test(entry.text))
      problems.push(`${entry.method} ${entry.path}: a stack frame`);
  }
  return problems;
}

export function apiSuite(name: string, options: StartServerOptions = {}): ApiSuite {
  const suite = { recorder: new Recorder() } as ApiSuite;
  beforeAll(async () => {
    suite.server = await startServer(options);
    suite.client = (deviceId?: string) =>
      new Client(suite.server.baseUrl, suite.recorder, deviceId ?? `e2e-api-${name}`);
  });
  afterAll(async () => {
    suite.recorder.flush(name, inject('apiRecordDir'));
    await suite.server?.stop();
  });
  return suite;
}

/** Register the file's closing check; call it last in the file. */
export function closingChecks(suite: ApiSuite, servers: () => E2EServer[] = () => []): void {
  it('every response met openapi.json and leaked no path, stack frame or canary', () => {
    expect(suite.recorder.problems).toEqual([]);
    const all = [suite.server, ...servers()];
    expect(all.flatMap((server) => hygieneProblems(suite.recorder, server))).toEqual([]);
  });
}
