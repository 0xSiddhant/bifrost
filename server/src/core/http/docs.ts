import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

/**
 * The API docs (PLAN-38): Swagger UI for the live OpenAPI spec, at `/docs`
 * (`/docs/json`, `/docs/yaml`) on the API server. That server listens on
 * loopback behind the web host (PLAN-36), which forwards only the API prefixes,
 * so the docs never reach the client's port or another device: invisible to the
 * client by construction, with nothing to configure (decisions.md 2026-10-04).
 *
 * Core, not a module: no profile switches it and `/api/capabilities` does not
 * list it, and the UI reads the root instance's whole spec, which only core
 * sees. The plugin registers every route with `schema.hide`, so none of them
 * appears in the spec or the coverage test.
 */

export const DOCS_PREFIX = '/docs';

/**
 * Same-origin only. The plugin's default CSP allows `https:` fonts and styles,
 * images from `validator.swagger.io`, and `upgrade-insecure-requests`, which
 * would send this plain-http loopback page's requests to https. Everything the
 * page needs is bundled, so nothing outside `'self'` is allowed.
 */
export const DOCS_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  // Swagger UI injects a <style> element at runtime (found by the docs journey's
  // console guard). Inline styles cannot run code; scripts stay 'self' only.
  "style-src 'self' 'unsafe-inline'",
].join('; ');

export async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(swaggerUi, {
    routePrefix: DOCS_PREFIX,
    staticCSP: DOCS_CSP,
    uiConfig: {
      // Swagger UI's default draws a badge from validator.swagger.io on every
      // page load: an external request the docs must never make.
      validatorUrl: null,
      // `/docs#/runestone/listRunestones` opens that operation.
      deepLinking: true,
      // Every method is offered (the default); the spec's description opens
      // with the line saying requests act on the hub's real data.
      displayRequestDuration: true,
      tryItOutEnabled: false,
    },
  });
}
