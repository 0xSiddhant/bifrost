import { describe, expect, it } from 'vitest';
import { apiSuite, closingChecks } from './support/suite.js';

/**
 * The cloud profile, from outside (PLAN-32a's `cloud` Playwright project,
 * rewritten by PLAN-35). The client no longer asks the server what to show:
 * the nav comes from the build, so a hub client against a cloud server is
 * unsupported and the old nav assertions no longer mean anything. What still
 * matters is the security half: a `DEPLOY_PROFILE=cloud` server must refuse
 * every local-only route, whatever any client build would or would not link to.
 */

const suite = apiSuite('cloud-profile', { profile: 'cloud' });

/** One route of each local-only module, plus the write paths that matter most. */
const LOCAL_ONLY: [method: 'get' | 'post' | 'delete', path: string][] = [
  ['get', '/api/v1/files/config'],
  ['get', '/api/v1/downloads'],
  ['get', '/api/v1/clipboard'],
  ['post', '/api/v1/clipboard'],
  ['get', '/api/v1/presence'],
  ['get', '/api/v1/heimdall/audit'],
  ['get', '/api/v1/accio'],
  ['get', '/api/v1/nimbus/config'],
  ['get', '/api/v1/portkey'],
];

describe('cloud profile', () => {
  it('names the cloud module set in capabilities (the CLI still reads it)', async () => {
    const body = (await suite.client().get('/api/v1/capabilities')).json<{
      profile: string;
      modules: string[];
    }>();
    expect(body.profile).toBe('cloud');
    for (const local of ['file-transfer', 'previews', 'clipboard', 'presence', 'audit-log']) {
      expect(body.modules).not.toContain(local);
    }
    for (const local of ['accio', 'nimbus', 'portkey']) expect(body.modules).not.toContain(local);
    for (const both of [
      'runestone',
      'edda',
      'groot',
      'atlas',
      'variant',
      'loki',
      'brotli',
      'saga',
    ]) {
      expect(body.modules).toContain(both);
    }
  });

  it('refuses every local-only route with 404', async () => {
    const api = suite.client();
    for (const [method, path] of LOCAL_ONLY) {
      // The spec describes the local profile, where these routes exist: on a
      // cloud server their 404 is the point, not a contract breach.
      const response =
        method === 'post'
          ? await api.post(path, {}, { contract: false })
          : await api[method](path, { contract: false });
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(404);
    }
  });

  it('still serves what both profiles share', async () => {
    const api = suite.client();
    expect((await api.get('/api/v1/health')).status).toBe(200);
    expect((await api.get('/api/v1/runestone')).status).toBe(200);
    expect((await api.get('/api/v1/loki/config')).status).toBe(200);
  });
});

closingChecks(suite);
