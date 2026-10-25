// `npm start` / `./bifrost start` (PLAN-36): start the hub's processes and keep
// them as one. The run's shape comes from flags, never from .env (owner,
// 2026-10-09):
//   (none)            the API on loopback API_PORT, then the web host on PORT
//   --web docker      the API + bifrost-mdns, for a web host in Docker
//   --web none        the API alone
//   --standalone      the web host alone, serving the standalone client
//   --otel            the API sends traces (OTEL_EXPORTER_OTLP_ENDPOINT)
// The mapping is web/src/processes.ts (unit-tested). Output is prefixed per
// process; Ctrl-C or a SIGTERM stops the web host first, then the API; if
// either dies on its own, the other is stopped too.
import fs from 'node:fs';
import { fromRepoRoot } from '../server/src/core/paths.js';
import {
  launchFor,
  parseRunShape,
  processesFor,
  RunShapeError,
  type RunShape,
} from '../web/src/processes.js';
import { supervise } from '../web/src/supervise.js';
import { askForPin, dropLauncherKeys, pinIsSet, updateMovedDefaults } from './env-file.js';

let shape: RunShape;
try {
  shape = parseRunShape(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof RunShapeError)) throw error;
  process.stderr.write(`start: ${error.message}\n`);
  process.exit(2);
}

// No hand edits needed (owner, 2026-10-09): leftover run-shape keys go, and a
// missing PIN is asked for on a terminal. Without one (CI, a pipe) the API
// names the missing PIN itself.
const envFile = fromRepoRoot('.env');
for (const line of dropLauncherKeys(envFile)) {
  process.stdout.write(`[start] removed ${line} from .env: the flags decide that now\n`);
}
for (const change of updateMovedDefaults(envFile)) {
  process.stdout.write(`[start] updated .env: ${change}\n`);
}
if ((process.env.HEIMDALL_PIN ?? '').length < 4 && !pinIsSet(envFile) && fs.existsSync(envFile)) {
  await askForPin(envFile);
}

const launch = launchFor(shape);
// Every child gets the launcher keys explicitly, so a value left in .env (which
// the processes ignore anyway) or in this shell cannot reshape the run.
const env = { ...process.env, ...launch.env };
const processes = processesFor(launch.mode, launch.advertiser, fromRepoRoot()).map((spec) => ({
  ...spec,
  env,
}));
process.stdout.write(
  `[start] ${processes.map((spec) => spec.name).join(' + ')}` +
    `${shape.web === 'docker' ? ' (the web host runs in Docker)' : ''}` +
    `${shape.otel ? ', traces on' : ''}\n`,
);
const run = supervise(processes);
process.exitCode = await run.done;
