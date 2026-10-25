import { Ajv, type Options, type ValidateFunction } from 'ajv';
import type { JsonSchema, Operation } from '../support/spec.js';

/**
 * The fuzzer's oracle (PLAN-33): whether **Fastify** will accept a request,
 * which is not the same as whether the schema, read literally, accepts it.
 * Fastify validates with ajv under these defaults (`@fastify/ajv-compiler`),
 * so an unknown property under `additionalProperties: false` is stripped,
 * `123` for a string becomes `"123"`, `"7"` for an integer becomes `7`, and
 * only an uncoercible value is a 400. `fastify-ajv.test.ts` checks this
 * oracle against a bare Fastify instance, so an upgrade that changes the
 * defaults fails there, loudly, instead of quietly skewing the fuzzer.
 */
export const FASTIFY_AJV_OPTIONS: Options = {
  coerceTypes: 'array',
  useDefaults: true,
  removeAdditional: true,
  addUsedSchema: false,
  allErrors: false,
  // OpenAPI annotations (description, …) are not validation keywords.
  strict: false,
};

/** A request as the server receives it: params and query are strings on the wire. */
export interface WireRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  /** The parsed JSON body, or undefined when none is sent. */
  body?: unknown;
}

export interface Verdict {
  accepted: boolean;
  /** Which part was refused, for a failure message. */
  refused?: 'params' | 'query' | 'body';
}

function objectOf(operation: Operation, where: 'path' | 'query'): JsonSchema | null {
  const parameters = operation.parameters.filter((parameter) => parameter.in === where);
  if (parameters.length === 0) return null;
  return {
    type: 'object',
    properties: Object.fromEntries(
      parameters.map((parameter) => [parameter.name, parameter.schema]),
    ),
    required: parameters
      .filter((parameter) => parameter.required)
      .map((parameter) => parameter.name),
  };
}

export class FastifyOracle {
  private readonly ajv = new Ajv(FASTIFY_AJV_OPTIONS);
  private readonly cache = new Map<string, ValidateFunction | null>();

  private validator(
    operation: Operation,
    part: 'params' | 'query' | 'body',
  ): ValidateFunction | null {
    const key = `${operation.operationId}:${part}`;
    if (!this.cache.has(key)) {
      const schema =
        part === 'body'
          ? (operation.body?.schema ?? null)
          : objectOf(operation, part === 'params' ? 'path' : 'query');
      // Compile a deep copy: ajv keeps references, and the spec is shared.
      this.cache.set(key, schema ? this.ajv.compile(structuredClone(schema)) : null);
    }
    return this.cache.get(key) ?? null;
  }

  /** What Fastify will make of this request. Mutates nothing the caller keeps. */
  judge(operation: Operation, request: WireRequest): Verdict {
    // Fastify's order: params, body, querystring.
    const parts: ['params' | 'query' | 'body', unknown][] = [
      ['params', { ...request.params }],
      ['body', structuredClone(request.body)],
      ['query', { ...request.query }],
    ];
    for (const [part, value] of parts) {
      const validate = this.validator(operation, part);
      if (!validate) continue;
      if (part === 'body' && value === undefined) {
        if (operation.body?.required) return { accepted: false, refused: 'body' };
        continue;
      }
      if (!validate(value)) return { accepted: false, refused: part };
    }
    return { accepted: true };
  }
}
