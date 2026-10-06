/**
 * Routes PLAN-32b has not described yet (see `api-coverage.test.ts`). This
 * list only shrinks: describing a route forces its removal here, and PLAN-32c
 * empties the list and deletes this file.
 */
export const PENDING_ROUTES: readonly string[] = [
  'GET /api/heimdall/audit',
  'GET /api/loki/config',
  'PATCH /api/loki/settings',
  'GET /api/brotli/config',
  'POST /api/brotli/compress',
  'POST /api/brotli/decompress',
  'GET /api/accio',
  'POST /api/accio',
  'PATCH /api/accio/:id',
  'DELETE /api/accio/:id',
  'GET /api/nimbus/config',
  'GET /api/nimbus/ping',
  'GET /api/nimbus/down',
  'POST /api/nimbus/up',
  'POST /api/nimbus/release',
  'POST /api/nimbus/results',
  'GET /api/nimbus/results',
  'GET /api/portkey',
  'POST /api/portkey',
  'PATCH /api/portkey/:slug',
  'DELETE /api/portkey/:slug',
  'GET /go/:slug',
  'GET /api/screensaver/config',
  'PATCH /api/screensaver/settings',
  'GET /api/client-logs/config',
  'POST /api/client-logs',
  'GET /metrics',
  'GET /api/offline-mode/config',
  'PATCH /api/offline-mode/settings',
];
