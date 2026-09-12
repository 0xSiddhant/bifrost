import crypto from 'node:crypto';
import type { ApiClient } from './client.js';
import { CliError } from './output.js';

/**
 * The LAN speed test, run the same way the browser page runs it — deliberately,
 * so a CLI reading and a browser reading on the same network mean the same
 * thing, and a CLI run joins the same history.
 *
 * The philosophy is Nimbus's own: the server moves bytes, **the client owns the
 * clock**, because the number a person cares about is the one their own device
 * sees. Ping is the median of N round trips, never the mean — one Wi-Fi retry
 * would poison an average. The download clock starts at the **first chunk**
 * (time-to-first-byte is the server thinking, not the link), and the upload
 * figure is the server's own reported duration, because the OS accepts the last
 * byte well before it arrives.
 */

const MB = 1024 * 1024;
/** Untimed transfer first: TCP slow-start would otherwise be measured as the link. */
const WARMUP_MB = 1;

export interface NimbusConfig {
  maxTestMb: number;
  sizes: number[];
  pingSamples: number;
  busy: boolean;
  holder: string | null;
  since: number | null;
}

export interface NimbusResult {
  id: number;
  deviceId: string | null;
  downMbps: number;
  upMbps: number;
  latencyMs: number;
  testMb: number;
  createdAt: number;
}

export interface SpeedReading {
  downMbps: number;
  upMbps: number;
  latencyMs: number;
  testMb: number;
}

export type Phase = 'warmup' | 'ping' | 'down' | 'up' | 'saving';

export function bytesForMb(mb: number): number {
  return Math.round(mb * MB);
}

/** Median, not mean — see the note above. Null for an empty sample. */
export function median(values: readonly number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (usable.length === 0) return null;
  const middle = Math.floor(usable.length / 2);
  const upper = usable[middle] ?? 0;
  return usable.length % 2 === 1 ? upper : ((usable[middle - 1] ?? 0) + upper) / 2;
}

/** Megabits per second: throughput is decimal even though the payload is binary. */
export function mbps(bytes: number, ms: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(ms) || ms <= 0 || bytes <= 0) return 0;
  return (bytes * 8) / (ms / 1000) / 1_000_000;
}

/** Three significant figures — the most a Wi-Fi reading can honestly claim. */
export function formatMbps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function getNimbusConfig(client: ApiClient): Promise<NimbusConfig> {
  return client.json<NimbusConfig>('reading the speed-test config', 'GET', '/api/nimbus/config');
}

export function saveSpeedResult(client: ApiClient, reading: SpeedReading): Promise<NimbusResult> {
  return client.json<NimbusResult>('saving the speed test', 'POST', '/api/nimbus/results', {
    body: reading,
  });
}

/** One latency round trip; the server sends no body, so this times the hop itself. */
async function pingOnce(client: ApiClient): Promise<number> {
  const started = performance.now();
  await client.voidCall('pinging the bridge', 'GET', '/api/nimbus/ping');
  return performance.now() - started;
}

async function downloadTest(
  client: ApiClient,
  mb: number,
  warmup: boolean,
): Promise<{ bytes: number; ms: number }> {
  const response = await client.open('running the download test', '/api/nimbus/down', {
    query: { mb, ...(warmup ? { warmup: '1' } : {}) },
  });
  if (response.body === null) {
    throw new CliError('running the download test failed: the bridge sent no body');
  }
  let bytes = 0;
  let firstAt = 0;
  for await (const chunk of response.body) {
    if (firstAt === 0) firstAt = performance.now();
    bytes += (chunk as Uint8Array).byteLength;
  }
  return { bytes, ms: firstAt === 0 ? 0 : performance.now() - firstAt };
}

async function uploadTest(
  client: ApiClient,
  bytes: number,
): Promise<{ bytes: number; ms: number }> {
  // Random, not zeros: a compressible body would report throughput the link
  // never had, the same reason the server's own pool is random.
  const payload = crypto.randomBytes(bytes);
  // The server's own timing, not ours — see the header note.
  return client.postBinary<{ bytes: number; ms: number }>(
    'running the upload test',
    '/api/nimbus/up',
    payload,
  );
}

/**
 * Hands the single-flight lease back. Best-effort by design: a failed release
 * only means the guard expires on its own a grace period later, and reporting it
 * would bury the result the user actually asked for.
 */
async function release(client: ApiClient): Promise<void> {
  try {
    await client.voidCall('releasing the speed-test lease', 'POST', '/api/nimbus/release');
  } catch {
    // Deliberately silent: see above. The lease self-expires either way.
  }
}

export async function runSpeedTest(
  client: ApiClient,
  options: { testMb: number; pingSamples: number; onPhase?: (phase: Phase) => void },
): Promise<SpeedReading> {
  const { testMb, pingSamples } = options;
  const announce = options.onPhase ?? ((): void => undefined);

  try {
    announce('warmup');
    await downloadTest(client, WARMUP_MB, true);
    await uploadTest(client, bytesForMb(WARMUP_MB));

    announce('ping');
    const samples: number[] = [];
    for (let index = 0; index < pingSamples; index += 1) {
      samples.push(await pingOnce(client));
    }
    const latencyMs = median(samples) ?? 0;

    announce('down');
    const down = await downloadTest(client, testMb, false);

    announce('up');
    const up = await uploadTest(client, bytesForMb(testMb));

    return { downMbps: mbps(down.bytes, down.ms), upMbps: mbps(up.bytes, up.ms), latencyMs, testMb };
  } finally {
    // Hand the guard back whatever happened, so the next device isn't made to
    // wait out the grace window for a test that already ended.
    await release(client);
  }
}
