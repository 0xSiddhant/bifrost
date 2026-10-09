// The repo's task table: every way to develop, test, run, back up and ship
// Bifrost from a checkout, behind one entry (`./bifrost`, see main.ts).
//
// One source for four things: what a command runs, its `help`, the man page
// (`./bifrost man`) and `./bifrost list --json`. Each command only *plans* the
// existing npm or shell script it fronts; main.ts executes the plan, so
// `--dry-run` and the drift test (commands.test.ts) see exactly what would run.
//
// Not the `bifrost` LAN client in cli/ — that one is installed globally and
// talks to a running hub. This one needs the repo and never ships.
import path from 'node:path';

export type Step =
  | { kind: 'exec'; cmd: string; args: string[]; env?: Record<string, string> }
  | { kind: 'internal'; label: string; run: () => number | Promise<number> };

export class UsageError extends Error {}

export interface Context {
  /** Where the caller ran `./bifrost` from; steps always run at the repo root. */
  cwd: string;
}

export const GROUPS = ['Develop', 'Check & test', 'Run', 'Data', 'Docker', 'Help'] as const;
export type Group = (typeof GROUPS)[number];

export interface Command {
  name: string;
  group: Group;
  summary: string;
  /** Synopsis lines, without the leading `./bifrost`. */
  usage: string[];
  /** Paragraphs for `help <command>` and the man page. */
  description: string[];
  options?: Array<[flag: string, text: string]>;
  /** Arguments after `./bifrost`, and what they do. The drift test plans each one. */
  examples: Array<[args: string, text: string]>;
  plan(args: string[], ctx: Context): Step[];
}

// ---- argument helpers ------------------------------------------------------

interface Parsed {
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
  /** Everything after `--`, handed to the underlying tool untouched. */
  rest: string[];
}

function parse(args: string[], spec: { flags?: string[]; values?: string[] } = {}): Parsed {
  const cut = args.indexOf('--');
  const own = cut < 0 ? args : args.slice(0, cut);
  const rest = cut < 0 ? [] : args.slice(cut + 1);
  const parsed: Parsed = { positionals: [], flags: new Set(), values: new Map(), rest };
  for (let i = 0; i < own.length; i++) {
    const arg = own[i] as string;
    if (!arg.startsWith('-') || arg === '-') {
      parsed.positionals.push(arg);
      continue;
    }
    const [name, inline] = arg.split(/=(.*)/s, 2) as [string, string | undefined];
    if (spec.flags?.includes(name) && inline === undefined) {
      parsed.flags.add(name);
    } else if (spec.values?.includes(name)) {
      const value = inline ?? own[++i];
      if (value === undefined || value === '') throw new UsageError(`${name} needs a value`);
      parsed.values.set(name, value);
    } else {
      throw new UsageError(
        `unknown option ${arg} (anything for the underlying tool goes after --)`,
      );
    }
  }
  return parsed;
}

function oneOf<T extends string>(
  value: string | undefined,
  choices: readonly T[],
  what: string,
): T {
  if (value !== undefined && (choices as readonly string[]).includes(value)) return value as T;
  const got = value === undefined ? 'nothing' : `"${value}"`;
  throw new UsageError(`${what} must be one of ${choices.join(', ')} (got ${got})`);
}

function noMore(positionals: string[], from: number): void {
  if (positionals.length > from) throw new UsageError(`unexpected argument "${positionals[from]}"`);
}

function noRest(p: Parsed, why: string): void {
  if (p.rest.length > 0) throw new UsageError(`nothing can follow -- here: ${why}`);
}

// ---- step builders ---------------------------------------------------------

const exec = (cmd: string, args: string[], env?: Record<string, string>): Step =>
  env ? { kind: 'exec', cmd, args, env } : { kind: 'exec', cmd, args };

/** `npm run <script> [-w <workspace>] [-- <rest>]`. */
function npmRun(script: string, workspace?: string, rest: string[] = []): Step {
  const args = ['run', script];
  if (workspace) args.push('-w', workspace);
  if (rest.length > 0) args.push('--', ...rest);
  return exec('npm', args);
}

const tsx = (file: string, args: string[] = [], env?: Record<string, string>): Step =>
  exec('tsx', [file, ...args], env);

const sh = (file: string, args: string[] = []): Step => exec('sh', [file, ...args]);

// ---- docker ----------------------------------------------------------------

export const DOCKER_TARGETS = ['hub', 'api', 'web', 'web-mac', 'obs', 'standalone'] as const;
type DockerTarget = (typeof DOCKER_TARGETS)[number];

/** The compose flags for each target: one entry per way the files combine. */
const COMPOSE_FILES: Record<Exclude<DockerTarget, 'hub' | 'obs'>, string[]> = {
  api: ['-f', 'compose/api.yml', '--env-file', '.env'],
  web: ['-f', 'compose/web.yml', '--env-file', '.env'],
  'web-mac': ['-f', 'compose/web.yml', '-f', 'compose/web.bridge.yml', '--env-file', '.env'],
  standalone: ['-f', 'compose/standalone.yml'],
};
const OBS_FILES = [
  '-f',
  'compose/observability.yml',
  '--env-file',
  '.env',
  '--profile',
  'observability',
];

/** Every combination CI validates (ci.yml, "Validate compose combinations"). */
export const COMPOSE_COMBINATIONS: string[][] = [
  [],
  ['--profile', 'observability'],
  COMPOSE_FILES.api,
  COMPOSE_FILES.web,
  COMPOSE_FILES['web-mac'],
  OBS_FILES,
  [...COMPOSE_FILES.standalone, '--env-file', '.env'],
];

function composeArgs(target: DockerTarget, withObs: boolean): string[] {
  if (withObs && target !== 'hub') {
    throw new UsageError(
      '--obs only adds the stack to the hub; run `docker up obs` beside any other target',
    );
  }
  if (target === 'hub') return withObs ? ['--profile', 'observability'] : [];
  if (target === 'obs') return OBS_FILES;
  return COMPOSE_FILES[target];
}

function planDocker(args: string[]): Step[] {
  const p = parse(args, { flags: ['--obs', '--no-build', '-v'], values: ['--network'] });
  const verb = oneOf(
    p.positionals[0],
    ['up', 'down', 'logs', 'ps', 'config', 'smoke'] as const,
    'docker',
  );

  if (verb === 'config') {
    noMore(p.positionals, 1);
    return COMPOSE_COMBINATIONS.map((combo) =>
      exec('docker', ['compose', ...combo, 'config', '-q'], { BIFROST_DOCKER_NETWORK: 'proxy' }),
    );
  }
  if (verb === 'smoke') {
    noMore(p.positionals, 2);
    return [
      exec('bash', [
        'scripts/standalone-smoke.sh',
        p.positionals[1] ?? 'bifrost-standalone:latest',
      ]),
    ];
  }

  const target = oneOf(p.positionals[1] ?? 'hub', DOCKER_TARGETS, 'the docker target');
  noMore(p.positionals, 2);

  // The observability stack keeps its wrapper: it checks Docker is up and
  // prints where Grafana is.
  if (target === 'obs' && verb !== 'ps') {
    noRest(p, 'the observability wrapper takes no compose flags');
    if (verb === 'up') return [sh('scripts/observability.sh', ['up'])];
    if (verb === 'logs') return [sh('scripts/observability.sh', ['logs'])];
    return [sh('scripts/observability.sh', p.flags.has('-v') ? ['down', '-v'] : ['down'])];
  }

  let env: Record<string, string> | undefined;
  if (target === 'standalone') {
    const network = p.values.get('--network') ?? process.env.BIFROST_DOCKER_NETWORK;
    if (verb === 'up' && !network) {
      throw new UsageError(
        "the standalone site joins your reverse proxy's Docker network: pass --network <name> (see `docker network ls`)",
      );
    }
    // down/logs/ps only need the file to parse, so any name does.
    env = { BIFROST_DOCKER_NETWORK: network ?? 'proxy' };
  } else if (p.values.has('--network')) {
    throw new UsageError('--network is for the standalone target only');
  }

  const base = ['compose', ...composeArgs(target, p.flags.has('--obs'))];
  const tail: string[] = [];
  if (verb === 'up') tail.push('up', '-d', ...(p.flags.has('--no-build') ? [] : ['--build']));
  if (verb === 'down') tail.push('down', ...(p.flags.has('-v') ? ['-v'] : []));
  if (verb === 'logs') tail.push('logs', '-f');
  if (verb === 'ps') tail.push('ps');
  return [exec('docker', [...base, ...tail, ...p.rest], env)];
}

// ---- the table -------------------------------------------------------------

const WORKSPACES = ['server', 'client', 'cli', 'web', 'e2e', 'scripts'] as const;
const E2E_SUITES = ['ui', 'cli', 'api'] as const;

/** `test all`: the same gate CI runs, stopping at the first failure. */
export const TEST_ALL: Step[] = [
  exec('npm', ['audit', '--audit-level=low']),
  npmRun('lint'),
  npmRun('typecheck'),
  exec('npm', ['test']),
  npmRun('build'),
  npmRun('test:e2e'),
];

export const COMMANDS: Command[] = [
  {
    name: 'setup',
    group: 'Develop',
    summary: 'First run on a fresh clone: storage folders, .env, database migrations',
    usage: ['setup'],
    description: [
      'Creates the storage/ folders, copies .env.example to .env when there is none, and runs the database migrations. Safe to re-run: it also warns when .env is missing keys that .env.example has gained since.',
    ],
    examples: [['setup', 'after `npm install` on a fresh clone']],
    plan(args) {
      noMore(parse(args).positionals, 0);
      return [tsx('scripts/setup.ts')];
    },
  },
  {
    name: 'dev',
    group: 'Develop',
    summary: 'Hot-reloading dev servers: the API, the client on PORT, mDNS',
    usage: ['dev [--standalone]'],
    description: [
      'Runs the API in watch mode, the Vite client on PORT and the mDNS advertiser, prefixed per process. Ctrl-C stops all three.',
      'With --standalone, runs the browser-only standalone site instead (Vite on its own port, no server at all).',
    ],
    options: [['--standalone', 'the standalone site, not the hub']],
    examples: [
      ['dev', 'the hub, http://localhost:4646'],
      ['dev --standalone', 'the standalone site, http://localhost:5173'],
    ],
    plan(args) {
      const p = parse(args, { flags: ['--standalone'] });
      noMore(p.positionals, 0);
      return [p.flags.has('--standalone') ? npmRun('dev:standalone', 'client') : npmRun('dev')];
    },
  },
  {
    name: 'build',
    group: 'Develop',
    summary: 'Build everything: both clients, the API, the web host, the CLI',
    usage: ['build [--standalone]'],
    description: [
      'Builds the hub client, the standalone client, the API server and the web host, then packs the bifrost CLI and re-installs it globally (skipped under CI).',
      'With --standalone, builds only the standalone site into client/dist-standalone/; it fails if the bundle can still reach a server.',
    ],
    options: [['--standalone', 'only the standalone site']],
    examples: [
      ['build', 'everything `start` and the e2e suites need'],
      ['build --standalone', 'only client/dist-standalone/'],
    ],
    plan(args) {
      const p = parse(args, { flags: ['--standalone'] });
      noMore(p.positionals, 0);
      return [p.flags.has('--standalone') ? npmRun('build:standalone', 'client') : npmRun('build')];
    },
  },
  {
    name: 'preview',
    group: 'Develop',
    summary: 'Build the standalone site, then serve exactly that output',
    usage: ['preview'],
    description: [
      'Builds client/dist-standalone/ and serves it with Vite preview on http://localhost:4173: the real build output, the one to check before deploying the standalone site.',
    ],
    examples: [['preview', 'http://localhost:4173']],
    plan(args) {
      noMore(parse(args).positionals, 0);
      return [npmRun('build:standalone', 'client'), npmRun('preview:standalone', 'client')];
    },
  },
  {
    name: 'spec',
    group: 'Develop',
    summary: 'Regenerate server/openapi.json after changing a route',
    usage: ['spec'],
    description: [
      "Writes the OpenAPI description from the routes' own schemas. Commit the result: `npm test` fails while it is stale.",
    ],
    examples: [['spec', 'then commit server/openapi.json']],
    plan(args) {
      noMore(parse(args).positionals, 0);
      return [tsx('scripts/gen-openapi.ts')];
    },
  },
  {
    name: 'db',
    group: 'Develop',
    summary: 'Database: migrate, generate a migration, or browse it in Drizzle Studio',
    usage: ['db migrate', 'db generate --name <slug>', 'db studio'],
    description: [
      'migrate applies pending migrations to storage/data/app.db (setup and every start do this too).',
      'generate writes server/drizzle/NNNN_<slug>.sql from a change to server/src/core/db/schema.ts. Review the SQL before accepting it; the db-migration skill has the whole procedure.',
      'studio opens Drizzle Studio on the SQLite file.',
    ],
    options: [['--name <slug>', "the migration's name (generate only, required)"]],
    examples: [
      ['db migrate', 'apply pending migrations'],
      ['db generate --name add-tags', 'server/drizzle/NNNN_add-tags.sql'],
      ['db studio', 'browse and edit the data'],
    ],
    plan(args) {
      const p = parse(args, { values: ['--name'] });
      const sub = oneOf(p.positionals[0], ['migrate', 'generate', 'studio'] as const, 'db');
      noMore(p.positionals, 1);
      noRest(p, 'db takes no extra arguments');
      if (sub !== 'generate' && p.values.has('--name'))
        throw new UsageError('--name is for db generate only');
      if (sub === 'migrate') return [npmRun('migrate', 'server')];
      if (sub === 'studio') return [npmRun('db:studio', 'server')];
      const name = p.values.get('--name');
      if (!name) throw new UsageError('db generate needs --name <slug>');
      return [npmRun('db:generate', 'server', ['--name', name])];
    },
  },
  {
    name: 'lint',
    group: 'Check & test',
    summary: 'ESLint, including the module-boundary rules',
    usage: ['lint [--fix]'],
    description: ['A cross-module import is a failure here, not a warning.'],
    options: [['--fix', 'apply the fixes ESLint can make']],
    examples: [
      ['lint', 'the whole repo'],
      ['lint --fix', 'and fix what can be fixed'],
    ],
    plan(args) {
      const p = parse(args, { flags: ['--fix'] });
      noMore(p.positionals, 0);
      return [npmRun('lint', undefined, [...(p.flags.has('--fix') ? ['--fix'] : []), ...p.rest])];
    },
  },
  {
    name: 'typecheck',
    group: 'Check & test',
    summary: 'tsc over the root scripts and every workspace',
    usage: ['typecheck'],
    description: [
      'Vitest does not typecheck, so a green test run is never proof the code compiles: this is.',
    ],
    examples: [['typecheck', 'scripts/ and all five workspaces']],
    plan(args) {
      noMore(parse(args).positionals, 0);
      return [npmRun('typecheck')];
    },
  },
  {
    name: 'audit',
    group: 'Check & test',
    summary: 'npm audit at every severity; it must report 0',
    usage: ['audit'],
    description: [
      'A finding is fixed before any other work, smallest fix first: .agents/rules/coding.md, "Dependencies".',
    ],
    examples: [['audit', 'must say "found 0 vulnerabilities"']],
    plan(args) {
      noMore(parse(args).positionals, 0);
      return [exec('npm', ['audit', '--audit-level=low'])];
    },
  },
  {
    name: 'test',
    group: 'Check & test',
    summary: 'Run a test suite: unit (default), e2e, load, resilience, or all',
    usage: [
      'test [unit [<workspace>]] [-- <vitest args>]',
      'test e2e [ui|cli|api] [-- <runner args>]',
      'test load [-- <load options>]',
      'test resilience [--cycles <n>]',
      'test all',
    ],
    description: [
      "unit runs every workspace's Vitest suite and the scripts/ tests; name a workspace (server, client, cli, web, e2e, scripts) to run one, and filter it after --.",
      "e2e runs the end-to-end net against the current build (run `build` first): the installed-CLI suite, the black-box API suite, then the browser journeys. Name one suite to run it alone. Playwright's browsers are needed once: `cd e2e && npx playwright install chromium webkit`.",
      'load runs the load harness (on demand, never a gate); `./bifrost test load -- --help` lists its options. resilience restarts the built API 50 times, with SIGKILLs mid-write, and integrity-checks the database each time.',
      'all is the whole gate CI runs, stopping at the first failure: audit, lint, typecheck, unit, build, e2e.',
    ],
    options: [['--cycles <n>', 'restart cycles for resilience (default 50)']],
    examples: [
      ['test', 'every unit suite'],
      ['test unit server -- documents', 'the server suite, files matching "documents"'],
      ['test e2e', 'the whole end-to-end net'],
      ['test e2e ui -- --grep Runestone', 'only the matching browser journeys'],
      ['test load -- --profile stress', 'a stress run'],
      ['test resilience --cycles 5', 'a quick resilience pass'],
      ['test all', 'everything, as CI runs it'],
    ],
    plan(args) {
      const p = parse(args, { values: ['--cycles'] });
      const suite = oneOf(
        p.positionals[0] ?? 'unit',
        ['unit', 'e2e', 'load', 'resilience', 'all'] as const,
        'the suite',
      );
      if (suite !== 'resilience' && p.values.has('--cycles'))
        throw new UsageError('--cycles is for resilience only');
      if (suite === 'unit') {
        noMore(p.positionals, 2);
        const ws = p.positionals[1];
        if (ws === undefined) {
          noRest(p, 'name a workspace to pass arguments to its runner');
          return [exec('npm', ['test'])];
        }
        const workspace = oneOf(ws, WORKSPACES, 'the workspace');
        if (workspace === 'scripts')
          return [exec('vitest', ['run', '--dir', 'scripts', ...p.rest])];
        return [
          exec('npm', ['test', '-w', workspace, ...(p.rest.length ? ['--', ...p.rest] : [])]),
        ];
      }
      if (suite === 'e2e') {
        noMore(p.positionals, 2);
        const which = p.positionals[1];
        if (which === undefined) {
          noRest(p, 'name a suite (ui, cli or api) to pass arguments to its runner');
          return [npmRun('test:e2e')];
        }
        return [npmRun(`test:e2e:${oneOf(which, E2E_SUITES, 'the e2e suite')}`, 'e2e', p.rest)];
      }
      noMore(p.positionals, 1);
      if (suite === 'load') return [npmRun('test:load', 'e2e', p.rest)];
      noRest(p, `test ${suite} takes no extra arguments`);
      if (suite === 'resilience') {
        const cycles = p.values.get('--cycles');
        if (cycles !== undefined && !/^[1-9]\d*$/.test(cycles))
          throw new UsageError('--cycles must be a positive whole number');
        return [
          tsx('scripts/resilience.ts', [], cycles ? { RESILIENCE_CYCLES: cycles } : undefined),
        ];
      }
      return TEST_ALL;
    },
  },
  {
    name: 'start',
    group: 'Run',
    summary: 'Run the built hub in the foreground (the processes BIFROST_RUN picks)',
    usage: ['start [--mode full|api|web]'],
    description: [
      'Re-installs the global bifrost CLI from this checkout, then runs the production build as one: the API on loopback API_PORT and the web host on PORT. Run `build` first. Ctrl-C stops the web host, then the API.',
      '--mode overrides BIFROST_RUN from .env for this run: full (both), api (the API alone), web (the web host alone, serving the standalone site).',
    ],
    options: [
      ['--mode <full|api|web>', 'which processes to run (default: BIFROST_RUN, else full)'],
    ],
    examples: [
      ['start', 'the whole hub'],
      ['start --mode web', 'serve the standalone site to the LAN'],
    ],
    plan(args) {
      const p = parse(args, { values: ['--mode'] });
      noMore(p.positionals, 0);
      noRest(p, 'start takes no extra arguments');
      const mode = p.values.get('--mode');
      if (mode === undefined) return [exec('npm', ['start'])];
      return [
        exec('npm', ['start'], {
          BIFROST_RUN: oneOf(mode, ['full', 'api', 'web'] as const, '--mode'),
        }),
      ];
    },
  },
  {
    name: 'service',
    group: 'Run',
    summary: 'Always-on on macOS: build and (re)start under PM2 or launchd',
    usage: ['service pm2', 'service launchd'],
    description: [
      'Installs dependencies if needed, makes .env, builds, then starts the API and the web host as services that restart on crash and start at login. Idempotent: re-run it after pulling to rebuild and restart. docs/pm2.md and docs/launchd.md have the detail.',
      'The scripts also run on their own, before `npm install`: sh scripts/start-pm2.sh, sh scripts/start-launchd.sh.',
    ],
    examples: [
      ['service pm2', 'rich logs and monitoring; installs pm2'],
      ['service launchd', 'no extra dependencies'],
    ],
    plan(args) {
      const p = parse(args);
      const manager = oneOf(p.positionals[0], ['pm2', 'launchd'] as const, 'service');
      noMore(p.positionals, 1);
      noRest(p, 'service takes no extra arguments');
      return [sh(manager === 'pm2' ? 'scripts/start-pm2.sh' : 'scripts/start-launchd.sh')];
    },
  },
  {
    name: 'logs',
    group: 'Run',
    summary: "Pretty-tail the API's log file",
    usage: ['logs'],
    description: [
      'Follows storage/logs/current.log through pino-pretty. The web host writes its own series beside it (storage/logs/app-web.N.log).',
    ],
    examples: [['logs', 'Ctrl-C to stop']],
    plan(args) {
      noMore(parse(args).positionals, 0);
      return [
        exec('sh', ['-c', 'tail -F storage/logs/current.log | pino-pretty --levelKey logLevel']),
      ];
    },
  },
  {
    name: 'backup',
    group: 'Data',
    summary: 'Back up the database and storage now, or manage the scheduled backups',
    usage: [
      'backup [--include-env] [--meta]',
      'backup agent install|uninstall|start|stop|status',
      'backup agent run [--force]',
    ],
    description: [
      'Without agent: a consistent snapshot of the database (VACUUM INTO) and storage/ into one zip. --include-env adds .env (it holds secrets); --meta writes a checksum file beside the zip.',
      'agent manages the macOS launchd job that backs up to a cloud-synced folder on a schedule (BACKUP_* in .env). install also runs it once; stop and start pause and resume it; status shows the schedule, the last run and the next due date; run is the job itself, and --force skips its "not due yet" check.',
    ],
    options: [
      ['--include-env', 'put .env in the archive too'],
      ['--meta', 'write <archive>.meta.json beside the zip'],
      ['--force', 'agent run only: back up even if one is not due'],
    ],
    examples: [
      ['backup', 'a zip in the backups folder'],
      ['backup agent install', 'schedule backups (macOS)'],
      ['backup agent status', 'when the last one ran, when the next is due'],
      ['backup agent run --force', 'run the scheduled job now'],
    ],
    plan(args) {
      const p = parse(args, { flags: ['--include-env', '--meta', '--force'] });
      noRest(p, 'backup takes no extra arguments');
      if (p.positionals[0] !== 'agent') {
        noMore(p.positionals, 0);
        if (p.flags.has('--force')) throw new UsageError('--force is for `backup agent run`');
        return [
          tsx(
            'scripts/backup.ts',
            ['--include-env', '--meta'].filter((f) => p.flags.has(f)),
          ),
        ];
      }
      const sub = oneOf(
        p.positionals[1],
        ['install', 'uninstall', 'start', 'stop', 'status', 'run'] as const,
        'backup agent',
      );
      noMore(p.positionals, 2);
      if (p.flags.has('--include-env') || p.flags.has('--meta')) {
        throw new UsageError('--include-env and --meta are for a one-off `backup`');
      }
      if (p.flags.has('--force') && sub !== 'run')
        throw new UsageError('--force is for `backup agent run`');
      return [sh('scripts/backup-agent.sh', [sub, ...(p.flags.has('--force') ? ['--force'] : [])])];
    },
  },
  {
    name: 'restore',
    group: 'Data',
    summary: 'Restore a backup archive over storage/ (the hub must be stopped)',
    usage: ['restore <archive.zip | backup folder | folder of backups> [--force]'],
    description: [
      "Given a folder of backups, restores the newest. Refuses while the API answers on its port, and checks the archive's checksum when it has one; --force restores anyway.",
    ],
    options: [['--force', 'skip the safety checks']],
    examples: [['restore /Volumes/Backup/bifrost', 'the newest backup in that folder']],
    plan(args, ctx) {
      const p = parse(args, { flags: ['--force'] });
      noRest(p, 'restore takes no extra arguments');
      const target = p.positionals[0];
      if (target === undefined) throw new UsageError('restore needs an archive or a folder');
      noMore(p.positionals, 1);
      // Steps run at the repo root, so a relative path means the caller's cwd.
      const from = path.resolve(ctx.cwd, target);
      return [tsx('scripts/restore.ts', [from, ...(p.flags.has('--force') ? ['--force'] : [])])];
    },
  },
  {
    name: 'docker',
    group: 'Docker',
    summary: 'Run, stop, follow or check any Docker combination',
    usage: [
      'docker up [hub|api|web|web-mac|obs|standalone] [--obs] [--network <name>] [--no-build] [-- <compose args>]',
      'docker down [<target>] [-v]',
      'docker logs [<target>]',
      'docker ps [<target>]',
      'docker config',
      'docker smoke [<image>]',
    ],
    description: [
      'Targets (default hub): hub is the API and the web host on a Linux host; api and web are one of them alone (set BIFROST_RUN=api or web in .env); web-mac is the web host on Docker Desktop beside a native API; obs is the Grafana stack alone, beside a native or containerised hub; standalone is the browser-only site behind your reverse proxy.',
      "up builds and starts detached; --obs adds the Grafana stack to the hub; --network names the proxy's Docker network (standalone only, or set BIFROST_DOCKER_NETWORK). down -v also deletes the volumes (the obs stack's stored logs and dashboards).",
      'config checks that every combination still parses, as CI does (needs a .env). smoke runs a built standalone image read-only and checks it, as CI does (default image: bifrost-standalone:latest).',
      'The README\'s "Docker" section lists each combination with the plain docker compose command, for a machine without node_modules.',
    ],
    options: [
      ['--obs', 'up hub only: add the Grafana stack'],
      ['--network <name>', "standalone only: the reverse proxy's Docker network"],
      ['--no-build', 'up only: start the images already built'],
      ['-v', 'down only: delete the volumes too'],
    ],
    examples: [
      ['docker up', 'the hub on a Linux host'],
      ['docker up --obs', 'the hub plus Grafana, Loki, Prometheus, Tempo'],
      ['docker up web-mac', 'the web host on the Mac, beside the native API'],
      ['docker up obs', 'only the Grafana stack'],
      ['docker up standalone --network proxy', 'the standalone site behind your proxy'],
      ['docker logs', 'follow the hub'],
      ['docker down obs -v', 'stop the stack and wipe its data'],
      ['docker up -- --remove-orphans', 'upgrade from the pre-PLAN-36 single service'],
      ['docker config', 'every combination parses'],
      ['docker smoke', 'check the standalone image'],
    ],
    plan: planDocker,
  },
];
