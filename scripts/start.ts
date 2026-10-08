// `npm start` (PLAN-36): start the hub's processes for the configured run mode
// and keep them as one. BIFROST_RUN (default full) decides which:
//   full → the API on loopback API_PORT, then the web host on PORT
//   api  → the API alone        web → the web host alone (standalone client)
// MDNS_ADVERTISER=host adds `mdns`, the native advertiser for a web host in a
// container (PLAN-39). The set itself is web/src/processes.ts (unit-tested).
// Output is prefixed per process; Ctrl-C or a SIGTERM stops the web host
// first, then the API; if either dies on its own, the other is stopped too.
import dotenv from 'dotenv';
import { fromRepoRoot } from '../server/src/core/paths.js';
import { processesFor } from '../web/src/processes.js';
import { supervise } from '../web/src/supervise.js';

dotenv.config({ path: fromRepoRoot('.env'), quiet: true });

const mode = process.env.BIFROST_RUN || 'full';
if (mode !== 'full' && mode !== 'api' && mode !== 'web') {
  process.stderr.write(`start: BIFROST_RUN must be full, api or web (got "${mode}")\n`);
  process.exit(1);
}
const advertiser = process.env.MDNS_ADVERTISER || 'web';
if (advertiser !== 'web' && advertiser !== 'host' && advertiser !== 'off') {
  process.stderr.write(`start: MDNS_ADVERTISER must be web, host or off (got "${advertiser}")\n`);
  process.exit(1);
}
const processes = processesFor(mode, advertiser, fromRepoRoot());
process.stdout.write(
  `[start] BIFROST_RUN=${mode}: ${processes.map((spec) => spec.name).join(' + ')}\n`,
);
const run = supervise(processes);
process.exitCode = await run.done;
