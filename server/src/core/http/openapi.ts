import swagger from '@fastify/swagger';
import type { FastifyInstance, FastifySchema, RouteOptions } from 'fastify';
import { addExamples, DESCRIPTION, mergeDocumentKeys, TAGS } from './openapi-content.js';

/**
 * OpenAPI registration and the route catalog (PLAN-32).
 *
 * `@fastify/swagger` is registered on the root **before** auth and every
 * module, so its `onRoute` collector sees routes in every encapsulated scope.
 * It registers no route of its own; `fastify.swagger()` builds the spec from
 * what it collected, and `npm run api:spec` commits that as
 * `server/openapi.json`. Its text, tags, the `/{key}` merge and the examples
 * live in `openapi-content.ts`; `docs.ts` serves it as Swagger UI (PLAN-38).
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

export async function registerOpenApi(app: FastifyInstance, info: OpenApiInfo): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Bifrost',
        version: info.version,
        description: DESCRIPTION,
        license: { name: 'MIT', identifier: 'MIT' },
      },
      // This hub: the docs page and the CLI both call the origin they were reached on.
      servers: [{ url: '/', description: 'This hub' }],
      tags: TAGS,
      components: {
        securitySchemes: {
          adminSession: {
            type: 'apiKey',
            in: 'cookie',
            name: 'bifrost_admin',
            description: 'The Heimdall session cookie set by POST /api/v1/heimdall/login',
          },
        },
      },
    },
    transform: ({ schema, url }) =>
      mergeDocumentKeys({ schema, url }) as { schema: FastifySchema; url: string },
    transformObject: (document) =>
      addExamples(
        ('openapiObject' in document ? document.openapiObject : {}) as Record<string, unknown>,
      ),
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
