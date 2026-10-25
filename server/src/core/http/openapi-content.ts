/**
 * What the API description says beyond the routes themselves (PLAN-38): its
 * opening text, one tag per module, the spec-only `/{key}` merge of the
 * document kinds' sibling paths, and examples for the shapes a reader cannot
 * guess. `openapi.ts` hands these to `@fastify/swagger`; no route changes.
 */

type Json = Record<string, unknown>;

export const DESCRIPTION = [
  '**"Try it out" sends real requests to this hub; writes change real data.** Every operation',
  "below is live: saved documents, uploads, go-links and settings are the household's own.",
  '',
  '- **Admin operations** (the padlock) need the Heimdall session cookie. Try',
  '  `POST /api/v1/heimdall/login` with `{"pin": "…"}` here first: it sets `bifrost_admin` on',
  '  this origin, and the admin operations then work from this page, as they do in the app.',
  '  `POST /api/v1/heimdall/logout` ends it.',
  '- **Every API is versioned in its path.** This describes v1: `/api/v1/…`, and each public',
  '  raw document at `/<kind>/api/v1/{slug}`. `/go/{slug}` and `/metrics` are not APIs and are',
  '  never versioned.',
  '- **The paths from before versions existed still mean v1.** `/api/<rest>` answers exactly as',
  '  `/api/v1/<rest>`, and `/<kind>/api/{slug}` as `/<kind>/api/v1/{slug}`: the same route, so the',
  '  same body, status, limits and guards. Their responses add `Deprecation: true` and a',
  '  `Link: <v1 path>; rel="successor-version"` header. They are listed here only once, as v1.',
  '- **Versioning policy.** v1 only ever grows: no operation is removed and no response field',
  '  disappears. A breaking change gets a new version for the affected module alone',
  '  (`/api/v2/<module>/…`), and its v1 keeps answering.',
  '- **One document path, two keys.** Each document kind reads a record by its slug and writes',
  '  or deletes it by its id, at the same path: `/api/v1/<kind>/{key}`. Each operation says',
  '  which one its `key` is.',
  "- **Request validation follows Fastify's defaults.** Properties a request schema does not",
  '  declare are stripped rather than refused, and scalar values are coerced to the declared',
  '  type (`"7"` for an integer is accepted as `7`).',
  '- **Errors** share one envelope, `{"error": "<CODE>", "message": "<why>"}`, under every 4xx.',
].join('\n');

/** One tag per module, in the order the app's module registry lists them. */
export const TAGS: { name: string; description: string }[] = [
  {
    name: 'core',
    description: 'What the hub offers (capabilities) and its live event stream (SSE)',
  },
  { name: 'health', description: 'Liveness: the API answers, and with which profile' },
  {
    name: 'file-transfer',
    description:
      'Uploads into a staging area (preview, rename, delete, publish) or straight into a ' +
      'download folder, and the read-only downloads listing, files and folder zips',
  },
  { name: 'previews', description: 'Preview metadata for a staged upload or a download' },
  {
    name: 'qr-tool',
    description: "The addresses a device can join the hub at (the Join card's QR)",
  },
  {
    name: 'heimdall',
    description:
      'The admin panel: PIN login and session, household settings, stats, uploads, About and ' +
      'the changelog',
  },
  { name: 'clipboard', description: 'The shared clipboard (Hermes): text that every device sees' },
  { name: 'presence', description: 'Connected devices (Wardens): the live list and names' },
  { name: 'audit-log', description: 'The activity history (admin)' },
  { name: 'runestone', description: "Saved JSON documents, and each one's public raw URL" },
  { name: 'edda', description: "Saved Markdown documents, and each one's public raw URL" },
  { name: 'groot', description: 'Saved YAML documents, stored as text, never parsed by the hub' },
  { name: 'atlas', description: 'Saved XML documents, stored as text, never parsed by the hub' },
  {
    name: 'loki',
    description: "The JS workbench's policy: the run and fetch gates (admin to change)",
  },
  { name: 'brotli', description: 'Brotli compress and decompress, streamed, with two size caps' },
  { name: 'accio', description: 'The read-later shelf, with best-effort title lookup' },
  {
    name: 'nimbus',
    description: 'The LAN speed test: ping, download stream, upload sink, results',
  },
  { name: 'portkey', description: 'LAN go-links: a memorable slug that redirects (`/go/{slug}`)' },
  { name: 'screensaver', description: "The idle overlay's settings (admin to change)" },
  { name: 'client-logs', description: "Browser error reports relayed into the hub's log" },
  { name: 'metrics', description: "Prometheus exposition of the hub's runtime metrics" },
  {
    name: 'offline-mode',
    description: 'Which pure-client pages the Offline switch warm-loads (admin to change)',
  },
];

const DOCUMENT_PATH = /^\/api\/v1\/(runestone|edda|groot|atlas)\/:(slug|id)$/;

const KEY_DESCRIPTION: Record<string, string> = {
  slug: "The document's slug (`<kebab-name>-<id>`); a renamed document's old slug redirects",
  id: "The document's id, the stable suffix of its slug",
};

/**
 * `@fastify/swagger`'s `transform`: the document kinds read at `/:slug` and
 * write at `/:id`, which OpenAPI reads as one path with two parameter names
 * (forbidden). In the spec only, both become `/{key}`, each operation keeping
 * its own constraints and saying which key it takes. The routes are untouched,
 * and a parameter's name never reaches the wire. Returns a copy.
 */
export function mergeDocumentKeys(input: { schema: unknown; url: string }): {
  schema: unknown;
  url: string;
} {
  const match = DOCUMENT_PATH.exec(input.url);
  const schema = input.schema as Json | undefined;
  const params = schema?.params as Json | undefined;
  const properties = params?.properties as Record<string, Json> | undefined;
  if (!match || !schema || !params || !properties) return input;
  const name = match[2] as 'slug' | 'id';
  const original = properties[name];
  if (!original) return input;
  return {
    url: input.url.replace(`:${name}`, ':key'),
    schema: {
      ...schema,
      params: {
        ...params,
        properties: { key: { ...original, description: KEY_DESCRIPTION[name] } },
        required: ['key'],
      },
    },
  };
}

const ERROR_EXAMPLES: Record<string, { error: string; message: string }> = {
  400: { error: 'BAD_REQUEST', message: "body must have required property 'content'" },
  401: { error: 'UNAUTHORIZED', message: 'admin session required' },
  404: { error: 'NOT_FOUND', message: 'not found' },
  409: { error: 'CONFLICT', message: 'that name is taken' },
  413: { error: 'PAYLOAD_TOO_LARGE', message: 'request body is too large' },
  422: { error: 'UNPROCESSABLE_ENTITY', message: 'the value could not be accepted' },
};

const RAW_EXAMPLES: Record<string, unknown> = {
  'application/json': { name: 'bifrost', replicas: 2 },
  'text/markdown': '# Trip notes\n\n- Pack the charger\n',
  'application/yaml': 'kind: Deployment\nspec:\n  replicas: 2\n',
  'application/xml':
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>name</key>\n\t<string>bifrost</string>\n</dict>\n</plist>\n',
};

/** A plausible value for a property, by its name and type. */
function sample(name: string, schema: Json): unknown {
  const types = [schema.type].flat().filter((type) => type !== 'null');
  const type = types[0];
  if (type === 'array') {
    const items = schema.items as Json | undefined;
    return items ? [sample(name.replace(/s$/, ''), items)] : [];
  }
  if (type === 'object') {
    const out: Json = {};
    for (const [key, value] of Object.entries((schema.properties ?? {}) as Record<string, Json>)) {
      out[key] = sample(key, value);
    }
    return out;
  }
  if (type === 'integer' || type === 'number') {
    const numbers: Record<string, number> = { total: 42, limit: 20, offset: 0, sizeBytes: 1234 };
    return numbers[name] ?? 1;
  }
  if (type === 'boolean') return false;
  const strings: Record<string, string> = {
    id: 'a1b2c3d4e5f6a7b8',
    slug: 'trip-notes-a1b2c3d4e5f6a7b8',
    name: 'Trip notes',
    title: 'A page worth reading',
    url: 'http://nas.local:5000/',
    authorDeviceId: 'mac-studio',
    nextCursor: 'eyJ0IjoxNzYwMDAwMDAwMDAwfQ',
    createdAt: '2026-10-09T08:00:00.000Z',
    modifiedAt: '2026-10-09T08:05:00.000Z',
    tag: 'recipes',
    author: 'mac-studio',
  };
  return strings[name] ?? 'string';
}

/**
 * `@fastify/swagger`'s `transformObject`: `security: []` on every public
 * operation, and examples for what a reader cannot guess from a schema alone. The error envelope under each 4xx, one page of
 * each paged listing (the envelope `paged=true` opts into), and the raw
 * document endpoints. The strict lint validates every example against its
 * schema.
 */
export function addExamples(spec: Json): Json {
  for (const [path, item] of Object.entries((spec.paths ?? {}) as Record<string, Json>)) {
    const raw = /^\/[a-z]+\/api\/v1\/\{slug\}$/.test(path);
    for (const operation of Object.values(item) as Json[]) {
      // Public, said explicitly: an operation without `security` would read as
      // "unspecified" (the admin ones name `adminSession`).
      operation.security ??= [];
      const responses = (operation.responses ?? {}) as Record<string, Json>;
      const parameters = (operation.parameters ?? []) as Json[];
      const paged = parameters.some((parameter) => parameter.name === 'paged');
      for (const [status, response] of Object.entries(responses)) {
        const content = response.content as Record<string, Json> | undefined;
        if (!content) continue;
        const json = content['application/json'];
        const error = ERROR_EXAMPLES[status];
        if (error && json) json.example = error;
        if (status === '200' && paged && json) {
          const envelope = ((json.schema as Json).anyOf as Json[] | undefined)?.find(
            (option) => option.type === 'object',
          );
          if (envelope) {
            json.examples = {
              paged: { summary: 'With paged=true: one page', value: sample('page', envelope) },
            };
          }
        }
        if (status === '200' && raw) {
          for (const [type, media] of Object.entries(content)) {
            if (type in RAW_EXAMPLES) media.example = RAW_EXAMPLES[type];
          }
        }
      }
    }
  }
  return spec;
}
