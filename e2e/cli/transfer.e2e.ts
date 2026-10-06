import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANSI, useCliSuite } from './harness.js';

const cli = useCliSuite();

interface PushResult {
  accepted: { name: string; storedName: string; size: number; folder?: string }[];
  rejected: unknown[];
  folder: string | null;
}
interface Entry {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parent: string | null;
}

function workdir(): string {
  const dir = path.join(cli.home().dir, `work-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir);
  return dir;
}

describe('push and pull', () => {
  it('push stages files; --json reports each one', async () => {
    const dir = workdir();
    fs.writeFileSync(path.join(dir, 'one.txt'), 'one');
    fs.writeFileSync(path.join(dir, 'two.txt'), 'two two');
    const { run, body } = await cli.json<PushResult>(['push', 'one.txt', 'two.txt'], { cwd: dir });
    expect(run.code).toBe(0);
    expect(body.folder).toBeNull();
    expect(body.accepted.map((file) => file.storedName).sort()).toEqual(['one.txt', 'two.txt']);
    expect(fs.readFileSync(path.join(cli.server().storageRoot, 'uploads', 'one.txt'), 'utf8')).toBe(
      'one',
    );
  });

  it('push . sends the folder’s own files, skipping hidden ones', async () => {
    const dir = workdir();
    fs.writeFileSync(path.join(dir, 'visible.md'), '# hi');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(path.join(dir, 'nested', 'deep.txt'), 'deep');
    const { run, body } = await cli.json<PushResult>(['push', '.'], { cwd: dir });
    expect(run.code).toBe(0);
    expect(body.accepted.map((file) => file.name)).toEqual(['visible.md']);
  });

  it('push -d writes straight into a Downloads folder; pull lists and fetches it', async () => {
    const dir = workdir();
    fs.writeFileSync(path.join(dir, 'map.txt'), 'here be dragons');
    const pushed = await cli.json<PushResult>(['push', 'map.txt', '-d', 'Voyage'], { cwd: dir });
    expect(pushed.run.code).toBe(0);
    expect(pushed.body.folder).toBe('Voyage');

    // The folder row lands first; the file's row follows once the watcher has
    // seen the write finish — the same order a browser sees over SSE.
    await expect
      .poll(async () => (await cli.json<Entry[]>(['pull', '--list'])).body, { timeout: 10_000 })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Voyage', type: 'folder' }),
          expect.objectContaining({ name: 'map.txt', parent: 'Voyage' }),
        ]),
      );

    const human = await cli.bifrost(['pull', '--list']);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('Voyage');

    const out = workdir();
    const file = await cli.bifrost(['pull', 'Voyage/map.txt'], { cwd: out });
    expect(file.code, file.stderr).toBe(0);
    expect(fs.readFileSync(path.join(out, 'map.txt'), 'utf8')).toBe('here be dragons');

    const folder = await cli.bifrost(['pull', 'Voyage'], { cwd: out });
    expect(folder.code, folder.stderr).toBe(0);
    expect(fs.readFileSync(path.join(out, 'Voyage.zip')).subarray(0, 2).toString()).toBe('PK');

    // Never overwrites what is already there.
    const again = await cli.bifrost(['pull', 'Voyage/map.txt'], { cwd: out });
    expect(again.code).not.toBe(0);
  });

  it('a missing local file or remote name exits 4', async () => {
    const dir = workdir();
    expect((await cli.bifrost(['push', 'nope.txt'], { cwd: dir })).code).toBe(4);
    const run = await cli.bifrost(['--json', 'pull', 'no-such-file.txt'], { cwd: dir });
    expect(run.code).toBe(4);
    expect(run.stdout).toBe('');
    expect(JSON.parse(run.stderr)).toHaveProperty('error');
  });

  it('on a terminal: colour and a progress bar; piped: neither', async () => {
    const dir = workdir();
    fs.writeFileSync(path.join(dir, 'tty.txt'), 'x'.repeat(4096));
    const tty = await cli.bifrost(['push', 'tty.txt'], { cwd: dir, tty: true });
    expect(tty.code).toBe(0);
    expect(tty.stdout).toMatch(ANSI);
    expect(tty.stdout).toContain('▕');

    fs.writeFileSync(path.join(dir, 'pipe.txt'), 'x'.repeat(4096));
    const piped = await cli.bifrost(['push', 'pipe.txt'], { cwd: dir });
    expect(piped.code).toBe(0);
    expect(piped.stdout + piped.stderr).not.toMatch(ANSI);
    expect(piped.stdout + piped.stderr).not.toContain('▕');

    const listTty = await cli.bifrost(['pull', '--list'], { tty: true });
    expect(listTty.stdout).toMatch(ANSI);
    const listPiped = await cli.bifrost(['pull', '--list']);
    expect(listPiped.stdout).not.toMatch(ANSI);
  });
});
