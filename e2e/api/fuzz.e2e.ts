import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { startTitleSink, type TitleSink } from '../support/sink.js';
import { hasLoneSurrogate, mutations, valid, type Mutation } from './fuzz/arbitraries.js';
import { FastifyOracle, type WireRequest } from './fuzz/fastify-ajv.js';
import { EXCLUDED, hintsFor, type Hint } from './fuzz/hints.js';
import type { Client } from './support/http.js';
import { seedAll, type Seeds } from './support/seed.js';
import { loadSpec, type JsonSchema, type Operation } from './support/spec.js';
import { apiSuite, closingChecks } from './support/suite.js';

/**
 * Schema-driven fuzzing (PLAN-33). For every operation in openapi.json:
 *
 * - **valid requests** never see a 5xx, always get a status the operation
 *   declares, and every body validates (the server runs the contract guard
 *   strict, so a byte-level slip is a 500 here);
 * - **invalid requests** — one mutation each — get a declared 4xx when
 *   Fastify's own validator refuses them, and are held to the valid rules
 *   when it coerces them into shape (the oracle decides which).
 *
 * Seeded and replayable: `FUZZ_SEED=… FUZZ_OP=… FUZZ_PATH=…`, printed on any
 * failure. Depth is `FUZZ_RUNS` (default 40 per property).
 */

const RUNS = Number(process.env.FUZZ_RUNS ?? 40);
const BASE_SEED = Number(process.env.FUZZ_SEED ?? Math.floor(Math.random() * 2 ** 31));

const suite = apiSuite('fuzz', {
  env: {
    // Rate limits are the security suite's subject; here they would only stop the fuzzer.
    UPLOAD_RATE_LIMIT_PER_MIN: '1000000',
    BROTLI_RATE_LIMIT_PER_MIN: '1000000',
    CLIENT_LOG_RATE_LIMIT_PER_MIN: '1000000',
  },
});
const oracle = new FastifyOracle();
let sink: TitleSink;
let seeds: Seeds;
let client: Client;
let hints: Record<string, Hint>;

/** A stable per-property seed, so one operation replays without the rest. */
function seedFor(name: string): number {
  let hash = BASE_SEED;
  for (const char of name) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function objectOf(op: Operation, where: 'path' | 'query'): JsonSchema {
  const parameters = op.parameters.filter((parameter) => parameter.in === where);
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

interface Generated {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
}

/**
 * Valid requests. With `everyKey`, every query parameter is present — the
 * invalid property's starting point, so a query-only operation always has
 * something to mutate.
 */
function generator(op: Operation, hint: Hint, everyKey = false): fc.Arbitrary<Generated> {
  const params = objectOf(op, 'path');
  const query = objectOf(op, 'query');
  const record = (schema: JsonSchema, overrides: Record<string, fc.Arbitrary<unknown>> = {}) => {
    const properties = schema.properties as Record<string, JsonSchema>;
    return fc.record(
      Object.fromEntries(
        Object.entries(properties).map(([name, inner]) => [
          name,
          overrides[name] ?? valid(inner, 'url'),
        ]),
      ),
      { requiredKeys: everyKey ? Object.keys(properties) : (schema.required as string[]) },
    );
  };
  let body: fc.Arbitrary<unknown> = fc.constant(undefined);
  if (op.body) {
    const schema = op.body.schema;
    body = hint.body
      ? (valid(schema) as fc.Arbitrary<Record<string, unknown>>).chain((value) =>
          fc
            .record(hint.body as Record<string, fc.Arbitrary<unknown>>)
            .map((overrides) => ({ ...value, ...overrides })),
        )
      : valid(schema);
  }
  return fc.record({ params: record(params, hint.params), query: record(query, hint.query), body });
}

/** One mutation of the request, in params (never dropping one: that is another route), query or body. */
function mutationsOf(
  op: Operation,
  request: Generated,
): { label: string; apply: (r: Generated) => Generated }[] {
  const out: { label: string; apply: (r: Generated) => Generated }[] = [];
  const lift = (part: keyof Generated, list: Mutation[]) =>
    list.map((mutation) => ({
      label: `${part}: ${mutation.label}`,
      apply: (r: Generated) => ({ ...r, [part]: mutation.apply(r[part]) }),
    }));
  const isRoot = (mutation: Mutation) => mutation.label.endsWith(' at /');
  out.push(
    ...lift(
      'params',
      mutations(objectOf(op, 'path'), request.params).filter(
        (mutation) => !isRoot(mutation) && !mutation.label.startsWith('dropped'),
      ),
    ),
    ...lift(
      'query',
      mutations(objectOf(op, 'query'), request.query).filter((mutation) => !isRoot(mutation)),
    ),
  );
  if (op.body) out.push(...lift('body', mutations(op.body.schema, request.body)));
  return out;
}

const onWire = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

function toWire(request: Generated): WireRequest {
  return {
    params: Object.fromEntries(
      Object.entries(request.params).map(([key, value]) => [key, onWire(value)]),
    ),
    query: Object.fromEntries(
      Object.entries(request.query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, onWire(value)]),
    ),
    body: request.body,
  };
}

async function send(
  op: Operation,
  wire: WireRequest,
  raw: { body: Buffer | FormData; contentType?: string } | null,
) {
  const path = op.template.replace(/\{(\w+)\}/g, (_m, name: string) =>
    encodeURIComponent(wire.params[name] ?? ''),
  );
  const search = new URLSearchParams(wire.query).toString();
  const url = `${path}${search ? `?${search}` : ''}`;
  if (raw) {
    return client.request(op.method, url, {
      body: raw.body,
      headers: raw.contentType ? { 'content-type': raw.contentType } : {},
    });
  }
  return client.request(op.method, url, wire.body === undefined ? {} : { json: wire.body });
}

/** Run one property; on failure, say exactly how to replay it. */
async function check<Ts extends [unknown, ...unknown[]]>(
  name: string,
  property: fc.IAsyncProperty<Ts>,
): Promise<void> {
  const replaying = process.env.FUZZ_OP === name;
  const details = await fc.check(property, {
    numRuns: RUNS,
    seed: seedFor(name),
    ...(replaying && process.env.FUZZ_PATH ? { path: process.env.FUZZ_PATH } : {}),
    endOnFailure: false,
  });
  if (details.failed) {
    const cause =
      details.errorInstance instanceof Error
        ? details.errorInstance.message
        : String(details.errorInstance ?? '');
    throw new Error(
      `${fc.defaultReportMessage(details) ?? 'property failed'}\n\ncause: ${cause}\n\nreplay: FUZZ_SEED=${BASE_SEED} FUZZ_OP='${name}' FUZZ_PATH='${details.counterexamplePath}' npm run test:e2e:api -w e2e -- fuzz -t '${name}'`,
    );
  }
}

const operations = loadSpec().operations.filter((op) => !(op.operationId in EXCLUDED));

describe(`fuzz (FUZZ_SEED=${BASE_SEED}, FUZZ_RUNS=${RUNS})`, () => {
  beforeAll(async () => {
    sink = await startTitleSink();
    const seeding = suite.client('e2e-fuzz-seed');
    seeds = await seedAll(seeding, sink.baseUrl);
    client = await suite.client('e2e-fuzz').login(suite.server.pin);
    hints = hintsFor({ sinkBaseUrl: sink.baseUrl, seeds });
  });

  it('fuzzes every operation not excluded, and excludes only with a reason', () => {
    expect(operations.length + Object.keys(EXCLUDED).length).toBe(loadSpec().operations.length);
    for (const id of Object.keys(EXCLUDED)) expect(() => loadSpec().byId(id)).not.toThrow();
  });

  for (const op of operations) {
    it(`${op.operationId}: valid`, async () => {
      const hint = hints[op.operationId] ?? {};
      const raw = hint.raw ?? fc.constant(null);
      await check(
        `${op.operationId}: valid`,
        fc.asyncProperty(fc.tuple(generator(op, hint), raw), async ([request, body]) => {
          const wire = toWire(request);
          fc.pre(
            Object.values(wire.params).every((value) => value !== '' && !hasLoneSurrogate(value)),
          );
          const before = suite.recorder.problems.length;
          const response = await send(op, wire, body);
          expect(response.status, response.text.slice(0, 300)).toBeLessThan(500);
          expect(Object.keys(op.responses), `status ${response.status}`).toContain(
            String(response.status),
          );
          expect(suite.recorder.problems.slice(before)).toEqual([]);
        }),
      );
    });

    // Nothing to mutate: no parameter and no JSON body (a raw body is the hint's).
    if (op.parameters.length === 0 && !op.body) continue;

    it(`${op.operationId}: invalid`, async () => {
      const hint = hints[op.operationId] ?? {};
      const raw = hint.raw ?? fc.constant(null);
      const mutated = fc.tuple(generator(op, hint, true), raw).chain(([request, body]) => {
        const options = mutationsOf(op, request);
        return options.length === 0
          ? fc.constant(null)
          : fc
              .constantFrom(...options)
              .map((mutation) => ({ mutation, request: mutation.apply(request), body }));
      });
      await check(
        `${op.operationId}: invalid`,
        fc.asyncProperty(mutated, async (sample) => {
          fc.pre(sample !== null);
          if (!sample) return;
          const wire = toWire(sample.request);
          fc.pre(
            Object.values(wire.params).every((value) => value !== '' && !hasLoneSurrogate(value)),
          );
          const verdict = oracle.judge(op, wire);
          const before = suite.recorder.problems.length;
          const response = await send(op, wire, sample.body);
          const why = `${sample.mutation.label} (oracle: ${verdict.accepted ? 'coerced, accepted' : `refused in ${verdict.refused}`}) → ${response.status} ${response.text.slice(0, 200)}`;
          expect(response.status, why).toBeLessThan(500);
          expect(Object.keys(op.responses), why).toContain(String(response.status));
          if (!verdict.accepted) {
            expect(response.status, why).toBeGreaterThanOrEqual(400);
            if (response.status === 400)
              expect(response.json<{ error: string }>().error, why).toBe('BAD_REQUEST');
          }
          expect(suite.recorder.problems.slice(before)).toEqual([]);
        }),
      );
    });
  }

  it('closes the title sink', async () => {
    await sink.close();
  });
});

closingChecks(suite);
