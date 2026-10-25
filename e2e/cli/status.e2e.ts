import fs from 'node:fs';
import { describe, expect, it, inject } from 'vitest';
import { freePort } from '../support/free-port.js';
import { runCli } from '../support/cli-install.js';
import { ANSI, useCliSuite } from './harness.js';

const cli = useCliSuite();

describe('status, devices, config, doctor', () => {
  it('status: human and --json', async () => {
    const human = await cli.bifrost(['status']);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('local');
    expect(human.stdout).not.toMatch(ANSI);

    const { run, body } = await cli.json<{ profile: string; modules: string[] }>(['status']);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    expect(body.profile).toBe('local');
    expect(body.modules).toContain('portkey');
  });

  it('devices: human and --json', async () => {
    const human = await cli.bifrost(['devices']);
    expect(human.code).toBe(0);
    const { run, body } = await cli.json<unknown>(['devices']);
    expect(run.code).toBe(0);
    expect(body).toBeTypeOf('object');
  });

  it('config: set-host writes the throwaway home, never the real one', async () => {
    const set = await runCli(
      inject('bifrostBinary'),
      ['config', 'set-host', cli.server().baseUrl],
      { env: cli.home().env },
    );
    expect(set.code).toBe(0);
    const saved = JSON.parse(fs.readFileSync(cli.home().configFile, 'utf8')) as { host?: string };
    expect(saved.host).toBe(cli.server().baseUrl);

    // With the host saved, no --host is needed.
    const status = await runCli(inject('bifrostBinary'), ['--json', 'status'], {
      env: cli.home().env,
    });
    expect(status.code).toBe(0);

    const show = await cli.json<{ host?: string }>(['config', 'show']);
    expect(show.run.code).toBe(0);
    expect(JSON.stringify(show.body)).toContain(cli.server().baseUrl);
  });

  it('doctor: every link in the chain checks out (with no call to GitHub)', async () => {
    const human = await cli.bifrost(['doctor']);
    expect(human.code, human.stdout + human.stderr).toBe(0);
    expect(human.stdout).toContain('✓');
    const { run } = await cli.json<unknown>(['doctor']);
    expect(run.code).toBe(0);
  });

  it('an unreachable server exits 3 with the one remediation wording', async () => {
    const nobody = `http://127.0.0.1:${await freePort()}`;
    const human = await runCli(inject('bifrostBinary'), ['--host', nobody, 'status'], {
      env: cli.home().env,
    });
    expect(human.code).toBe(3);
    expect(human.stderr).toContain("couldn't reach the Bifrost server");
    expect(human.stderr).toContain('--host');

    const json = await runCli(inject('bifrostBinary'), ['--host', nobody, '--json', 'status'], {
      env: cli.home().env,
    });
    expect(json.code).toBe(3);
    expect(json.stdout).toBe('');
    expect(JSON.parse(json.stderr)).toHaveProperty('error');
  });
});
