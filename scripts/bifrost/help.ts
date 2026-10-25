// What `./bifrost help` and `<command> --help` print, rendered from the table
// in commands.ts. Kept apart from main.ts, which runs on import, so tests can
// call it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, GROUPS, type Command, type Step } from './commands.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bold = (text: string): string =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[1m${text}\x1b[22m` : text;

export const describe = (step: Step): string =>
  step.kind === 'internal'
    ? step.label
    : [...Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`), step.cmd, ...step.args].join(
        ' ',
      );

export function overview(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length), 'help [cmd [sub]]'.length) + 2;
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
    `  ${'help [cmd [sub]]'.padEnd(width)}This overview, one command's subcommands, options and examples, or one subcommand's`,
    `  ${'list [--json]'.padEnd(width)}Every command; --json gives the whole table, for scripts and agents`,
    `  ${'man'.padEnd(width)}The manual`,
    '',
    '<command> --help (-h) is help <command>; `backup agent --help` narrows to that subcommand.',
    '--dry-run (-n) before a command prints what it would run instead of running it.',
    'Plain `bifrost` (no ./) is the installed LAN client; `man bifrost` is its manual.',
  );
  return `${lines.join('\n')}\n`;
}

/** Whether a line's words after the command name begin with `branch`; `[a|b]` matches a or b. */
function startsWith(line: string, branch: string[]): boolean {
  const words = line.split(' ').slice(1);
  return branch.every((w, i) => (words[i] ?? '').replace(/[[\]]/g, '').split('|').includes(w));
}

/** The longest leading run of `words` that names a subcommand of `c`; [] for none. */
function subcommandBranch(c: Command, words: string[]): string[] {
  for (let n = words.length; n > 0; n--) {
    const branch = words.slice(0, n).join(' ');
    if (
      c.subcommands?.some(
        ([sub]) =>
          sub
            .split(' ')
            .slice(1, n + 1)
            .join(' ') === branch,
      )
    )
      return words.slice(0, n);
  }
  return [];
}

/**
 * `help <command>`. With `words` naming a subcommand (`backup agent`), only
 * that branch: its usage, subcommands and examples, and every option.
 */
export function commandHelp(c: Command, words: string[] = []): string {
  const branch = subcommandBranch(c, words);
  const inBranch = (line: string): boolean => startsWith(line, branch);
  const subcommands = (c.subcommands ?? []).filter(([sub]) => inBranch(sub));
  const lines = [bold('Usage'), ...c.usage.filter(inBranch).map((u) => `  ./bifrost ${u}`), ''];
  if (subcommands.length > 0) {
    lines.push(bold('Subcommands'));
    const width = Math.max(...subcommands.map(([sub]) => sub.length)) + 2;
    for (const [sub, text] of subcommands) lines.push(`  ${sub.padEnd(width)}${text}`);
    lines.push('');
  }
  if (branch.length === 0) lines.push(...c.description.flatMap((d) => [d, '']));
  if (c.options?.length) {
    lines.push(bold('Options'));
    const width = Math.max(...c.options.map(([f]) => f.length)) + 2;
    for (const [flag, text] of c.options) lines.push(`  ${flag.padEnd(width)}${text}`);
    lines.push('');
  }
  const examples = c.examples.filter(([args]) => inBranch(args));
  if (examples.length > 0) lines.push(bold('Examples'));
  for (const [args, text] of examples) {
    lines.push(`  ./bifrost ${args}    # ${text}`);
    // Planned as on the Mac: some examples are the Mac's setups, and help shows them anywhere.
    const steps = c.plan(args.split(' ').slice(1), { cwd: ROOT, platform: 'darwin' });
    for (const step of steps)
      lines.push(`      ${step.always ? 'then, on exit' : 'runs'}: ${describe(step)}`);
  }
  if (branch.length > 0) {
    if (examples.length > 0) lines.push('');
    lines.push(`The whole command, with the details: ./bifrost help ${c.name}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The words before `--help`/`-h` that say what to help with (`agent` in
 * `backup agent run --force --help`), or null when the args ask for no help.
 * Only before `--`: `test load -- --help` is the load harness's own help.
 */
export function helpWords(args: string[]): string[] | null {
  const ours = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  const at = ours.findIndex((a) => a === '--help' || a === '-h');
  if (at < 0) return null;
  const words = ours.slice(0, at);
  const flag = words.findIndex((a) => a.startsWith('-'));
  return flag < 0 ? words : words.slice(0, flag);
}
