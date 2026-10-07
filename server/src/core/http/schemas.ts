/**
 * Response-schema building blocks shared by every module (PLAN-32).
 *
 * ⚠️ A response schema is not documentation: Fastify compiles it into the
 * serializer, which writes only what the schema declares, coerced to the
 * declared type. A forgotten field is dropped, a `null` under `string` becomes
 * `""`, and a bare `object` arrives empty — silently. So:
 *   - nullable fields are type arrays (`['string', 'null']`);
 *   - free-form objects say `additionalProperties: true`;
 *   - properties are listed in the order the handler builds them, because the
 *     serializer writes them in schema order and the contract guard requires
 *     byte-identical output.
 * The guard (contract.ts) and the API diff hold every schema to that.
 */

/** The one error envelope `core/http`'s error handler sends: `{ error, message, details? }`. */
export const errorResponseSchema = {
  type: 'object',
  required: ['error', 'message'],
  properties: {
    error: { type: 'string', description: 'Machine-readable code, e.g. NOT_FOUND' },
    message: { type: 'string' },
    // Free-form extras a client can act on (a rename's suggested clean name).
    details: { type: 'object', additionalProperties: true },
  },
} as const;

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'The request failed validation',
  401: 'No admin session, or it was revoked',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflicts with something that already exists',
  413: 'Over the size limit',
  415: 'Unsupported media type',
  416: 'The requested byte range is outside the file',
  422: 'Well-formed but refused',
  429: 'Rate limited',
};

/** `errorResponses(400, 404)` → the shared envelope under each status, with a description. */
export function errorResponses<const C extends number>(...codes: C[]) {
  return Object.fromEntries(
    codes.map((code) => [
      code,
      { description: ERROR_DESCRIPTIONS[code] ?? 'Error', ...errorResponseSchema },
    ]),
  ) as Record<C, typeof errorResponseSchema & { description: string }>;
}

/** A body-less answer (`reply.code(204).send()`); swagger renders it with no content. */
export const noContent = { description: 'No content', type: 'null' } as const;

/** A redirect: no body worth describing, the target in `Location`. */
export function redirect(description: string) {
  return {
    description,
    type: 'null',
    headers: { location: { type: 'string', description: 'Where the resource now lives' } },
  } as const;
}

/**
 * A body sent as a string or stream (raw document text, an archive): no
 * serializer runs, so the schema only names the media type for the spec.
 */
export function rawBody(mediaType: string, description: string, headers?: Record<string, object>) {
  return {
    description,
    content: { [mediaType]: { schema: { type: 'string' } } },
    ...(headers ? { headers } : {}),
  };
}

/** The wide-open CORS header the public raw-document endpoints send. */
export const corsHeader = {
  'access-control-allow-origin': { type: 'string', description: 'Always `*`' },
} as const;

/** `security` for a route behind `app.requireAdmin`: the Heimdall session cookie. */
export const adminSecurity = [{ adminSession: [] }];
