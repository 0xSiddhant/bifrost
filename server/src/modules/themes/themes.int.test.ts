import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

const CUSTOM_THEME = {
  id: 'midgard',
  name: 'Midgard',
  mode: 'light' as const,
  tokens: {
    '--bg': '#f5f2ea',
    '--surface': '#ffffff',
    '--surface-2': '#ece7db',
    '--text': '#252b3d',
    '--text-muted': '#6b7183',
    '--border': '#ddd6c6',
    '--accent': '#0e7490',
    '--accent-2': '#7c3aed',
    '--ok': '#15803d',
    '--danger': '#b91c1c',
    '--warn': '#a16207',
    '--accent-soft': 'rgba(14, 116, 144, 0.1)',
    '--danger-soft': 'rgba(185, 28, 28, 0.1)',
    '--scrim': 'rgba(30, 28, 22, 0.45)',
  },
};

/** Log in over HTTP and return the `bifrost_admin` cookie for guarded writes. */
async function adminCookie(app: RunningApp, pin = '4321'): Promise<string> {
  const res = await app.fastify.inject({
    method: 'POST',
    url: '/api/heimdall/login',
    payload: { pin },
  });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return header!.split(';')[0]!;
}

describe('themes over HTTP', () => {
  let app: RunningApp;
  let cookie: string;
  let storageRoot: string;
  let themesDir: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-themes-'));
    themesDir = path.join(storageRoot, 'themes');
    fs.mkdirSync(themesDir, { recursive: true });
    // Seed with the committed built-ins — proves the engine subsumes them.
    for (const name of ['aurora.json', 'daybreak.json']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'themes', name), path.join(themesDir, name));
    }
    // One broken file: boot must skip it, not crash.
    fs.writeFileSync(path.join(themesDir, 'broken.json'), '{ "id": "broken" }');
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      THEMES_DIR: themesDir,
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
    cookie = await adminCookie(app);
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('boots past an invalid theme file and lists only valid themes', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/themes' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      defaultId: string | null;
      themes: { id: string; builtIn: boolean; preview: { bg: string } }[];
    };
    expect(body.themes.map((theme) => theme.id).sort()).toEqual(['aurora', 'daybreak']);
    expect(body.defaultId).toBeNull(); // nothing configured → client uses prefers-color-scheme
    expect(body.themes.every((theme) => theme.builtIn)).toBe(true);
  });

  it('serves a full resolved theme by id and 404s unknown ids', async () => {
    const aurora = await app.fastify.inject({ method: 'GET', url: '/api/themes/aurora' });
    expect(aurora.statusCode).toBe(200);
    const theme = aurora.json() as { mode: string; tokens: Record<string, string> };
    expect(theme.mode).toBe('dark');
    expect(theme.tokens['--bg']).toBe('#0b0e14');
    expect(theme.tokens['--syn-key']).toBe('#2dd4bf');

    const missing = await app.fastify.inject({ method: 'GET', url: '/api/themes/nope-nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('POST with a missing color role returns the exact ajv path in the 422 body', async () => {
    const invalid = structuredClone(CUSTOM_THEME) as { tokens: Record<string, string> };
    delete invalid.tokens['--danger'];
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/themes',
      payload: invalid,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { error: string; issues: { path: string; message: string }[] };
    expect(body.error).toBe('INVALID_THEME');
    expect(
      body.issues.some(
        (issue) => issue.path.includes('/tokens') && issue.message.includes('--danger'),
      ),
    ).toBe(true);
  });

  it('POST a valid theme → 201, file on disk, appears in the listing', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/themes',
      payload: CUSTOM_THEME,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: 'midgard', builtIn: false });
    expect(fs.existsSync(path.join(themesDir, 'midgard.json'))).toBe(true);

    const listing = await app.fastify.inject({ method: 'GET', url: '/api/themes' });
    const ids = (listing.json() as { themes: { id: string }[] }).themes.map((t) => t.id);
    expect(ids).toContain('midgard');
  });

  it('POST duplicate id → 409; POST over a built-in id → 403', async () => {
    const duplicate = await app.fastify.inject({
      method: 'POST',
      url: '/api/themes',
      payload: CUSTOM_THEME,
      headers: { cookie },
    });
    expect(duplicate.statusCode).toBe(409);

    const builtIn = await app.fastify.inject({
      method: 'POST',
      url: '/api/themes',
      payload: { ...CUSTOM_THEME, id: 'aurora' },
      headers: { cookie },
    });
    expect(builtIn.statusCode).toBe(403);
  });

  it('DELETE refuses built-ins (403) and removes custom themes (204)', async () => {
    const refuse = await app.fastify.inject({
      method: 'DELETE',
      url: '/api/themes/aurora',
      headers: { cookie },
    });
    expect(refuse.statusCode).toBe(403);

    const remove = await app.fastify.inject({
      method: 'DELETE',
      url: '/api/themes/midgard',
      headers: { cookie },
    });
    expect(remove.statusCode).toBe(204);
    expect(fs.existsSync(path.join(themesDir, 'midgard.json'))).toBe(false);

    const gone = await app.fastify.inject({
      method: 'DELETE',
      url: '/api/themes/midgard',
      headers: { cookie },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('a hand-dropped valid file appears via the watcher within ~2s', async () => {
    const dropped = { ...CUSTOM_THEME, id: 'vanaheim', name: 'Vanaheim' };
    fs.writeFileSync(path.join(themesDir, 'vanaheim.json'), JSON.stringify(dropped));

    await vi.waitFor(
      async () => {
        const listing = await app.fastify.inject({ method: 'GET', url: '/api/themes' });
        const ids = (listing.json() as { themes: { id: string }[] }).themes.map((t) => t.id);
        expect(ids).toContain('vanaheim');
      },
      { timeout: 5_000, interval: 200 },
    );
  }, 10_000);

  it('a hand-dropped invalid file is skipped and the app keeps serving', async () => {
    fs.writeFileSync(path.join(themesDir, 'corrupt.json'), '{"id":"corrupt","mode":"dusk"}');
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const listing = await app.fastify.inject({ method: 'GET', url: '/api/themes' });
    expect(listing.statusCode).toBe(200);
    const ids = (listing.json() as { themes: { id: string }[] }).themes.map((t) => t.id);
    expect(ids).not.toContain('corrupt');
  }, 10_000);
});

describe('theme writes require a Heimdall session', () => {
  it('401s POST and DELETE without a session cookie; reads stay open', async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-themes-auth-'));
    const themesDir = path.join(storageRoot, 'themes');
    fs.mkdirSync(themesDir, { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'themes', 'aurora.json'), path.join(themesDir, 'aurora.json'));
    const app = await createApp(
      loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot, THEMES_DIR: themesDir }),
      { logger: pino({ level: 'silent' }) },
    );
    try {
      const post = await app.fastify.inject({
        method: 'POST',
        url: '/api/themes',
        payload: CUSTOM_THEME,
      });
      expect(post.statusCode).toBe(401);
      expect(post.json().error).toBe('UNAUTHORIZED');

      const del = await app.fastify.inject({ method: 'DELETE', url: '/api/themes/aurora' });
      expect(del.statusCode).toBe(401);

      const list = await app.fastify.inject({ method: 'GET', url: '/api/themes' });
      expect(list.statusCode).toBe(200);

      // With a valid session the same write goes through.
      const cookie = await adminCookie(app);
      const ok = await app.fastify.inject({
        method: 'POST',
        url: '/api/themes',
        payload: CUSTOM_THEME,
        headers: { cookie },
      });
      expect(ok.statusCode).toBe(201);
    } finally {
      await app.shutdown();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});

describe('theme enable/disable (Heimdall)', () => {
  let app: RunningApp;
  let storageRoot: string;
  let cookie: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-themes-vis-'));
    const themesDir = path.join(storageRoot, 'themes');
    fs.mkdirSync(themesDir, { recursive: true });
    for (const name of ['aurora.json', 'daybreak.json']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'themes', name), path.join(themesDir, name));
    }
    app = await createApp(
      loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot, THEMES_DIR: themesDir }),
      { logger: pino({ level: 'silent' }) },
    );
    cookie = await adminCookie(app);
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const manageIds = async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/themes/manage',
      headers: { cookie },
    });
    return res;
  };

  it('guards the manage listing and the toggle', async () => {
    const list = await app.fastify.inject({ method: 'GET', url: '/api/themes/manage' });
    expect(list.statusCode).toBe(401);
    const patch = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/themes/daybreak',
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(401);
  });

  it('lists every theme with an enabled flag when authenticated', async () => {
    const res = await manageIds();
    expect(res.statusCode).toBe(200);
    const themes = (res.json() as { themes: { id: string; enabled: boolean }[] }).themes;
    expect(themes.map((t) => t.id).sort()).toEqual(['aurora', 'daybreak']);
    expect(themes.every((t) => t.enabled)).toBe(true);
  });

  it('disabling a theme hides it from the public switcher listing', async () => {
    const patch = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/themes/daybreak',
      payload: { enabled: false },
      headers: { cookie },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ id: 'daybreak', enabled: false });

    const publicList = await app.fastify.inject({ method: 'GET', url: '/api/themes' });
    const ids = (publicList.json() as { themes: { id: string }[] }).themes.map((t) => t.id);
    expect(ids).toEqual(['aurora']);

    // Still visible (flagged) in the admin manager so it can be turned back on.
    const managed = (await manageIds()).json() as { themes: { id: string; enabled: boolean }[] };
    expect(managed.themes.find((t) => t.id === 'daybreak')?.enabled).toBe(false);
  });

  it('re-enabling restores it to the public listing', async () => {
    await app.fastify.inject({
      method: 'PATCH',
      url: '/api/themes/daybreak',
      payload: { enabled: true },
      headers: { cookie },
    });
    const publicList = await app.fastify.inject({ method: 'GET', url: '/api/themes' });
    const ids = (publicList.json() as { themes: { id: string }[] }).themes.map((t) => t.id);
    expect(ids.sort()).toEqual(['aurora', 'daybreak']);
  });

  it('refuses to disable the last enabled theme', async () => {
    await app.fastify.inject({
      method: 'PATCH',
      url: '/api/themes/aurora',
      payload: { enabled: false },
      headers: { cookie },
    });
    const last = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/themes/daybreak',
      payload: { enabled: false },
      headers: { cookie },
    });
    expect(last.statusCode).toBe(409);
    expect(last.json().error).toBe('LAST_THEME');
    // Re-enable aurora to leave a clean state.
    await app.fastify.inject({
      method: 'PATCH',
      url: '/api/themes/aurora',
      payload: { enabled: true },
      headers: { cookie },
    });
  });

  it('404s toggling an unknown theme', async () => {
    const res = await app.fastify.inject({
      method: 'PATCH',
      url: '/api/themes/nonesuch',
      payload: { enabled: false },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
