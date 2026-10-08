import { describe, expect, it } from 'vitest';
import { processesFor } from './processes.js';

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
