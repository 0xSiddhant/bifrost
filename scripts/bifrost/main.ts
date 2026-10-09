// `./bifrost <command>`: the entry behind the repo-root shim. Plans the command
// from the table in commands.ts, then runs each step at the repo root, stopping
// at the first failure. `help`, `list` and `man` render the same table.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { COMMANDS, GROUPS, UsageError, type Command, type Step } from './commands.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (text: string): boolean => process.stdout.write(text);
const err = (text: string): boolean => process.stderr.write(text);
const bold = (text: string): string =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[1m${text}\x1b[22m` : text;

const describe = (step: Step): string =>
  step.kind === 'internal'
    ? step.label
    : [...Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`), step.cmd, ...step.args].join(
        ' ',
      );

function find(name: string | undefined): Command | undefined {
  return COMMANDS.find((command) => command.name === name);
}

function overview(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  const lines = [
    `${bold('./bifrost')} <command> [args] [-- <tool args>]: every repo task from one place`,
    '',
  ];
  for (const group of GROUPS.filter((g) => g !== 'Help')) {
    lines.push(bold(group));
    for (const c of COMMANDS.filter((x) => x.group === group))
      lines.push(`  ${c.name.padEnd(width)}${c.summary}`);
    lines.push('');
  }
  lines.push(
    bold('Help'),
    `  ${'help [cmd]'.padEnd(width)}This overview, or one command's usage, options and examples`,
    `  ${'list [--json]'.padEnd(width)}Every command; --json gives the whole table, for scripts and agents`,
    `  ${'man'.padEnd(width)}The manual`,
    '',
    '--dry-run (-n) before a command prints what it would run instead of running it.',
    'Plain `bifrost` (no ./) is the installed LAN client; `man bifrost` is its manual.',
  );
  return `${lines.join('\n')}\n`;
}

function commandHelp(c: Command): string {
  const lines = [
    bold('Usage'),
    ...c.usage.map((u) => `  ./bifrost ${u}`),
    '',
    ...c.description.flatMap((d) => [d, '']),
  ];
  if (c.options?.length) {
    lines.push(bold('Options'));
    const width = Math.max(...c.options.map(([f]) => f.length)) + 2;
    for (const [flag, text] of c.options) lines.push(`  ${flag.padEnd(width)}${text}`);
    lines.push('');
  }
  lines.push(bold('Examples'));
  for (const [args, text] of c.examples) {
    lines.push(`  ./bifrost ${args}    # ${text}`);
    // Planned as on the Mac: some examples are the Mac's setups, and help shows them anywhere.
    const steps = c.plan(args.split(' ').slice(1), { cwd: ROOT, platform: 'darwin' });
    for (const step of steps)
      lines.push(`      ${step.always ? 'then, on exit' : 'runs'}: ${describe(step)}`);
  }
  return `${lines.join('\n')}\n`;
}

function manMarkdown(): string {
  const md = [
    'bifrost-dev(1) -- every Bifrost repo task from one place',
    '=======================================================',
    '',
    '## SYNOPSIS',
    '',
    '`./bifrost` [`--dry-run`] <command> [<args>...] [`--` <tool args>...]',
    '',
    '## DESCRIPTION',
    '',
    'Run from a checkout of the Bifrost repository. Each command fronts an existing npm or shell script, so nothing about how a task works changes; `--dry-run` prints the exact commands. Arguments after `--` go to the underlying tool. This is not bifrost(1), the installed client that talks to a running hub.',
    '',
  ];
  for (const group of GROUPS.filter((g) => g !== 'Help')) {
    md.push(`## ${group.toUpperCase()}`, '');
    for (const c of COMMANDS.filter((x) => x.group === group)) {
      for (const u of c.usage) md.push(`  * \`./bifrost ${u}\`:`);
      const options = (c.options ?? []).map(([flag, text]) => `\`${flag}\` ${text}`).join('; ');
      md.push(`    ${c.description.join(' ')}${options ? ` Options: ${options}.` : ''}`, '');
    }
  }
  md.push('## EXAMPLES', '');
  for (const c of COMMANDS)
    for (const [args, text] of c.examples) md.push(`    ./bifrost ${args}    # ${text}`);
  md.push(
    '',
    '## SEE ALSO',
    '',
    'bifrost(1), README.md, docs/testing.md, docs/docker-linux.md',
    '',
  );
  return md.join('\n');
}

function openMan(): number {
  const require = createRequire(import.meta.url);
  const markedMan = path.join(
    path.dirname(require.resolve('marked-man/package.json')),
    'bin',
    'marked-man.js',
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-dev-'));
  const source = path.join(dir, 'bifrost-dev.1.md');
  fs.writeFileSync(source, manMarkdown());
  const roff = spawnSync(
    process.execPath,
    [markedMan, '--manual', 'Bifrost Repo', '--section', '1', source],
    {
      encoding: 'utf8',
    },
  );
  if (roff.status !== 0) {
    err(roff.stderr);
    return 1;
  }
  const page = path.join(dir, 'bifrost-dev.1');
  fs.writeFileSync(page, roff.stdout);
  return spawnSync('man', [page], { stdio: 'inherit' }).status ?? 1;
}

function run(step: Step): Promise<number> {
  if (step.kind === 'internal') return Promise.resolve(step.run());
  return new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...step.env,
        PATH: `${path.join(ROOT, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });
    // Ctrl-C reaches the child through the terminal's process group; this
    // process only waits for it, and passes a SIGTERM on.
    const ignore = (): void => {};
    const forward = (): void => void child.kill('SIGTERM');
    process.on('SIGINT', ignore);
    process.on('SIGTERM', forward);
    child.on('error', (e) => {
      err(`✖ could not run ${step.cmd}: ${e.message}\n`);
      resolve(127);
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore);
      process.off('SIGTERM', forward);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const dryRun = argv[0] === '--dry-run' || argv[0] === '-n';
  const [name, ...args] = dryRun ? argv.slice(1) : argv;

  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    const target = args[0];
    if (target === undefined) return (void out(overview()), 0);
    const c = find(target);
    if (!c) throw new UsageError(`unknown command "${target}"`);
    return (void out(commandHelp(c)), 0);
  }
  if (name === 'list') {
    if (args[0] === '--json') {
      const table = COMMANDS.map((c) => ({
        name: c.name,
        group: c.group,
        summary: c.summary,
        usage: c.usage,
        description: c.description,
        options: c.options ?? [],
        examples: c.examples,
      }));
      return (void out(`${JSON.stringify(table, null, 2)}\n`), 0);
    }
    for (const c of COMMANDS) out(`${c.name}\t${c.summary}\n`);
    return 0;
  }
  if (name === 'man') return openMan();

  const command = find(name);
  if (!command) throw new UsageError(`unknown command "${name}"`);
  if (args.includes('--help') || args.includes('-h')) return (void out(commandHelp(command)), 0);

  const steps = command.plan(args, { cwd: process.cwd(), platform: process.platform });
  // Stop at the first failure, except for `always` steps: the cleanup after a
  // foreground run, which runs however that run ended (Ctrl-C included), but
  // only once something was started: a failed preflight check leaves alone what
  // was already running, such as a Grafana stack started on its own.
  let failed = 0;
  let started = false;
  for (const step of steps) {
    if (step.always ? !started && !dryRun : failed !== 0) continue;
    err(`${dryRun ? '' : '▶ '}${step.always && dryRun ? '(afterwards) ' : ''}${describe(step)}\n`);
    if (dryRun) continue;
    if (step.kind === 'exec' && !step.always) started = true;
    const code = await run(step);
    if (code !== 0 && failed === 0 && !step.always) failed = code;
  }
  return failed;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e: unknown) => {
    if (e instanceof UsageError) {
      err(`✖ ${e.message}\n  ./bifrost help for every command\n`);
      process.exitCode = 2;
    } else {
      throw e;
    }
  },
);
