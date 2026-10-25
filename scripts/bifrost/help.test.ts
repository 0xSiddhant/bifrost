// `--help` routing and the subcommand view: what `./bifrost <cmd> … --help`
// prints, and which `--help` belongs to a tool rather than to ./bifrost.
import { describe, expect, it } from 'vitest';
import { COMMANDS, type Command } from './commands.js';
import { commandHelp, helpWords, overview } from './help.js';

const command = (name: string): Command => {
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) throw new Error(`no command ${name}`);
  return c;
};

describe('helpWords', () => {
  it('finds --help and -h, and the words before them', () => {
    expect(helpWords(['--help'])).toEqual([]);
    expect(helpWords(['agent', '-h'])).toEqual(['agent']);
    expect(helpWords(['agent', 'run', '--force', '--help'])).toEqual(['agent', 'run']);
  });

  it('leaves a --help after -- to the underlying tool', () => {
    expect(helpWords(['load', '--', '--help'])).toBeNull();
    expect(helpWords(['unit', 'server', '--', '-h'])).toBeNull();
    expect(helpWords(['e2e', '--help', '--', '--grep', 'x'])).toEqual(['e2e']);
  });

  it('is null when no help is asked for', () => {
    expect(helpWords([])).toBeNull();
    expect(helpWords(['agent', 'status'])).toBeNull();
  });
});

describe('commandHelp', () => {
  it('lists every subcommand of a command', () => {
    const text = commandHelp(command('backup'));
    expect(text).toContain('Subcommands');
    for (const [sub] of command('backup').subcommands ?? []) expect(text).toContain(sub);
  });

  it('narrows to the branch the words name, keeping the options', () => {
    const text = commandHelp(command('backup'), ['agent']);
    expect(text).toContain('backup agent install');
    expect(text).toContain('backup agent run');
    expect(text).not.toContain('backup --local');
    expect(text).toContain('--force');
    expect(text).toContain('./bifrost help backup');
  });

  it('narrows as far as the words still name a subcommand', () => {
    const text = commandHelp(command('docker'), ['up', 'standalone', 'extra']);
    expect(text).toContain('docker up standalone');
    expect(text).not.toContain('docker down');
  });

  it('shows the whole command when the words name no subcommand', () => {
    expect(commandHelp(command('backup'), ['nope'])).toBe(commandHelp(command('backup')));
  });

  it('gives every command with subcommands a non-empty list', () => {
    for (const name of ['db', 'test', 'service', 'backup', 'docker'])
      expect(command(name).subcommands?.length).toBeGreaterThan(0);
  });
});

describe('overview', () => {
  it('keeps the Help rows apart from their text', () => {
    for (const row of ['help [cmd [sub]]', 'list [--json]'])
      expect(overview()).toMatch(new RegExp(`${row.replace(/[[\]]/g, '\\$&')}  +\\S`));
  });
});
