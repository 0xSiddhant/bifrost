import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Typed with the argument `open` really takes, so a test can read the URL the
// command chose out of `launch.mock.calls` (PLAN-28).
const launch = vi.hoisted(() =>
  vi.fn<(target: string) => Promise<undefined>>(async () => undefined),
);
// The browser is mocked, never actually spawned: CI has no display, and the
// assertion that matters is *which URL* preview chose.
vi.mock('open', () => ({ default: launch }));

const { startLiveServer } = await import('./test/liveServer.js');
const { runCli } = await import('./test/runCli.js');
const { updateConfig } = await import('./core/config.js');
const { cliVersion } = await import('./core/selfUpdate.js');
type LiveServer = Awaited<ReturnType<typeof startLiveServer>>;

/**
 * The read/write API surface — clipboard, go-links, documents, presence, health
 * and `doctor` — each against a real listening server.
 */

let server: LiveServer;
let workspace: string;
let host: string[];
const slugs: Record<string, string> = {};

/** Counts every `fetch` the CLI makes, so "one request, not four" is proven. */
function countFetches(): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return original(input, init);
  }) as typeof fetch;
  return { urls, restore: () => (globalThis.fetch = original) };
}

async function seed(kind: string, name: string, content: string): Promise<void> {
  const response = await fetch(`${server.baseUrl}/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  const record = (await response.json()) as { slug: string };
  slugs[kind] = record.slug;
}

beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-api-'));
  process.env.XDG_CONFIG_HOME = path.join(workspace, 'config');
  server = await startLiveServer();
  host = ['--host', server.baseUrl];

  await seed('runestone', 'My Config', '{\n  "port": 4646\n}');
  await seed('edda', 'Trip Notes', '# Trip\n\n- pack\n');
  await seed('groot', 'Compose', 'services:\n  web: {}\n');
  await seed('atlas', 'Info', '<?xml version="1.0"?>\n<plist version="1.0"><dict/></plist>\n');
}, 90_000);

afterAll(async () => {
  await server.stop();
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(workspace, { recursive: true, force: true });
});

afterEach(() => {
  launch.mockClear();
});

describe('clip', () => {
  it('shares text the server really stores, then reads it back', async () => {
    const added = await runCli([...host, '--json', 'clip', 'ssh pi@10.0.0.7']);
    const entry = added.json<{ id: string; text: string }>();
    expect(entry.text).toBe('ssh pi@10.0.0.7');

    // Visible to any other client immediately, which is what a browser's Hermes
    // page picks up over SSE.
    const listed = (await (await fetch(`${server.baseUrl}/api/clipboard`)).json()) as unknown[];
    expect(listed).toHaveLength(1);

    const read = await runCli([...host, 'clip']);
    expect(read.stdout).toBe('ssh pi@10.0.0.7\n');

    const removed = await runCli([...host, '--json', 'clip', '--rm', entry.id]);
    expect(removed.exitCode).toBe(0);
    expect(await (await fetch(`${server.baseUrl}/api/clipboard`)).json()).toEqual([]);
  });

  it('says the clipboard is empty rather than printing nothing', async () => {
    const run = await runCli([...host, 'clip']);
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('the clipboard is empty');
  });
});

describe('portkey and go', () => {
  it('creates a link a browser could then follow, and resolves it back', async () => {
    const created = await runCli([
      ...host,
      '--json',
      'portkey',
      'create',
      'router',
      'http://192.168.1.1',
      '--note',
      'the box',
    ]);
    expect(created.json<{ slug: string }>().slug).toBe('router');

    // The real hop, as a device would make it.
    const hop = await fetch(`${server.baseUrl}/go/router`, { redirect: 'manual' });
    expect(hop.status).toBe(302);
    expect(hop.headers.get('location')).toBe('http://192.168.1.1/');

    const resolved = await runCli([...host, 'go', 'router']);
    expect(resolved.stdout).toBe('http://192.168.1.1/\n');
    expect(resolved.exitCode).toBe(0);
  });

  it('reads the unknown-slug bounce as "not found", never following it into HTML', async () => {
    const run = await runCli([...host, 'go', 'no-such-link']);

    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('no go-link called "no-such-link"');
    expect(run.stdout).toBe('');
  });

  it('launches the target only when --open is passed', async () => {
    await runCli([...host, 'go', 'router']);
    expect(launch).not.toHaveBeenCalled();

    await runCli([...host, 'go', 'router', '--open']);
    expect(launch).toHaveBeenCalledWith('http://192.168.1.1/');
  });

  it('lists and removes', async () => {
    const listed = await runCli([...host, '--json', 'portkey', 'list']);
    expect(listed.json<unknown[]>()).toHaveLength(1);

    await runCli([...host, 'portkey', 'rm', 'router']);
    const empty = await runCli([...host, '--json', 'portkey', 'list']);
    expect(empty.json<unknown[]>()).toEqual([]);
  });
});

describe('open', () => {
  it('resolves each of the four kinds with no --type given', async () => {
    for (const kind of ['runestone', 'edda', 'groot', 'atlas'] as const) {
      const run = await runCli([...host, '--json', 'open', slugs[kind] as string]);
      expect(run.json<{ kind: string }>().kind).toBe(kind);
    }
  });

  it('makes four requests without --type and exactly one with it', async () => {
    const counter = countFetches();
    await runCli([...host, '--json', 'open', slugs.groot as string]);
    const fannedOut = counter.urls.filter((url) => /\/(runestone|edda|groot|atlas)\/api\//.test(url));

    counter.urls.length = 0;
    await runCli([...host, '--json', 'open', slugs.groot as string, '--type', 'groot']);
    const direct = counter.urls.filter((url) => /\/(runestone|edda|groot|atlas)\/api\//.test(url));
    counter.restore();

    expect(fannedOut).toHaveLength(4);
    expect(direct).toHaveLength(1);
  });

  it('reports a nonexistent slug cleanly, not as a raw 404 dump', async () => {
    const run = await runCli([...host, 'open', 'nothing-here-a1b2c3']);

    expect(run.exitCode).toBe(4);
    expect(run.stderr).toBe('✗ error: no document with the slug "nothing-here-a1b2c3"\n');
  });
});

describe('preview', () => {
  it('opens edda’s real rendered page', async () => {
    const run = await runCli([...host, 'preview', slugs.edda as string]);

    expect(launch).toHaveBeenCalledWith(`${server.baseUrl}/edda/preview/${slugs.edda}`);
    expect(run.stdout.trim()).toBe(`${server.baseUrl}/edda/preview/${slugs.edda}`);
  });

  it('opens the raw content URL for the three kinds with no rendered page yet', async () => {
    for (const kind of ['runestone', 'groot', 'atlas'] as const) {
      launch.mockClear();
      const run = await runCli([...host, 'preview', slugs[kind] as string]);

      expect(launch).toHaveBeenCalledWith(`${server.baseUrl}/${kind}/api/${slugs[kind]}`);
      expect(run.stderr).toContain('no rendered page yet');
    }
  });

  it('prints instead of launching under --no-open, and never launches under --json', async () => {
    const printed = await runCli([...host, 'preview', slugs.edda as string, '--no-open']);
    expect(launch).not.toHaveBeenCalled();
    expect(printed.stdout.trim()).toBe(`${server.baseUrl}/edda/preview/${slugs.edda}`);

    const asJson = await runCli([...host, '--json', 'preview', slugs.edda as string]);
    expect(launch).not.toHaveBeenCalled();
    expect(asJson.json<{ url: string }>().url).toBe(`${server.baseUrl}/edda/preview/${slugs.edda}`);
  });

  it('handles a missing slug and a bad --type the same way `open` does', async () => {
    const missing = await runCli([...host, 'preview', 'nothing-here-a1b2c3']);
    expect(missing.exitCode).toBe(4);

    const badType = await runCli([...host, 'preview', slugs.edda as string, '--type', 'pensieve']);
    expect(badType.exitCode).toBe(1);
    expect(badType.stderr).toContain('unknown --type');
  });
});

/**
 * The local-file half of `preview` (PLAN-28, PLAN-29). The browser is still
 * mocked, but here the mock *acts* like one: it fetches the `?source=` URL out
 * of the page address, which is what proves the whole chain — the CLI served
 * the file, a page read it, and the one-shot server then closed and let the
 * command exit.
 */
describe('preview <file>', () => {
  let deck: string;
  let slides: string;

  beforeAll(() => {
    deck = path.join(workspace, 'deck.md');
    fs.writeFileSync(deck, '# One\n\n---\n\n# Two\n');
    // Not a valid PDF and does not need to be: nothing in the CLI parses it.
    // What is under test is that the bytes and the content type reach the page.
    slides = path.join(workspace, 'slides.pdf');
    fs.writeFileSync(slides, '%PDF-1.4 not really\n');
  });

  // The shared `launch` is only cleared between tests, not reset, so the
  // browser-shaped implementation below must not leak into the rest of the file.
  afterEach(() => {
    launch.mockImplementation(async () => undefined);
  });

  /** Stand in for the browser: fetch the payload the page would have fetched. */
  const browserThatReads = (captured: { body?: string; type?: string | null }) =>
    launch.mockImplementation(async (target: string) => {
      const source = new URL(target).searchParams.get('source');
      if (source) {
        const response = await fetch(source);
        captured.type = response.headers.get('content-type');
        captured.body = await response.text();
      }
      return undefined;
    });

  it('serves a real .md to Saga and closes once the page has read it', async () => {
    const captured: { body?: string; type?: string | null } = {};
    browserThatReads(captured);

    const run = await runCli([...host, 'preview', deck, '--type', 'saga']);

    expect(run.exitCode).toBe(0);
    const opened = new URL(String(launch.mock.calls[0]?.[0]));
    expect(opened.origin).toBe(server.baseUrl);
    expect(opened.pathname).toBe('/saga');
    expect(opened.searchParams.get('source')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/payload$/);
    // End to end: the bytes the page received are the bytes on disk.
    expect(captured.body).toBe('# One\n\n---\n\n# Two\n');
    expect(captured.type).toBe('text/markdown; charset=utf-8');
  });

  it('refuses --type saga on a .json before opening a browser or a port', async () => {
    // Acceptance 12.
    const run = await runCli([...host, 'preview', path.join(workspace, 'data.json'), '--type', 'saga']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('markdown');
    expect(run.stderr).toContain('.md, .markdown');
    expect(launch).not.toHaveBeenCalled();
  });

  it('serves a .pdf to Saga with no --type, telling the page what it is', async () => {
    // PLAN-29. The payload URL has no extension on it, so the content type is
    // the page's only clue about which of Saga's two sources it just received.
    const captured: { body?: string; type?: string | null } = {};
    browserThatReads(captured);

    const run = await runCli([...host, 'preview', slides]);

    expect(run.exitCode).toBe(0);
    expect(new URL(String(launch.mock.calls[0]?.[0])).pathname).toBe('/saga');
    expect(captured.type).toBe('application/pdf');
    expect(captured.body).toBe('%PDF-1.4 not really\n');
  });

  it('names the missing file rather than looking for a document by that name', async () => {
    const run = await runCli([...host, 'preview', path.join(workspace, 'gone.md'), '--type', 'saga']);
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('no such file');
  });

  it('asks for a --type rather than guessing markdown’s destination', async () => {
    const run = await runCli([...host, 'preview', deck]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--type saga');
    expect(launch).not.toHaveBeenCalled();
  });

  it('under --no-open prints the URL and serves nothing', async () => {
    const run = await runCli([...host, 'preview', deck, '--type', 'saga', '--no-open']);

    expect(launch).not.toHaveBeenCalled();
    expect(run.stdout.trim()).toContain('/saga?source=');
    expect(run.stderr).toContain('not served in --no-open mode');
  });

  it('leaves a bare slug resolving as a document, not as a file', async () => {
    // PLAN-27's own behaviour, unchanged: a slug has no separator and no
    // extension this table knows, so it never starts looking on disk.
    const run = await runCli([...host, 'preview', slugs.edda as string]);
    expect(launch).toHaveBeenCalledWith(`${server.baseUrl}/edda/preview/${slugs.edda}`);
    expect(run.exitCode).toBe(0);
  });
});

describe('status and devices', () => {
  it('reports the profile the server is actually running', async () => {
    const run = await runCli([...host, '--json', 'status']);
    const status = run.json<{ profile: string; modules: string[]; ok: boolean }>();

    expect(status.ok).toBe(true);
    expect(status.profile).toBe('local');
    expect(status.modules).toContain('file-transfer');
    expect(status.modules).toContain('portkey');
  });

  it('reads presence without writing to it', async () => {
    const run = await runCli([...host, '--json', 'devices']);
    expect(Array.isArray(run.json<unknown[]>())).toBe(true);
  });
});

describe('doctor', () => {
  it('passes every check against a reachable server', async () => {
    // Seed the throttle cache so the version check answers from it: `doctor`
    // must not depend on internet access, and the suite must not depend on
    // GitHub's rate limit.
    updateConfig({
      update: { lastCheckedAt: Date.now(), latestVersion: cliVersion(), assetUrl: null },
    });

    const run = await runCli([...host, '--json', 'doctor']);
    const checks = run.json<{ name: string; status: string }[]>();

    expect(run.exitCode).toBe(0);
    expect(checks).toHaveLength(6);
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('reports a version mismatch as a warning that never changes the exit code', async () => {
    updateConfig({
      update: { lastCheckedAt: Date.now(), latestVersion: '99.0.0', assetUrl: null },
    });

    const run = await runCli([...host, '--json', 'doctor']);
    const version = run.json<{ name: string; status: string; detail: string }[]>().find(
      (check) => check.name === 'cli version',
    );

    expect(run.exitCode).toBe(0);
    expect(version?.status).toBe('warn');
    expect(version?.detail).toContain('latest published v99.0.0');
  });

  it('fails, with the same remediation wording every command uses, against an unreachable host', async () => {
    const run = await runCli(['--host', '127.0.0.1:1', '--json', 'doctor']);
    const checks = run.json<{ name: string; status: string; detail: string }[]>();
    const reachable = checks.find((check) => check.name === 'server reachable');

    expect(run.exitCode).toBe(1);
    expect(reachable?.status).toBe('fail');
    expect(reachable?.detail).toContain('bifrost config set-host');
  });
});

describe('the GitHub API', () => {
  it('is never touched by an ordinary command', async () => {
    const counter = countFetches();
    await runCli([...host, '--json', 'status']);
    await runCli([...host, '--json', 'pull']);
    await runCli([...host, '--json', 'clip', 'a note']);
    await runCli([...host, '--json', 'devices']);
    await runCli([...host, '--json', 'open', slugs.edda as string]);
    counter.restore();

    expect(counter.urls.filter((url) => url.includes('api.github.com'))).toEqual([]);
    expect(counter.urls.length).toBeGreaterThan(0);
  });
});
