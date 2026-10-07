import { describe, expect, it } from 'vitest';
import { buildRootOf, DEFAULTS, diskRefusal, parseArgs, serverOverrides } from './options.js';

describe('parseArgs', () => {
  it('defaults to the plan’s load profile', () => {
    expect(parseArgs([])).toEqual(DEFAULTS);
    expect(DEFAULTS).toMatchObject({
      profile: 'load',
      connections: 20,
      durationSeconds: 20,
      minutes: 60,
    });
  });

  it('reads every flag, in both spellings', () => {
    const options = parseArgs([
      '--profile',
      'soak',
      '--connections=40',
      '--duration',
      '5',
      '--minutes=90',
      '--warmup-minutes',
      '2.5',
      '--strict',
      '--log-level',
      'info',
      '--contract=off',
      '--keep',
      '--sse-listeners',
      '50',
      '--uploads=2',
      '--upload-mb',
      '64',
    ]);
    expect(options).toMatchObject({
      profile: 'soak',
      connections: 40,
      durationSeconds: 5,
      minutes: 90,
      warmupMinutes: 2.5,
      strict: true,
      logLevel: 'info',
      contract: 'off',
      keep: true,
      sseListeners: 50,
      uploadCount: 2,
      uploadMb: 64,
    });
    expect(parseArgs(['--baseline', 'r.json']).baseline).toMatch(/\/r\.json$/);
  });

  it('refuses a storage root or a port, however spelled (criterion 2)', () => {
    for (const argv of [
      ['--storage-root', '/home/user/bifrost/storage'],
      ['--storage-root=storage'],
      ['--storage', 'storage'],
      ['--port', '4000'],
      ['--port=4000'],
      ['--url', 'http://bifrost.local:4000'],
    ]) {
      expect(() => parseArgs(argv)).toThrow(/^refused --/);
    }
  });

  it('refuses the strict contract mode, which would measure ajv', () => {
    expect(() => parseArgs(['--contract', 'strict'])).toThrow(/refused --contract strict/);
  });

  it('rejects unknown profiles, flags, levels and bad numbers', () => {
    expect(() => parseArgs(['--profile', 'burst'])).toThrow(/unknown profile/);
    expect(() => parseArgs(['--fast'])).toThrow(/unknown option --fast/);
    expect(() => parseArgs(['--log-level', 'loud'])).toThrow(/unknown log level/);
    expect(() => parseArgs(['--connections', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--minutes'])).toThrow(/needs a value/);
  });
});

describe('server env', () => {
  it('lifts only the rate limits, and carries the contract mode and log level', () => {
    expect(serverOverrides(DEFAULTS)).toEqual({
      UPLOAD_RATE_LIMIT_PER_MIN: '1000000',
      BROTLI_RATE_LIMIT_PER_MIN: '1000000',
      CLIENT_LOG_RATE_LIMIT_PER_MIN: '1000000',
      API_CONTRACT_CHECK: 'fallback',
    });
    expect(serverOverrides({ ...DEFAULTS, logLevel: 'info', contract: 'off' })).toMatchObject({
      LOG_LEVEL: 'info',
      API_CONTRACT_CHECK: 'off',
    });
    // Never a storage root or a port: startServer owns both.
    expect(Object.keys(serverOverrides(DEFAULTS))).not.toContain('STORAGE_ROOT');
    expect(Object.keys(serverOverrides(DEFAULTS))).not.toContain('PORT');
  });

  it('takes a checkout or its server/dist for --server-dist', () => {
    expect(buildRootOf('/tmp/before')).toBe('/tmp/before');
    expect(buildRootOf('/tmp/before/server/dist')).toBe('/tmp/before');
    expect(buildRootOf('/tmp/before/server/dist/')).toBe('/tmp/before');
  });
});

describe('disk-space guard (criterion 2)', () => {
  const GB = 2 ** 30;
  it('allows a run with three times the planned bytes free', () => {
    expect(diskRefusal(12 * GB, 4 * GB, '/tmp')).toBeNull();
  });

  it('refuses with the numbers and a way out when short', () => {
    const refusal = diskRefusal(10 * GB, 4 * GB, '/tmp');
    expect(refusal).toMatch(/10\.0 GB free in \/tmp/);
    expect(refusal).toMatch(/need 12\.0 GB/);
    expect(refusal).toMatch(/--upload-mb/);
  });
});
