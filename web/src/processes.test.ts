import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAPE,
  launchFor,
  parseRunShape,
  processesFor,
  RunShapeError,
} from './processes.js';

describe('processesFor (npm start, PLAN-36/39)', () => {
  const names = (...args: Parameters<typeof processesFor>) =>
    processesFor(...args).map((spec) => spec.name);

  it('runs the processes of the mode, the API first', () => {
    expect(names('full', 'web', '/repo')).toEqual(['api', 'web']);
    expect(names('api', 'web', '/repo')).toEqual(['api']);
    expect(names('web', 'web', '/repo')).toEqual(['web']);
  });

  it('adds the native advertiser only for MDNS_ADVERTISER=host', () => {
    expect(names('api', 'host', '/repo')).toEqual(['api', 'mdns']);
    expect(names('full', 'host', '/repo')).toEqual(['api', 'web', 'mdns']);
    expect(names('full', 'off', '/repo')).toEqual(['api', 'web']);
    const mdns = processesFor('api', 'host', '/repo').at(-1);
    expect(mdns).toMatchObject({ args: ['web/dist/advertise.js'], cwd: '/repo' });
  });
});

describe('the run shape every launcher takes from flags (owner, 2026-10-09)', () => {
  it('maps each shape to its processes and the launcher keys they get', () => {
    expect(launchFor(DEFAULT_SHAPE)).toEqual({
      mode: 'full',
      advertiser: 'web',
      env: { BIFROST_RUN: 'full', MDNS_ADVERTISER: 'web', OTEL_ENABLED: 'false' },
    });
    // A web host in Docker: the API and bifrost-mdns here, and the API still
    // runs as `full` (a web host exists), so it prints the address and QR.
    const docker = launchFor({ web: 'docker', standalone: false, otel: true });
    expect(processesFor(docker.mode, docker.advertiser, '/repo').map((spec) => spec.name)).toEqual([
      'api',
      'mdns',
    ]);
    expect(docker.env).toEqual({
      BIFROST_RUN: 'full',
      MDNS_ADVERTISER: 'host',
      OTEL_ENABLED: 'true',
    });
    expect(launchFor({ web: 'none', standalone: false, otel: false }).env.BIFROST_RUN).toBe('api');
    expect(launchFor({ web: 'native', standalone: true, otel: false })).toMatchObject({
      mode: 'web',
    });
  });

  it('parses the flags, and refuses what cannot run', () => {
    expect(parseRunShape([])).toEqual(DEFAULT_SHAPE);
    expect(parseRunShape(['--web', 'docker', '--otel'])).toEqual({
      web: 'docker',
      standalone: false,
      otel: true,
    });
    expect(parseRunShape(['--web=none'])).toMatchObject({ web: 'none' });
    for (const argv of [
      ['--web'],
      ['--web', 'cloud'],
      ['--standalone', '--web', 'docker'],
      ['--standalone', '--otel'],
      ['--mode', 'api'],
    ]) {
      expect(() => parseRunShape(argv)).toThrow(RunShapeError);
    }
  });
});
