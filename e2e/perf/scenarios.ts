import autocannon from 'autocannon';
import type { ScenarioResult } from './report.js';
import { DOCUMENT_KINDS, documentOf, type Seeded } from './seed.js';

/**
 * What a load profile sends (PLAN-34). A scenario is a fixed sequence of
 * requests each connection cycles through; a write is a create → update →
 * delete triple, so a long run leaves the database the size it found it and
 * soak memory reflects the server, not a growing table.
 *
 * Every request names the statuses it expects. A response outside them is
 * counted as `unexpected` and fails the run: a scenario that has silently
 * become a stream of 404s is measuring nothing.
 */

type Context = Record<string, unknown>;

export interface Step {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: (context: Context) => string;
  body?: (context: Context) => unknown;
  expect: number[];
  /** Read what a create returned, for the update and delete that follow. */
  capture?: (body: string, context: Context) => void;
}

export interface Scenario {
  name: string;
  steps: Step[];
}

let counter = 0;
const RUN = Date.now().toString(36);
/** Unique within a run and across runs, so writes never collide on a 409. */
export const unique = (prefix: string) => `${prefix}-${RUN}-${(counter++).toString(36)}`;

const pick = (items: string[]): string => {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('nothing was seeded to pick from');
  return item;
};
const get = (path: string, expect = [200]): Step => ({ method: 'GET', path: () => path, expect });
const getOne = (paths: () => string, expect = [200]): Step => ({
  method: 'GET',
  path: paths,
  expect,
});

export function readScenarios(seeds: Seeded): Scenario[] {
  const reads: Scenario[] = [
    { name: 'read: health', steps: [get('/api/v1/health')] },
    { name: 'read: capabilities', steps: [get('/api/v1/capabilities')] },
  ];
  for (const kind of DOCUMENT_KINDS) {
    const slugs = seeds.slugs[kind];
    reads.push(
      { name: `read: ${kind} list (legacy)`, steps: [get(`/api/v1/${kind}`)] },
      { name: `read: ${kind} list (paged)`, steps: [get(`/api/v1/${kind}?paged=true`)] },
      { name: `read: ${kind} by slug`, steps: [getOne(() => `/api/v1/${kind}/${pick(slugs)}`)] },
      { name: `read: ${kind} raw`, steps: [getOne(() => `/${kind}/api/v1/${pick(slugs)}`)] },
    );
  }
  reads.push(
    { name: 'read: accio list (paged)', steps: [get('/api/v1/accio?paged=true')] },
    { name: 'read: portkey list (paged)', steps: [get('/api/v1/portkey?paged=true')] },
    // Not followed: the redirect is the response. Each one also counts a hit.
    {
      name: 'read: go-link redirect',
      steps: [getOne(() => `/go/${pick(seeds.portkeySlugs)}`, [302])],
    },
  );
  return reads;
}

const captureId = (body: string, context: Context) => {
  context.id = (JSON.parse(body) as { id?: string }).id;
};

export function documentWrite(): Step[] {
  return [
    {
      method: 'POST',
      path: () => '/api/v1/runestone',
      body: () => ({ name: unique('load-write'), content: documentOf('runestone', 2048, counter) }),
      expect: [201],
      capture: captureId,
    },
    {
      method: 'PUT',
      path: (context) => `/api/v1/runestone/${String(context.id)}`,
      body: () => ({ content: documentOf('runestone', 2048, counter + 1) }),
      expect: [200],
    },
    {
      method: 'DELETE',
      path: (context) => `/api/v1/runestone/${String(context.id)}`,
      expect: [204],
    },
  ];
}

export function accioWrite(): Step[] {
  return [
    {
      method: 'POST',
      path: () => '/api/v1/accio',
      // Titled and on a loopback discard port: nothing to fetch, nowhere to go.
      body: () => ({
        url: `http://127.0.0.1:9/${unique('load')}`,
        title: 'Load write',
        tags: ['load'],
      }),
      expect: [201],
      capture: captureId,
    },
    {
      method: 'PATCH',
      path: (context) => `/api/v1/accio/${String(context.id)}`,
      body: () => ({ title: 'Load write, retitled' }),
      expect: [200],
    },
    { method: 'DELETE', path: (context) => `/api/v1/accio/${String(context.id)}`, expect: [204] },
  ];
}

export function portkeyWrite(): Step[] {
  return [
    {
      method: 'POST',
      path: () => '/api/v1/portkey',
      body: (context) => {
        context.slug = unique('load-go');
        return { slug: context.slug, url: 'http://127.0.0.1:9/target' };
      },
      expect: [201],
    },
    {
      method: 'PATCH',
      path: (context) => `/api/v1/portkey/${String(context.slug)}`,
      body: () => ({ note: 'load write' }),
      expect: [200],
    },
    {
      method: 'DELETE',
      path: (context) => `/api/v1/portkey/${String(context.slug)}`,
      expect: [204],
    },
  ];
}

export function writeScenarios(): Scenario[] {
  return [
    { name: 'write: runestone create/update/delete', steps: documentWrite() },
    { name: 'write: accio create/update/delete', steps: accioWrite() },
    { name: 'write: portkey create/update/delete', steps: portkeyWrite() },
  ];
}

/**
 * 80% reads, 20% writes: twelve reads drawn across the read scenarios, then
 * one write triple, three times over (36 reads, 9 writes per cycle).
 */
export function mixedScenario(seeds: Seeded): Scenario {
  const reads = readScenarios(seeds).flatMap((scenario) => scenario.steps);
  const writes = [documentWrite(), accioWrite(), portkeyWrite()];
  const steps: Step[] = [];
  let next = 0;
  for (const triple of writes) {
    for (let index = 0; index < 12; index += 1) {
      const read = reads[next++ % reads.length];
      if (read) steps.push(read);
    }
    steps.push(...triple);
  }
  return { name: 'mixed: 80% read / 20% write', steps };
}

export interface FireOptions {
  baseUrl: string;
  connections: number;
  durationSeconds: number;
  /** Per-request timeout; a request past it counts as a timeout. */
  timeoutSeconds?: number;
  name?: string;
}

/** Run one scenario with autocannon and reduce it to a result row. */
export async function fire(scenario: Scenario, options: FireOptions): Promise<ScenarioResult> {
  let unexpected = 0;
  const requests: autocannon.Request[] = scenario.steps.map((step) => ({
    method: step.method,
    setupRequest: (request: autocannon.Request, context: object) => {
      const ctx = context as Context;
      const body = step.body?.(ctx);
      return {
        ...request,
        method: step.method,
        path: step.path(ctx),
        headers: {
          ...request.headers,
          'x-bifrost-device': 'load-harness',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      };
    },
    onResponse: (status: number, body: string, context: object) => {
      if (!step.expect.includes(status)) {
        unexpected += 1;
        return;
      }
      step.capture?.(body, context as Context);
    },
  }));

  const result = await autocannon({
    url: options.baseUrl,
    connections: options.connections,
    duration: options.durationSeconds,
    timeout: options.timeoutSeconds ?? 10,
    requests,
    initialContext: {},
  });

  const statusCounts: Record<string, number> = {};
  for (const [status, stat] of Object.entries(result.statusCodeStats ?? {})) {
    statusCounts[status] = stat.count ?? 0;
  }
  return {
    name: options.name ?? scenario.name,
    connections: options.connections,
    durationSeconds: result.duration,
    requests: result.requests.total,
    requestsPerSecond: result.requests.average,
    latencyMs: {
      mean: result.latency.mean,
      p50: result.latency.p50,
      p90: result.latency.p90,
      p99: result.latency.p99,
      max: result.latency.max,
    },
    bytesPerSecond: result.throughput.average,
    statusCounts,
    // autocannon counts timeouts inside `errors`; the report keeps them apart.
    errors: result.errors - result.timeouts,
    timeouts: result.timeouts,
    unexpected,
  };
}
