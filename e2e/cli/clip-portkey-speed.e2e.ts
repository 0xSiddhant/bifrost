import { describe, expect, it } from 'vitest';
import { Api } from '../support/api.js';
import { useCliSuite } from './harness.js';

const cli = useCliSuite();

interface Clip {
  id: string;
  text: string;
  kind: string;
  lang: string | null;
}
describe('clip', () => {
  it('shares, prints the newest, lists, and removes', async () => {
    const posted = await cli.json<Clip>(['clip', 'ssh pi@10.0.0.7']);
    expect(posted.run.code).toBe(0);
    expect(posted.body.text).toBe('ssh pi@10.0.0.7');

    const newest = await cli.bifrost(['clip']);
    expect(newest.code).toBe(0);
    expect(newest.stdout.trim()).toBe('ssh pi@10.0.0.7');

    const code = await cli.json<Clip>([
      'clip',
      'const x = 1',
      '--code',
      '--lang',
      'ts',
      '--ttl',
      '3600',
    ]);
    expect(code.body).toMatchObject({ kind: 'code', lang: 'ts' });

    const list = await cli.json<Clip[]>(['clip', '--list']);
    expect(list.body.map((entry) => entry.text)).toEqual(['const x = 1', 'ssh pi@10.0.0.7']);
    expect((await cli.bifrost(['clip', '--list'])).stdout).toContain('ssh pi@10.0.0.7');

    for (const entry of list.body)
      expect((await cli.bifrost(['clip', '--rm', entry.id])).code).toBe(0);
    const empty = await cli.bifrost(['clip']);
    expect(empty.code).toBe(4);
  });
});

describe('speed', () => {
  it('a small test lands and joins the history', async () => {
    const { run, body } = await cli.json<{
      testMb: number;
      downMbps: number;
      upMbps: number;
      latencyMs: number;
    }>(['speed', '--mb', '1']);
    expect(run.code).toBe(0);
    expect(body.testMb).toBe(1);
    expect(body.downMbps).toBeGreaterThan(0);
    const human = await cli.bifrost(['speed', '--mb', '1']);
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(/Mbps/);
  });

  it('a test while another device holds the bridge exits 5', async () => {
    // Another device's test holds the single-flight lease for a grace period.
    await new Api(cli.server().baseUrl, 'e2e-other-broom').get('/api/v1/nimbus/down?mb=1');
    const busy = await cli.bifrost(['speed', '--mb', '1']);
    expect(busy.code).toBe(5);
    expect(busy.stderr).toContain('another broom is flying');
    await new Api(cli.server().baseUrl, 'e2e-other-broom').post('/api/v1/nimbus/release');
  });
});
