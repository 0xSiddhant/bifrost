import { Ajv, type ValidateFunction } from 'ajv';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ContractCheckMode } from '../config/index.js';
import type { Logger } from '../logger/index.js';

/**
 * The response contract guard (PLAN-32).
 *
 * A response schema rewrites the bytes it serializes: an undeclared field is
 * dropped, `null` under `string` becomes `""`, a bare `object` is emptied,
 * `5` under `string` becomes `"5"`. None of that fails anything — the client
 * just gets less. So every JSON response is held to the bytes the handler
 * would have sent without a schema, `JSON.stringify(payload)`:
 *
 * - **strict** (every server test, every e2e server, the API diff's
 *   candidate): the serialized body must be byte-identical to that, the
 *   payload must validate against a *strictified* schema (no undeclared
 *   properties), and the status must be one the route declares (5xx and HEAD
 *   exempt). Any violation becomes `500 CONTRACT_VIOLATION`, naming why.
 * - **fallback** (production until a release has run clean): on a byte
 *   mismatch the *recorded* bytes are sent instead, and `contract mismatch` is
 *   logged with the route, status and the JSON pointer of the first differing
 *   value — never the values, which may be a user's document. No ajv runs.
 * - **off**: no hooks at all.
 *
 * Only routes that declare response schemas are checked; a string, Buffer or
 * stream payload never reaches the serializer and is checked for its status
 * alone.
 */

interface Recorded {
  /** `JSON.stringify(payload)` — what this response would be with no schema. */
  bytes: string | undefined;
  /** A strict-mode problem found before serialization (validation). */
  violation: string | null;
}

type SchemaObject = Record<string, unknown>;

const recorded = new WeakMap<FastifyRequest, Recorded>();

/** The route's response schema entry for this status: exact, then `4xx`-style, then `default`. */
export function responseEntryFor(
  responses: Record<string, unknown> | undefined,
  status: number,
): SchemaObject | undefined {
  if (!responses) return undefined;
  const entry =
    responses[String(status)] ?? responses[`${Math.floor(status / 100)}xx`] ?? responses.default;
  return entry && typeof entry === 'object' ? (entry as SchemaObject) : undefined;
}

/** The JSON body schema inside a response entry (content-keyed entries included), if any. */
export function jsonSchemaOf(entry: SchemaObject | undefined): SchemaObject | undefined {
  if (!entry) return undefined;
  const content = entry.content as Record<string, { schema?: SchemaObject }> | undefined;
  if (content) return content['application/json']?.schema;
  return entry;
}

/**
 * A copy of `schema` in which every object that declares `properties` and says
 * nothing about `additionalProperties` refuses extras. The serializer would
 * silently drop an undeclared field; validation is where it becomes an error.
 */
export function strictify(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictify);
  if (!schema || typeof schema !== 'object') return schema;
  const source = schema as SchemaObject;
  const out: SchemaObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as SchemaObject).map(([name, inner]) => [name, strictify(inner)]),
      );
    } else if (['items', 'anyOf', 'oneOf', 'allOf', 'not', 'additionalProperties'].includes(key)) {
      out[key] = strictify(value);
    } else {
      out[key] = value;
    }
  }
  if (source.properties && !('additionalProperties' in source)) out.additionalProperties = false;
  return out;
}

/**
 * Where two JSON texts first differ, as a JSON pointer. Key order counts —
 * `{a,b}` and `{b,a}` are different bytes — and is reported at the object
 * itself. Never returns the values, only the path.
 */
export function firstDifference(before: string | undefined, after: string): string {
  if (before === undefined) return '(no recorded body)';
  let left: unknown;
  let right: unknown;
  try {
    left = JSON.parse(before);
    right = JSON.parse(after);
  } catch {
    return '(not JSON)';
  }
  return pointerOfDifference(left, right, '') ?? '(same values; formatting differs)';
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerOfDifference(left: unknown, right: unknown, at: string): string | null {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return at || '/';
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      if (index >= left.length || index >= right.length) return `${at}/${index}`;
      const inner = pointerOfDifference(left[index], right[index], `${at}/${index}`);
      if (inner) return inner;
    }
    return null;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    for (let index = 0; index < Math.max(leftKeys.length, rightKeys.length); index += 1) {
      const key = leftKeys[index];
      if (key === undefined || key !== rightKeys[index]) {
        const name = key ?? rightKeys[index] ?? '';
        return `${at}/${escapePointer(name)}${rightKeys.includes(name) && leftKeys.includes(name) ? ' (key order)' : ''}`;
      }
      const inner = pointerOfDifference(
        (left as SchemaObject)[key],
        (right as SchemaObject)[key],
        `${at}/${escapePointer(key)}`,
      );
      if (inner) return inner;
    }
    return null;
  }
  return Object.is(left, right) ? null : at || '/';
}

function routeLabel(request: FastifyRequest, reply: FastifyReply): string {
  return `${request.method} ${request.routeOptions.url ?? request.url} → ${reply.statusCode}`;
}

export function registerContractCheck(app: FastifyInstance, mode: ContractCheckMode, log: Logger): void {
  if (mode === 'off') return;
  const strict = mode === 'strict';
  // The same ajv the request side uses (8.x), with the same tolerance for the
  // OpenAPI-only keywords (description, example, …) a response entry carries.
  const ajv = new Ajv({ strict: false, allErrors: false });
  const validators = new WeakMap<object, ValidateFunction>();
  const validatorFor = (schema: SchemaObject): ValidateFunction => {
    let validate = validators.get(schema);
    if (!validate) {
      validate = ajv.compile(strictify(schema) as SchemaObject);
      validators.set(schema, validate);
    }
    return validate;
  };

  app.addHook('preSerialization', (request, reply, payload, done) => {
    const responses = request.routeOptions.schema?.response as Record<string, unknown> | undefined;
    if (!responses) {
      done(null, payload);
      return;
    }
    const bytes = JSON.stringify(payload);
    let violation: string | null = null;
    if (strict) {
      const schema = jsonSchemaOf(responseEntryFor(responses, reply.statusCode));
      if (schema && bytes !== undefined) {
        // The parse of the bytes, not the object: a Date or a toJSON() would
        // pass as an object and still reach the client as a string.
        const validate = validatorFor(schema);
        if (!validate(JSON.parse(bytes))) {
          const [first] = validate.errors ?? [];
          violation = `does not match its schema: ${first?.instancePath || '/'} ${first?.message ?? ''}${
            first?.params && 'additionalProperty' in first.params
              ? ` (${String(first.params.additionalProperty)})`
              : ''
          }`;
        }
      }
    }
    recorded.set(request, { bytes, violation });
    done(null, payload);
  });

  app.addHook('onSend', (request, reply, payload, done) => {
    const responses = request.routeOptions.schema?.response as Record<string, unknown> | undefined;
    if (!responses) {
      done(null, payload);
      return;
    }
    const state = recorded.get(request);
    recorded.delete(request);

    let violation = state?.violation ?? null;
    if (
      strict &&
      !violation &&
      reply.statusCode < 500 &&
      request.method !== 'HEAD' &&
      !responseEntryFor(responses, reply.statusCode)
    ) {
      violation = `status ${reply.statusCode} is not declared by the route`;
    }

    const serialized = typeof payload === 'string' ? payload : undefined;
    const mismatch = state !== undefined && serialized !== undefined && serialized !== state.bytes;

    if (strict) {
      if (!violation && mismatch) {
        violation = `the schema changed the bytes, first at ${firstDifference(state.bytes, serialized)}`;
      }
      if (violation) {
        const message = `contract violation: ${routeLabel(request, reply)} ${violation}`;
        log.error({ route: request.routeOptions.url, status: reply.statusCode }, message);
        reply.code(500).type('application/json; charset=utf-8');
        done(null, JSON.stringify({ error: 'CONTRACT_VIOLATION', message }));
        return;
      }
      done(null, payload);
      return;
    }

    if (mismatch) {
      // The client gets exactly what it got before schemas existed; the
      // archive gets where they diverged — never the values themselves.
      log.warn(
        {
          route: request.routeOptions.url,
          method: request.method,
          status: reply.statusCode,
          pointer: firstDifference(state.bytes, serialized),
        },
        'contract mismatch',
      );
      done(null, state.bytes);
      return;
    }
    done(null, payload);
  });
}
