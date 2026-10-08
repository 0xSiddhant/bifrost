import swagger from '@fastify/swagger';
import type { FastifyInstance, FastifySchema, RouteOptions } from 'fastify';

/**
 * OpenAPI registration and the route catalog (PLAN-32).
 *
 * `@fastify/swagger` is registered on the root **before** auth and every
 * module, so its `onRoute` collector sees routes in every encapsulated scope.
 * It registers no route of its own; `fastify.swagger()` builds the spec from
 * what it collected, and `npm run api:spec` commits that as
 * `server/openapi.json`. No docs page is served (a later plan, on its own
 * loopback port).
 *
 * The catalog beside it exists because a test cannot add an `onRoute` hook
 * after `createApp` has run: it records every route's method, URL template,
 * schema, and whether its `preHandler` is the admin guard — read at
 * registration time, so auth decorating `requireAdmin` after this runs is fine.
 */

export interface RouteCatalogEntry {
  method: string;
  url: string;
  schema: FastifySchema | undefined;
  /** The route is guarded by `app.requireAdmin`. */
  admin: boolean;
  /** Hidden from the spec (`schema.hide`; the static wildcard that needed it moved to the web host in PLAN-36). */
  hide: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    routeCatalog(): readonly RouteCatalogEntry[];
  }
}

export interface OpenApiInfo {
  version: string;
}

const DESCRIPTION = [
  'The HTTP API of a Bifrost LAN hub — the same one its web app and its `bifrost` CLI use.',
  '',
  'Two things to know when reading this description:',
  '',
  '- **Sibling path parameters.** Each document kind reads a record at `/api/<kind>/{slug}` and',
  '  writes it at `/api/<kind>/{id}`. OpenAPI treats those as one path with two parameter',
  '  names, which it forbids; renaming a route parameter is a code change made only for the',
  "  description's sake, so both appear as written and the merge is left to the API docs plan.",
  "- **Request validation follows Fastify's defaults.** Properties a request schema does not",
  '  declare are stripped rather than refused, and scalar values are coerced to the declared',
  '  type (`"7"` for an integer is accepted as `7`).',
].join('\n');

export async function registerOpenApi(app: FastifyInstance, info: OpenApiInfo): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Bifrost', version: info.version, description: DESCRIPTION },
      components: {
        securitySchemes: {
          adminSession: {
            type: 'apiKey',
            in: 'cookie',
            name: 'bifrost_admin',
            description: 'The Heimdall session cookie set by POST /api/heimdall/login',
          },
        },
      },
    },
  });

  const catalog: RouteCatalogEntry[] = [];
  app.addHook('onRoute', function collect(this: FastifyInstance, route: RouteOptions) {
    const guard = (this as Partial<FastifyInstance>).requireAdmin;
    const preHandlers = [route.preHandler].flat().filter(Boolean);
    for (const method of [route.method].flat()) {
      catalog.push({
        method: String(method),
        url: route.url,
        schema: route.schema,
        admin: guard !== undefined && preHandlers.includes(guard),
        hide: Boolean(route.schema && (route.schema as { hide?: boolean }).hide),
      });
    }
  });
  app.decorate('routeCatalog', () => catalog);
}
