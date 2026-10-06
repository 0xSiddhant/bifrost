import { describe, expect, it } from 'vitest';
import { Api } from '../support/api.js';
import { ANSI, useCliSuite } from './harness.js';

const cli = useCliSuite();

interface Clip {
  id: string;
  text: string;
  kind: string;
  lang: string | null;
}
interface Link {
  slug: string;
  url: string;
  note: string | null;
  hits: number;
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

describe('portkey and go', () => {
  it('create, list, update, go, a taken slug, and rm', async () => {
    const created = await cli.json<Link>([
      'portkey',
      'create',
      'nas',
      'http://10.0.0.2:5000',
      '--note',
      'the box',
    ]);
    expect(created.run.code).toBe(0);
    expect(created.body).toMatchObject({
      slug: 'nas',
      url: 'http://10.0.0.2:5000/',
      note: 'the box',
    });

    const taken = await cli.bifrost(['portkey', 'create', 'nas', 'http://10.0.0.3']);
    expect(taken.code).toBe(5);

    const go = await cli.bifrost(['go', 'nas']);
    expect(go.code).toBe(0);
    expect(go.stdout).toContain('http://10.0.0.2:5000/');

    const updated = await cli.json<Link>(['portkey', 'update', 'nas', '--url', 'http://10.0.0.9']);
    expect(updated.body.url).toBe('http://10.0.0.9/');

    const list = await cli.json<Link[]>(['portkey', 'list', '-q', 'nas']);
    expect(list.body).toEqual([expect.objectContaining({ slug: 'nas', hits: 1 })]);
    expect((await cli.bifrost(['portkey', 'list'], { tty: true })).stdout).toMatch(ANSI);
    expect((await cli.bifrost(['portkey', 'list'])).stdout).not.toMatch(ANSI);

    expect((await cli.bifrost(['portkey', 'rm', 'nas'])).code).toBe(0);
    expect((await cli.bifrost(['go', 'nas'])).code).toBe(4);
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
    await new Api(cli.server().baseUrl, 'e2e-other-broom').get('/api/nimbus/down?mb=1');
    const busy = await cli.bifrost(['speed', '--mb', '1']);
    expect(busy.code).toBe(5);
    expect(busy.stderr).toContain('another broom is flying');
    await new Api(cli.server().baseUrl, 'e2e-other-broom').post('/api/nimbus/release');
  });
});
