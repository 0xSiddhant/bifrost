import fs from 'node:fs';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { fromRepoRoot } from '../../support/paths.js';

/**
 * `server/openapi.json`, read as a file the way a consumer would read it
 * (PLAN-33). Nothing here knows the server's source: operations, request
 * schemas and response schemas all come from the committed description.
 */

export type JsonSchema = Record<string, unknown>;

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema: JsonSchema;
}

export interface ResponseSpec {
  description?: string;
  content?: Record<string, { schema?: JsonSchema }>;
  headers?: Record<string, unknown>;
}

export interface Operation {
  method: string;
  /** The OpenAPI path template, `/api/v1/runestone/{slug}`. */
  template: string;
  operationId: string;
  tags: string[];
  /** Declares `security: adminSession`. */
  admin: boolean;
  parameters: Parameter[];
  /** The JSON request body schema, when the operation takes one. */
  body: { schema: JsonSchema; required: boolean } | null;
  responses: Record<string, ResponseSpec>;
}

interface RawOperation {
  operationId?: string;
  tags?: string[];
  security?: Record<string, unknown>[];
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
  responses?: Record<string, ResponseSpec>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function templateRegex(template: string): RegExp {
  const pattern = template
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${pattern}$`);
}

export class Spec {
  readonly operations: Operation[];
  private readonly matchers: { op: Operation; regex: RegExp; params: number }[];
  private readonly ajv = new Ajv2020({ strict: false, allErrors: false });
  private readonly validators = new Map<object, ValidateFunction>();

  constructor(document: { paths?: Record<string, Record<string, RawOperation>> }) {
    this.operations = [];
    for (const [template, item] of Object.entries(document.paths ?? {})) {
      for (const method of METHODS) {
        const raw = item[method];
        if (!raw) continue;
        const json = raw.requestBody?.content?.['application/json']?.schema;
        this.operations.push({
          method: method.toUpperCase(),
          template,
          operationId: raw.operationId ?? `${method} ${template}`,
          tags: raw.tags ?? [],
          admin: (raw.security ?? []).some((entry) => 'adminSession' in entry),
          parameters: raw.parameters ?? [],
          body: json ? { schema: json, required: raw.requestBody?.required ?? false } : null,
          responses: raw.responses ?? {},
        });
      }
    }
    // A literal segment beats a parameter: `/api/things/manage` is not `{id}`.
    this.matchers = this.operations
      .map((op) => ({
        op,
        regex: templateRegex(op.template),
        params: (op.template.match(/\{/g) ?? []).length,
      }))
      .sort((a, b) => a.params - b.params);
  }

  byId(operationId: string): Operation {
    const op = this.operations.find((candidate) => candidate.operationId === operationId);
    if (!op) throw new Error(`no operation ${operationId} in openapi.json`);
    return op;
  }

  /** The operation a concrete request hits; `HEAD` resolves to the `GET`. */
  find(method: string, pathname: string): Operation | undefined {
    const wanted = method === 'HEAD' ? 'GET' : method;
    return this.matchers.find((entry) => entry.op.method === wanted && entry.regex.test(pathname))
      ?.op;
  }

  /**
   * Why a response does not meet its operation's description, or null. The
   * status must be one the operation lists; a JSON body must validate against
   * that status's schema. HEAD carries no body to check.
   */
  check(
    op: Operation,
    method: string,
    status: number,
    contentType: string,
    body: string,
  ): string | null {
    const entry = op.responses[String(status)] ?? op.responses.default;
    if (!entry) {
      return `${status} is not declared (declared: ${Object.keys(op.responses).join(', ')})`;
    }
    const schema = entry.content?.['application/json']?.schema;
    if (!schema || method === 'HEAD') return null;
    if (!/^application\/json\b/.test(contentType)) {
      return `declared application/json, got ${contentType || 'no content-type'}`;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return 'declared application/json, body is not JSON';
    }
    let validate = this.validators.get(schema);
    if (!validate) {
      validate = this.ajv.compile(schema);
      this.validators.set(schema, validate);
    }
    if (validate(parsed)) return null;
    const [first] = validate.errors ?? [];
    return `body does not match the spec: ${first?.instancePath || '/'} ${first?.message ?? ''}`;
  }

  /** Statuses that count as "this operation worked": 2xx, or 3xx for one declaring no 2xx. */
  isSuccess(op: Operation, status: number): boolean {
    if (status >= 200 && status < 300) return true;
    const declaresTwoHundreds = Object.keys(op.responses).some((code) => code.startsWith('2'));
    return !declaresTwoHundreds && status >= 300 && status < 400;
  }
}

let cached: Spec | null = null;

export function loadSpec(): Spec {
  if (!cached) {
    cached = new Spec(JSON.parse(fs.readFileSync(fromRepoRoot('server/openapi.json'), 'utf8')));
  }
  return cached;
}
