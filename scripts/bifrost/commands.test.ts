// The task table must never point at something that is not there: every
// documented example plans cleanly, and every script, workspace script and
// file a plan names exists. Renaming an npm script without updating the table
// fails here, not on someone's terminal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS, COMPOSE_COMBINATIONS, TEST_ALL, UsageError, type Step } from './commands.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function scriptsOf(workspace: string | undefined): Record<string, string> {
  const file = path.join(ROOT, workspace ?? '', 'package.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts: Record<string, string> }).scripts;
}

/** What each step names that has to exist; empty when it names nothing checkable. */
function problems(step: Step): string[] {
  if (step.kind !== 'exec') return [];
  const { cmd, args } = step;
  const found: string[] = [];
  if (cmd === 'npm' && (args[0] === 'run' || args[0] === 'test' || args[0] === 'start')) {
    const script = args[0] === 'run' ? (args[1] as string) : args[0];
    const w = args.indexOf('-w');
    const workspace = w < 0 ? undefined : args[w + 1];
    if (!(script in scriptsOf(workspace)))
      found.push(`no "${script}" script in ${workspace ?? 'the root'}`);
  }
  if (cmd === 'tsx' || cmd === 'sh' || cmd === 'bash') {
    const file = args[0] as string;
    if (file !== '-c' && !fs.existsSync(path.join(ROOT, file))) found.push(`no file ${file}`);
  }
  if (cmd === 'docker') {
    // `-f <file>` before the compose verb; after it (`logs -f`) it means follow.
    const verb = args.findIndex((arg) => ['up', 'down', 'logs', 'ps', 'config'].includes(arg));
    args.slice(0, verb).forEach((arg, i) => {
      if (arg === '-f' && !fs.existsSync(path.join(ROOT, args[i + 1] as string)))
        found.push(`no file ${args[i + 1]}`);
    });
  }
  return found;
}

describe('./bifrost task table', () => {
  const ctx = { cwd: ROOT };

  it('has unique command names', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const command of COMMANDS) {
    for (const [example] of command.examples) {
      it(`plans "./bifrost ${example}" against things that exist`, () => {
        const [name, ...args] = example.split(' ');
        expect(name).toBe(command.name);
        const steps = command.plan(args, ctx);
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.flatMap(problems)).toEqual([]);
      });
    }
  }

  it('names real things in test all and every docker combination', () => {
    expect(TEST_ALL.flatMap(problems)).toEqual([]);
    const plan = COMMANDS.find((c) => c.name === 'docker')?.plan(['config'], ctx) ?? [];
    expect(plan).toHaveLength(COMPOSE_COMBINATIONS.length);
    expect(plan.flatMap(problems)).toEqual([]);
  });

  it('checks the same compose combinations CI validates', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const lines = [...ci.matchAll(/docker compose (.*?) ?config -q/g)].map((m) =>
      (m[1] as string).split(' ').filter(Boolean),
    );
    expect(lines).toEqual(COMPOSE_COMBINATIONS);
  });

  it('refuses what it does not understand with a usage error', () => {
    const plan = (name: string, args: string[]): unknown =>
      COMMANDS.find((c) => c.name === name)?.plan(args, ctx);
    expect(() => plan('db', ['generate'])).toThrow(UsageError);
    expect(() => plan('test', ['unit', 'nope'])).toThrow(UsageError);
    expect(() => plan('test', ['--', 'x'])).toThrow(UsageError);
    expect(() => plan('docker', ['up', 'api', '--obs'])).toThrow(UsageError);
    expect(() => plan('build', ['--bogus'])).toThrow(UsageError);
    expect(() => plan('restore', [])).toThrow(UsageError);
  });

  it('runs a relative restore path from where the caller stood', () => {
    const steps = COMMANDS.find((c) => c.name === 'restore')?.plan(['backups/x.zip'], {
      cwd: '/tmp/somewhere',
    });
    expect(steps?.[0]).toMatchObject({
      args: ['scripts/restore.ts', '/tmp/somewhere/backups/x.zip'],
    });
  });
});
