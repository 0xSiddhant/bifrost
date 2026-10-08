import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../bus/index.js';

/**
 * API versioning (PLAN-37). Every API answers under a version: `/api/v1/…`,
 * and the raw-document routes at `/<kind>/api/v1/:slug`. The paths from before
 * versions existed keep working forever as **v1**, which is what they meant
 * then: they are rewritten to their v1 route before routing, so one route
 * serves both, and a rate limit, an admin guard, the contract check and the
 * metric label can never differ between the two (an alias route per path
 * would give each its own rate-limit bucket; spiked, decisions.md 2026-10-04).
 *
 * `/go/:slug` and `/metrics` are not APIs and are never versioned.
 */

/** The current version's prefix; the client and the CLI build every call from it. */
export const API_V1 = '/api/v1';

/** The four document kinds whose raw content is a public, CORS-open URL. */
export const RAW_DOCUMENT_KINDS = ['runestone', 'edda', 'groot', 'atlas'] as const;

const VERSION_SEGMENT = /^v\d+$/;
const RAW_PREFIX = new RegExp(`^/(${RAW_DOCUMENT_KINDS.join('|')})/api/(.*)$`);

/**
 * The v1 URL a legacy, unversioned API URL stands for, or null when `url` is
 * not one (already versioned, not an API, or no route either way).
 *
 * - `/api/<x>` → `/api/v1/<x>`, unless `<x>` starts with a version segment.
 * - `/<kind>/api/<slug>` → `/<kind>/api/v1/<slug>`. The raw routes take
 *   exactly one segment, so a single segment is always a slug, even one that
 *   reads `v1`: `/runestone/api/v1` is the document `v1`, not the version.
 *
 * The query string travels unchanged.
 */
export function legacyToV1(url: string): string | null {
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? '' : url.slice(queryAt);

  if (path.startsWith('/api/')) {
    const rest = path.slice('/api/'.length);
    const first = rest.split('/', 1)[0] ?? '';
    if (first === '' || VERSION_SEGMENT.test(first)) return null;
    return `${API_V1}/${rest}${query}`;
  }

  const raw = RAW_PREFIX.exec(path);
  if (raw) {
    const [, kind, rest = ''] = raw;
    if (rest === '' || rest.includes('/')) return null;
    return `/${kind}/api/v1/${rest}${query}`;
  }
  return null;
}

/** Fastify's `rewriteUrl`: runs on the raw request, before routing. */
export function rewriteLegacyUrl(request: { url?: string }): string {
  const url = request.url ?? '/';
  return legacyToV1(url) ?? url;
}

/**
 * Marks every request that arrived on a legacy path (`originalUrl` differs
 * from the rewritten `url`): `Deprecation: true` and the v1 URL as the
 * `successor-version` link, a `debug` line, and `http.legacyApiRequest` on
 * the bus, which the metrics module counts per route. The body is untouched.
 */
export function registerLegacyPathMarker(app: FastifyInstance, bus?: EventBus): void {
  app.addHook('onRequest', (request, reply, done) => {
    if (request.originalUrl !== request.url) {
      void reply.header('deprecation', 'true');
      void reply.header('link', `<${request.url}>; rel="successor-version"`);
      const route = request.routeOptions?.url ?? 'unmatched';
      request.log.debug(
        { legacyUrl: request.originalUrl, url: request.url, route },
        'legacy unversioned API path',
      );
      bus?.emit('http.legacyApiRequest', { route, method: request.method });
    }
    done();
  });
}
