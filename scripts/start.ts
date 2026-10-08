// `npm start` (PLAN-36): start the hub's processes for the configured run mode
// and keep them as one. BIFROST_RUN (default full) decides which:
//   full → the API on loopback API_PORT, then the web host on PORT
//   api  → the API alone        web → the web host alone (standalone client)
// Output is prefixed per process; Ctrl-C or a SIGTERM stops the web host
// first, then the API; if either dies on its own, the other is stopped too.
import dotenv from 'dotenv';
import { fromRepoRoot } from '../server/src/core/paths.js';
import { supervise, type ChildSpec } from '../web/src/supervise.js';

dotenv.config({ path: fromRepoRoot('.env'), quiet: true });

export type RunMode = 'full' | 'api' | 'web';

const API: ChildSpec = {
  name: 'api',
  command: process.execPath,
  // --import, not an import inside bootstrap: ESM hoists, so the OTel SDK must
  // load before the app or its instrumentations patch nothing (PLAN-16b).
  args: ['--import', './server/dist/otel.js', 'server/dist/bootstrap.js'],
  cwd: fromRepoRoot(),
};
const WEB: ChildSpec = {
  name: 'web',
  command: process.execPath,
  args: ['web/dist/bootstrap.js'],
  cwd: fromRepoRoot(),
};

export function processesFor(mode: RunMode): ChildSpec[] {
  if (mode === 'api') return [API];
  if (mode === 'web') return [WEB];
  // The API first, so the web host's first proxied request has somewhere to go.
  return [API, WEB];
}

const raw = process.env.BIFROST_RUN || 'full';
if (raw !== 'full' && raw !== 'api' && raw !== 'web') {
  process.stderr.write(`start: BIFROST_RUN must be full, api or web (got "${raw}")\n`);
  process.exit(1);
}
const mode = raw as RunMode;
process.stdout.write(
  `[start] BIFROST_RUN=${mode}: ${processesFor(mode)
    .map((spec) => spec.name)
    .join(' + ')}\n`,
);
const run = supervise(processesFor(mode));
process.exitCode = await run.done;
