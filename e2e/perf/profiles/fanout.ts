import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { streamUpload } from '../../api/support/stream-upload.js';
import { scrape, type MetricsSnapshot } from '../metrics.js';
import { diskRefusal } from '../options.js';
import type { ScenarioResult } from '../report.js';
import { prose } from '../seed.js';
import { percentile } from './spike.js';
import type { ProfileDefinition } from './types.js';

const MB = 2 ** 20;
const EVENTS = 20;

/** One `/api/events` stream held open, with the arrival time of every saved document's event. */
interface Listener {
  arrivals: Map<string, number>;
  connected: Promise<void>;
  close(): void;
}

function listen(baseUrl: string, deviceId: string): Listener {
  const arrivals = new Map<string, number>();
  let buffer = '';
  let request: http.ClientRequest;
  const connected = new Promise<void>((resolve, reject) => {
    request = http.get(`${baseUrl}/api/events?deviceId=${deviceId}`, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`/api/events → ${response.statusCode}`));
        return;
      }
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        const now = performance.now();
        buffer += chunk;
        if (buffer.includes(': connected')) resolve();
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: runestone\.saved\ndata: .*"name":"(fanout-[^"]+)"/m.exec(
            frame,
          )?.[1];
          if (name && !arrivals.has(name)) arrivals.set(name, now);
        }
      });
    });
    request.on('error', (error) => {
      if (!request.destroyed) reject(error);
    });
  });
  return { arrivals, connected, close: () => request.destroy() };
}

function streamResult(name: string, bytes: number, seconds: number, ok: boolean): ScenarioResult {
  const latency = seconds * 1000;
  return {
    name,
    connections: 1,
    durationSeconds: seconds,
    requests: 1,
    requestsPerSecond: 1 / seconds,
    latencyMs: { mean: latency, p50: latency, p90: latency, p99: latency, max: latency },
    bytesPerSecond: bytes / seconds,
    statusCounts: {},
    errors: 0,
    timeouts: 0,
    unexpected: ok ? 0 : 1,
    extra: {
      megabytes: Number((bytes / MB).toFixed(1)),
      mbPerSecond: Number((bytes / MB / seconds).toFixed(1)),
    },
  };
}

async function timed<T>(work: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now();
  const result = await work();
  return [result, (performance.now() - started) / 1000];
}

/** GET a URL and count its bytes without keeping them. */
function drain(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (response) => {
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, bytes }));
        response.on('error', reject);
      })
      .on('error', reject);
  });
}

/**
 * Text that compresses like a real document rather than to nothing: prose
 * lines, each carrying a run of random hex the compressor cannot predict.
 */
function brotliInput(bytes: number): Buffer {
  const noise = crypto.randomBytes(Math.ceil(bytes / 8)).toString('hex');
  const lines = prose(bytes, 7).split('\n');
  let text = '';
  for (const [index, line] of lines.entries()) {
    text += `${line} ${noise.slice(index * 12, index * 12 + 12)}\n`;
    if (text.length >= bytes) break;
  }
  return Buffer.from(text.padEnd(bytes, 'x').slice(0, bytes));
}

/**
 * What do connections and streams cost?
 *
 * - **SSE:** 200 listeners (each with its own device id, as browser tabs
 *   are), then 20 saves. Delivery latency runs from the moment a save is
 *   sent to the moment each listener reads its event (the event can arrive
 *   before the save's own response does, so "acknowledged" would read
 *   negative). Every listener must get every event.
 * - **Streams:** concurrent 1 GB uploads, then each downloaded as two
 *   concurrent `Range` halves, then a folder archive, with the RSS
 *   high-water mark set against the flat-memory promise.
 * - **Brotli:** a compress/decompress round trip of the configured input cap.
 */
export const fanout: ProfileDefinition = {
  sampleIntervalMs: 1_000,
  async run(context) {
    const { baseUrl, api, options } = context;
    const failures: string[] = [];
    const scenarios: ScenarioResult[] = [];
    const summary: Record<string, unknown> = {};

    // ── SSE ────────────────────────────────────────────────────────────────
    context.log(`  sse: ${options.sseListeners} listeners × ${EVENTS} saves`);
    // A single RSS reading moves by tens of MB with each GC, so the per-listener
    // cost is taken from the median of three readings a second apart, either side.
    const settled = async () => {
      const readings: MetricsSnapshot[] = [];
      for (let index = 0; index < 3; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        readings.push(await scrape(baseUrl, context.startedAt));
      }
      const median = (field: 'rssBytes' | 'heapUsedBytes') =>
        readings.map((reading) => reading[field]).sort((a, b) => a - b)[1] ?? 0;
      return { rss: median('rssBytes'), heap: median('heapUsedBytes') };
    };
    const before = await settled();
    const listeners = Array.from({ length: options.sseListeners }, (_, index) =>
      listen(baseUrl, `load-sse-${index}`),
    );
    try {
      await Promise.all(listeners.map((listener) => listener.connected));
      const open = await settled();

      const sent = new Map<string, number>();
      for (let index = 0; index < EVENTS; index += 1) {
        const name = `fanout-${Date.now().toString(36)}-${index}`;
        sent.set(name, performance.now());
        await api.post('/api/runestone', { name, content: '{"fanout":true}' });
      }
      const deadline = Date.now() + 15_000;
      while (
        Date.now() < deadline &&
        listeners.some((listener) => listener.arrivals.size < EVENTS)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const latencies: number[] = [];
      let missing = 0;
      for (const listener of listeners) {
        for (const [name, at] of sent) {
          const arrived = listener.arrivals.get(name);
          if (arrived === undefined) missing += 1;
          else latencies.push(arrived - at);
        }
      }
      const delivered = latencies.length;
      if (missing > 0) {
        failures.push(
          `fanout: ${missing} of ${listeners.length * EVENTS} SSE deliveries never arrived`,
        );
      }
      Object.assign(summary, {
        sseListeners: listeners.length,
        sseEvents: EVENTS,
        sseDelivered: delivered,
        sseMissing: missing,
        sseDeliveryP50Ms: percentile(latencies, 0.5),
        sseDeliveryP99Ms: percentile(latencies, 0.99),
        sseDeliveryMaxMs: latencies.length ? Math.max(...latencies) : null,
        sseRssPerListenerKb: Number(((open.rss - before.rss) / listeners.length / 1024).toFixed(1)),
        sseHeapPerListenerKb: Number(
          ((open.heap - before.heap) / listeners.length / 1024).toFixed(1),
        ),
      });
    } finally {
      for (const listener of listeners) listener.close();
    }

    // ── Streams ────────────────────────────────────────────────────────────
    const uploadBytes = options.uploadMb * MB;
    const planned = uploadBytes * options.uploadCount;
    const free = (() => {
      const stats = fs.statfsSync(context.storageRoot);
      return stats.bavail * stats.bsize;
    })();
    const refusal = diskRefusal(free, planned, context.storageRoot);
    if (refusal) {
      failures.push(`fanout: ${refusal}`);
      summary.streams = 'refused';
    } else {
      context.log(
        `  streams: ${options.uploadCount} × ${options.uploadMb} MB uploads, Range downloads, an archive`,
      );
      const rssBeforeStreams = (await scrape(baseUrl, context.startedAt)).rssBytes;
      const windowStart = Date.now() - context.startedAt;
      const tag = Date.now().toString(36);
      const names = Array.from(
        { length: options.uploadCount },
        (_, index) => `load-stream-${tag}-${index}.bin`,
      );

      const [uploads, uploadsSeconds] = await timed(() =>
        Promise.all(
          names.map(async (fileName) => {
            const [result, seconds] = await timed(() =>
              streamUpload({ baseUrl, fileName, totalBytes: uploadBytes }),
            );
            return { fileName, result, seconds };
          }),
        ),
      );
      for (const [index, upload] of uploads.entries()) {
        const ok = upload.result.status === 201;
        if (!ok) failures.push(`fanout: upload ${upload.fileName} → ${upload.result.status}`);
        scenarios.push(
          streamResult(
            `stream: upload ${index + 1} of ${options.uploadCount}, ${options.uploadMb} MB`,
            uploadBytes,
            upload.seconds,
            ok,
          ),
        );
      }

      for (const name of names) await api.post(`/api/files/${encodeURIComponent(name)}/publish`);
      let ids: string[] = [];
      for (let tries = 0; tries < 120 && ids.length < names.length; tries += 1) {
        const listing = (await api.get('/api/downloads')).json<{ id: string; name: string }[]>();
        ids = listing.filter((entry) => names.includes(entry.name)).map((entry) => entry.id);
        if (ids.length < names.length) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (ids.length < names.length)
        failures.push('fanout: published streams never appeared in downloads');

      const half = Math.floor(uploadBytes / 2);
      const [, downloadsSeconds] = await timed(() =>
        Promise.all(
          ids.map(async (id, index) => {
            const [parts, seconds] = await timed(() =>
              Promise.all([
                drain(`${baseUrl}/api/downloads/${id}/content`, { range: `bytes=0-${half - 1}` }),
                drain(`${baseUrl}/api/downloads/${id}/content`, { range: `bytes=${half}-` }),
              ]),
            );
            const bytes = parts.reduce((total, part) => total + part.bytes, 0);
            const ok = parts.every((part) => part.status === 206) && bytes === uploadBytes;
            if (!ok) {
              failures.push(
                `fanout: Range download of ${id} → ${parts.map((part) => `${part.status}/${part.bytes}`).join(', ')}`,
              );
            }
            scenarios.push(
              streamResult(
                `stream: download ${index + 1} of ${ids.length}, ${options.uploadMb} MB as two Range halves`,
                bytes,
                seconds,
                ok,
              ),
            );
          }),
        ),
      );

      const folder = context.seeds.downloadFolderIds[0];
      if (folder) {
        const [archive, seconds] = await timed(() =>
          drain(`${baseUrl}/api/downloads/${folder}/archive`),
        );
        const ok = archive.status === 200 && archive.bytes > 0;
        if (!ok) failures.push(`fanout: folder archive → ${archive.status}`);
        scenarios.push(streamResult('stream: folder archive', archive.bytes, seconds, ok));
      }

      const peak = context.sampler.samples
        .filter((sample) => sample.atMs >= windowStart)
        .reduce((max, sample) => Math.max(max, sample.rssBytes), rssBeforeStreams);
      Object.assign(summary, {
        streamsGigabytesUploaded: Number((planned / 2 ** 30).toFixed(2)),
        streamsUploadSeconds: Number(uploadsSeconds.toFixed(1)),
        streamsDownloadSeconds: Number(downloadsSeconds.toFixed(1)),
        streamsRssBeforeMb: Number((rssBeforeStreams / MB).toFixed(1)),
        streamsRssHighWaterMb: Number((peak / MB).toFixed(1)),
        streamsRssGrowthMb: Number(((peak - rssBeforeStreams) / MB).toFixed(1)),
        flatMemory: `RSS grew ${((peak - rssBeforeStreams) / MB).toFixed(0)} MB while ${(planned / 2 ** 30).toFixed(1)} GB was uploaded and read back (${(((peak - rssBeforeStreams) / (planned * 2)) * 100).toFixed(2)}% of the bytes moved)`,
      });
    }

    // ── Brotli ─────────────────────────────────────────────────────────────
    const config = (await api.get('/api/brotli/config')).json<{ maxInputMb: number }>();
    const input = brotliInput(config.maxInputMb * MB);
    context.log(`  brotli: a ${config.maxInputMb} MB round trip`);
    const post = (path: string, body: Buffer) =>
      api.request('POST', path, {
        body,
        headers: { 'content-type': 'application/octet-stream' },
        expect: [200],
      });
    const [compressed, compressSeconds] = await timed(() =>
      post('/api/brotli/compress?quality=balanced', input),
    );
    const [restored, decompressSeconds] = await timed(() =>
      post('/api/brotli/decompress', compressed.bytes),
    );
    const same =
      crypto.createHash('sha256').update(restored.bytes).digest('hex') ===
      crypto.createHash('sha256').update(input).digest('hex');
    if (!same) failures.push('fanout: the Brotli round trip did not return the input bytes');
    scenarios.push(
      streamResult(`brotli: compress ${config.maxInputMb} MB`, input.length, compressSeconds, true),
      streamResult(
        `brotli: decompress to ${config.maxInputMb} MB`,
        input.length,
        decompressSeconds,
        same,
      ),
    );
    summary.brotliRatio = Number((compressed.bytes.length / input.length).toFixed(3));

    return { scenarios, summary, failures };
  },
};
