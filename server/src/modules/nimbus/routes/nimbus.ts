import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import { AppError } from '../../../core/http/index.js';
import { errorResponses, noContent, rawBody } from '../../../core/http/schemas.js';
import type { TestGuard } from '../guard.js';
import { bytesForMb, resolveTestMb, testSizes } from '../payload.js';
import type { ListResultsUseCase, SaveResultUseCase } from '../usecases/record-results.js';

export interface NimbusRoutesDeps {
  guard: TestGuard;
  maxTestMb: number;
  /** How many ping round trips one test takes; the client reads it, never guesses. */
  pingSamples: number;
  /** Builds the download body — injected so the pool is created once, at registration. */
  payloadStream: (bytes: number) => NodeJS.ReadableStream;
  save: SaveResultUseCase;
  list: ListResultsUseCase;
}

/**
 * Who holds the lease. A deviceId when the client sent one (every Bifrost page
 * does), the IP otherwise — the point is only that two different devices get
 * two different keys while one device's own phases share one.
 */
function deviceKeyOf(request: FastifyRequest): string {
  return deviceIdOf(request) ?? request.ip;
}

/** The 409 the plan asks for, in the plan's words. */
function broomBusy(holder: string): AppError {
  return new AppError(
    `another broom is flying (test in progress on ${holder})`,
    409,
    'TEST_IN_PROGRESS',
  );
}

const resultsBodySchema = {
  type: 'object',
  required: ['downMbps', 'upMbps', 'latencyMs', 'testMb'],
  additionalProperties: false,
  properties: {
    downMbps: { type: 'number' },
    upMbps: { type: 'number' },
    latencyMs: { type: 'number' },
    testMb: { type: 'integer', minimum: 1 },
  },
} as const;

const resultsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    device: { type: 'string', maxLength: 64 },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
  },
} as const;

const downQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mb: { type: 'number', minimum: 0.01 },
    /** Warmup transfers still hold the lease; they just aren't timed by the client. */
    warmup: { type: 'string' },
  },
} as const;

// Response shapes (PLAN-32), in the order the table and handlers build them.
const resultSchema = {
  type: 'object',
  required: ['id', 'deviceId', 'downMbps', 'upMbps', 'latencyMs', 'testMb', 'createdAt'],
  properties: {
    id: { type: 'integer' },
    deviceId: { type: ['string', 'null'] },
    downMbps: { type: 'number' },
    upMbps: { type: 'number' },
    latencyMs: { type: 'number', description: 'Median ping round trip' },
    testMb: { type: 'integer' },
    createdAt: { type: 'integer', description: 'Unix epoch milliseconds' },
  },
} as const;

const TAGS = ['nimbus'];

interface UpBody {
  bytes: number;
  ms: number;
}

export function registerNimbusRoutes(app: FastifyInstance, deps: NimbusRoutesDeps): void {
  const uploadLimitBytes = bytesForMb(deps.maxTestMb);

  /**
   * The upload sink: count the bytes, time them, keep none. Taking the raw
   * stream (rather than `parseAs`) is what makes "writes nothing to disk" true
   * by construction — there is no buffer and no file, only a counter, so memory
   * stays flat through a 100 MB post.
   */
  app.addContentTypeParser(
    'application/octet-stream',
    (_request: FastifyRequest, payload: NodeJS.ReadableStream, done) => {
      const started = performance.now();
      let bytes = 0;
      let settled = false;
      const finish = (error: Error | null, body?: UpBody) => {
        if (settled) return;
        settled = true;
        done(error, body);
      };

      payload.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > uploadLimitBytes) {
          // Nothing here is worth keeping, so unlike a multipart upload (which
          // drains to save its sibling files) this just stops reading.
          finish(new AppError('test payload exceeds the configured cap', 413, 'PAYLOAD_TOO_LARGE'));
        }
      });
      payload.on('end', () => finish(null, { bytes, ms: performance.now() - started }));
      payload.on('error', (error: Error) => finish(error));
    },
  );

  /** Limits live in .env, so the page reads them instead of hardcoding a menu. */
  app.get(
    '/api/v1/nimbus/config',
    {
      schema: {
        tags: TAGS,
        summary: 'Test sizes, ping sample count, and whether a test is running now',
        operationId: 'getNimbusConfig',
        response: {
          200: {
            type: 'object',
            required: ['maxTestMb', 'sizes', 'pingSamples', 'busy', 'holder', 'since'],
            properties: {
              maxTestMb: { type: 'integer' },
              sizes: {
                type: 'array',
                items: { type: 'integer' },
                description: 'Offered sizes, MB',
              },
              pingSamples: { type: 'integer' },
              busy: { type: 'boolean', description: 'One test at a time on the LAN' },
              holder: { type: ['string', 'null'], description: 'The device testing, if any' },
              since: { type: ['integer', 'null'], description: 'Unix epoch milliseconds' },
            },
          },
        },
      },
    },
    () => ({
      maxTestMb: deps.maxTestMb,
      sizes: testSizes(deps.maxTestMb),
      pingSamples: deps.pingSamples,
      ...deps.guard.state(Date.now()),
    }),
  );

  /**
   * Latency probe: no body, no guard. Ten of these run back-to-back, and they
   * are too small to disturb another device's transfer — while taking the lease
   * for them would mean a busy server couldn't even be pinged.
   */
  app.get(
    '/api/v1/nimbus/ping',
    {
      schema: {
        tags: TAGS,
        summary: 'An empty round trip for latency sampling',
        operationId: 'pingNimbus',
        response: { 204: noContent },
      },
    },
    (_request, reply) => reply.header('cache-control', 'no-store').code(204).send(),
  );

  app.get<{ Querystring: { mb?: number; warmup?: string } }>(
    '/api/v1/nimbus/down',
    {
      schema: {
        tags: TAGS,
        summary: 'Download test: `mb` megabytes of incompressible bytes',
        description: 'Takes the LAN-wide test lease; 409 while another device holds it.',
        operationId: 'downloadTestPayload',
        querystring: downQuerySchema,
        response: {
          200: rawBody('application/octet-stream', 'The payload, never compressed or cached', {
            'x-nimbus-bytes': { type: 'integer', description: 'The payload size' },
          }),
          ...errorResponses(400, 409),
        },
      },
    },
    (request, reply: FastifyReply) => {
      const mb = resolveTestMb(request.query.mb ?? 10, deps.maxTestMb);
      if (mb === null) throw new AppError('mb must be a positive number', 400, 'BAD_REQUEST');

      const key = deviceKeyOf(request);
      const lease = deps.guard.acquire(key, Date.now());
      if (!lease.ok) throw broomBusy(lease.holder);
      // Fires on clean completion *and* on an aborted download, which is what
      // makes cancel release the guard without a dedicated code path.
      reply.raw.on('close', () => deps.guard.finish(key, Date.now()));

      const bytes = bytesForMb(mb);
      return (
        reply
          .header('content-type', 'application/octet-stream')
          .header('content-length', String(bytes))
          // Compression would invent throughput out of a repeating pool; identity
          // is stated explicitly so nothing on the path is tempted to help.
          .header('content-encoding', 'identity')
          .header('cache-control', 'no-store')
          .header('x-nimbus-bytes', String(bytes))
          .send(deps.payloadStream(bytes))
      );
    },
  );

  app.post<{ Body: UpBody }>(
    '/api/v1/nimbus/up',
    {
      schema: {
        tags: TAGS,
        summary: 'Upload test: send an application/octet-stream body; the server times it',
        description: 'Takes the LAN-wide test lease; 409 while another device holds it.',
        operationId: 'uploadTestPayload',
        response: {
          200: {
            type: 'object',
            required: ['bytes', 'ms'],
            properties: {
              bytes: { type: 'integer', description: 'Bytes received' },
              ms: { type: 'number', description: 'Server-side receive time, to 0.01 ms' },
            },
          },
          ...errorResponses(400, 409, 413, 415),
        },
      },
      // onRequest runs before the body is read: a 409 or an oversize 413 is
      // answered without pulling megabytes off the socket first.
      onRequest: (request, _reply, done) => {
        const length = Number(request.headers['content-length'] ?? 0);
        if (Number.isFinite(length) && length > uploadLimitBytes) {
          done(new AppError('test payload exceeds the configured cap', 413, 'PAYLOAD_TOO_LARGE'));
          return;
        }
        const key = deviceKeyOf(request);
        const lease = deps.guard.acquire(key, Date.now());
        if (!lease.ok) {
          done(broomBusy(lease.holder));
          return;
        }
        request.raw.on('close', () => deps.guard.finish(key, Date.now()));
        done();
      },
    },
    (request) => ({ bytes: request.body.bytes, ms: Math.round(request.body.ms * 100) / 100 }),
  );

  /**
   * "My test is over" — finished or cancelled. Without it the next device waits
   * out the grace window for no reason; with it, cancel frees the guard at once.
   */
  app.post(
    '/api/v1/nimbus/release',
    {
      schema: {
        tags: TAGS,
        summary: "Give up this device's test lease early",
        operationId: 'releaseNimbusLease',
        response: { 204: noContent, ...errorResponses(400, 413, 415) },
      },
    },
    (request, reply) => {
      deps.guard.release(deviceKeyOf(request));
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { downMbps: number; upMbps: number; latencyMs: number; testMb: number } }>(
    '/api/v1/nimbus/results',
    {
      schema: {
        tags: TAGS,
        summary: 'Record a finished test',
        operationId: 'saveNimbusResult',
        body: resultsBodySchema,
        response: { 201: resultSchema, ...errorResponses(400, 413, 415, 422) },
      },
    },
    async (request, reply) => {
      const result = deps.save.execute({ ...request.body, deviceId: deviceIdOf(request) });
      return reply.code(201).send(result);
    },
  );

  app.get<{ Querystring: { device?: string; limit?: number } }>(
    '/api/v1/nimbus/results',
    {
      schema: {
        tags: TAGS,
        summary: 'Recorded tests, newest first, optionally for one device',
        operationId: 'listNimbusResults',
        querystring: resultsQuerySchema,
        response: { 200: { type: 'array', items: resultSchema }, ...errorResponses(400) },
      },
    },
    (request) => deps.list.execute(request.query),
  );
}
