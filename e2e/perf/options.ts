import path from 'node:path';

/**
 * The load harness's command line (PLAN-34). Kept apart from `run.ts` so the
 * parsing and the safety refusals are unit-tested without starting a server.
 */

export const PROFILES = ['load', 'stress', 'spike', 'soak', 'fanout'] as const;
export type Profile = (typeof PROFILES)[number];

export interface RunOptions {
  profile: Profile;
  /** `load`'s connection count; stress ramps from it, spike multiplies it, soak halves it. */
  connections: number;
  /** Seconds per scenario in `load`, per step in `stress`. */
  durationSeconds: number;
  /** Soak length. */
  minutes: number;
  /** Soak samples before this are the warm-up and are not fitted. */
  warmupMinutes: number;
  baseline: string | null;
  strict: boolean;
  /** Null: leave `LOG_LEVEL` at the production default (`trace`). */
  logLevel: string | null;
  contract: 'off' | 'fallback';
  /** A checkout (or its `server/dist`) to run instead of this one's build. */
  serverDist: string | null;
  keep: boolean;
  /** Fan-out sizes, adjustable for a smaller machine. */
  sseListeners: number;
  uploadCount: number;
  uploadMb: number;
}

export const DEFAULTS: RunOptions = {
  profile: 'load',
  connections: 20,
  durationSeconds: 20,
  minutes: 60,
  warmupMinutes: 10,
  baseline: null,
  strict: false,
  logLevel: null,
  contract: 'fallback',
  serverDist: null,
  keep: false,
  sseListeners: 200,
  uploadCount: 4,
  uploadMb: 1024,
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/**
 * Flags the harness refuses outright. It always runs on a fresh `mkdtemp`
 * storage root and an OS-assigned port, so it can never be pointed at the
 * household's `storage/` or at the running instance by mistake.
 */
const REFUSED: Record<string, string> = {
  '--storage-root': 'the harness always uses its own scratch storage, never a chosen one',
  '--storage': 'the harness always uses its own scratch storage, never a chosen one',
  '--port': 'the harness always runs on an OS-assigned port, never a chosen one',
  '--url': 'the harness only loads a server it started itself',
  '--base-url': 'the harness only loads a server it started itself',
};

export const USAGE = `npm run test:load -- [options]   (run \`npm run build\` first)

  --profile <load|stress|spike|soak|fanout>   default load
  --connections <n>       load connections (stress ramps, spike ×10, soak ×½)   default 20
  --duration <seconds>    per scenario (load) or per step (stress)               default 20
  --minutes <n>           soak length                                            default 60
  --warmup-minutes <n>    soak samples before this are not fitted                default 10
  --baseline <file>       compare against an earlier result (±% column, ⚠ past 10%)
  --strict                exit non-zero when a baseline comparison is flagged
  --log-level <level>     override LOG_LEVEL (default: production's trace)
  --contract <off|fallback>   API_CONTRACT_CHECK (default fallback; strict is refused)
  --server-dist <path>    run another build: a checkout, or its server/dist
  --keep                  keep the scratch storage for a post-mortem
  --sse-listeners <n>  --uploads <n>  --upload-mb <n>   fan-out sizes (200, 4, 1024)`;

function positive(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} needs a positive integer`);
  return value;
}

/**
 * Paths are resolved against `cwd`: the directory the caller ran npm from
 * (npm's `INIT_CWD`), not `e2e/`, which `npm run -w e2e` switches to.
 */
export function parseArgs(argv: string[], cwd = process.env.INIT_CWD ?? process.cwd()): RunOptions {
  const options: RunOptions = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2) as [
      string,
      string | undefined,
    ];
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[++index];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    const refused = REFUSED[flag];
    if (refused) throw new Error(`refused ${flag}: ${refused}`);
    switch (flag) {
      case '--profile': {
        const profile = value();
        if (!PROFILES.includes(profile as Profile)) {
          throw new Error(`unknown profile "${profile}" (one of ${PROFILES.join(', ')})`);
        }
        options.profile = profile as Profile;
        break;
      }
      case '--connections':
        options.connections = positive(flag, value());
        break;
      case '--duration':
        options.durationSeconds = positive(flag, value());
        break;
      case '--minutes':
        options.minutes = positive(flag, value());
        break;
      case '--warmup-minutes': {
        const minutes = Number(value());
        if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`${flag} needs a number ≥ 0`);
        options.warmupMinutes = minutes;
        break;
      }
      case '--baseline':
        options.baseline = path.resolve(cwd, value());
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--log-level': {
        const level = value();
        if (!LOG_LEVELS.includes(level)) throw new Error(`unknown log level "${level}"`);
        options.logLevel = level;
        break;
      }
      case '--contract': {
        const mode = value();
        if (mode === 'strict') {
          throw new Error(
            'refused --contract strict: it validates every response with ajv, which would make every number meaningless',
          );
        }
        if (mode !== 'off' && mode !== 'fallback')
          throw new Error(`unknown contract mode "${mode}"`);
        options.contract = mode;
        break;
      }
      case '--server-dist':
        options.serverDist = path.resolve(cwd, value());
        break;
      case '--keep':
        options.keep = true;
        break;
      case '--sse-listeners':
        options.sseListeners = positive(flag, value());
        break;
      case '--uploads':
        options.uploadCount = positive(flag, value());
        break;
      case '--upload-mb':
        options.uploadMb = positive(flag, value());
        break;
      case '--help':
      case '-h':
        throw new Error(USAGE);
      default:
        throw new Error(`unknown option ${flag}\n\n${USAGE}`);
    }
  }
  return options;
}

/** A checkout root from `--server-dist`, which may name the checkout or its `server/dist`. */
export function buildRootOf(serverDist: string): string {
  const normalized = path.resolve(serverDist);
  return normalized.endsWith(path.join('server', 'dist'))
    ? path.dirname(path.dirname(normalized))
    : normalized;
}

/**
 * The env the server runs with on top of production defaults. Only the rate
 * limits are lifted (they exist to stop abuse and would turn every write
 * scenario into a 429 measurement); the contract mode and log level are the
 * caller's, defaulting to what production runs.
 */
export function serverOverrides(options: RunOptions): Record<string, string> {
  const unlimited = '1000000';
  const env: Record<string, string> = {
    UPLOAD_RATE_LIMIT_PER_MIN: unlimited,
    BROTLI_RATE_LIMIT_PER_MIN: unlimited,
    CLIENT_LOG_RATE_LIMIT_PER_MIN: unlimited,
    API_CONTRACT_CHECK: options.contract,
  };
  if (options.logLevel) env.LOG_LEVEL = options.logLevel;
  return env;
}

/** Why a large-stream scenario must not start, or null when there is room (3× the planned bytes). */
export function diskRefusal(freeBytes: number, plannedBytes: number, where: string): string | null {
  const needed = plannedBytes * 3;
  if (freeBytes >= needed) return null;
  const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GB`;
  return `refusing the stream scenarios: ${gb(freeBytes)} free in ${where}, and they need ${gb(needed)} (3× the ${gb(plannedBytes)} they write). Free some space, or pass --uploads / --upload-mb for a smaller run.`;
}
