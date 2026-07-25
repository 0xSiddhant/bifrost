import { apiGet, apiSend, ApiError } from '../../core/api';
import { getDeviceId } from '../../core/deviceId';

/**
 * The Nimbus wire calls. Everything here touches the network and nothing here
 * does arithmetic — the timings it reports are raw, and `metrics.ts` turns them
 * into numbers.
 */

export interface NimbusConfig {
  maxTestMb: number;
  /** Sizes the page offers (server-derived from NIMBUS_MAX_TEST_MB — never hardcoded here). */
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

/** Raised when the server already has a test in flight for another device. */
export class BroomBusyError extends Error {
  constructor(message = 'another broom is flying') {
    super(message);
    this.name = 'BroomBusyError';
  }
}

export interface TransferOutcome {
  bytes: number;
  /** Milliseconds the bytes actually took, excluding request setup. */
  ms: number;
}

/** Bytes moved so far, and how long they took — the live gauge's only input. */
export type ProgressFn = (bytes: number, ms: number) => void;

const MB = 1024 * 1024;

export const fetchNimbusConfig = (): Promise<NimbusConfig> =>
  apiGet<NimbusConfig>('/api/nimbus/config');

export const listResults = (device?: string): Promise<NimbusResult[]> =>
  apiGet<NimbusResult[]>(
    `/api/nimbus/results${device ? `?device=${encodeURIComponent(device)}` : ''}`,
  );

export const saveResult = (input: {
  downMbps: number;
  upMbps: number;
  latencyMs: number;
  testMb: number;
}): Promise<NimbusResult> => apiSend<NimbusResult>('POST', '/api/nimbus/results', input);

/**
 * Tells the server this device is done (finished or cancelled) so the next one
 * doesn't wait out the guard's grace window. Best-effort by design: a failed
 * release just means the guard expires on its own.
 */
export const releaseGuard = (): Promise<void> =>
  apiSend<null>('POST', '/api/nimbus/release')
    .then(() => undefined)
    .catch(() => undefined);

/** One latency round trip, measured client-side (the server sends no body). */
export async function pingOnce(signal?: AbortSignal): Promise<number> {
  const started = performance.now();
  const response = await fetch('/api/nimbus/ping', { cache: 'no-store', signal });
  const elapsed = performance.now() - started;
  if (!response.ok) throw new ApiError(response.status, 'ping failed');
  return elapsed;
}

/**
 * Times a download by reading the body chunk by chunk.
 *
 * The clock starts at the **first chunk**, not at the request: time-to-first-byte
 * is the server thinking, and folding it in would report a slower link than the
 * one that exists. Everything after that is bytes on the wire.
 */
export async function downloadTest(options: {
  mb: number;
  signal?: AbortSignal;
  onProgress?: ProgressFn;
}): Promise<TransferOutcome> {
  const response = await fetch(`/api/nimbus/down?mb=${options.mb}`, {
    cache: 'no-store',
    headers: { 'x-bifrost-device': getDeviceId() },
    signal: options.signal,
  });
  if (response.status === 409) throw new BroomBusyError();
  if (!response.ok || !response.body) throw new ApiError(response.status, 'download failed');

  const reader = response.body.getReader();
  let bytes = 0;
  let firstAt = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstAt === 0) firstAt = performance.now();
    bytes += value.byteLength;
    options.onProgress?.(bytes, performance.now() - firstAt);
  }
  return { bytes, ms: firstAt === 0 ? 0 : performance.now() - firstAt };
}

/**
 * Times an upload of `bytes` of random data the server throws away.
 *
 * XHR rather than fetch, for the same reason uploads use it elsewhere in Bifrost:
 * fetch has no upload-progress events, and a speed test with no live number is
 * a spinner. The **reported** duration is the server's own — the browser's
 * `loaded` counter reaches 100% when the OS accepts the last byte, which on a
 * slow link happens well before the bytes arrive.
 */
export function uploadTest(options: {
  bytes: number;
  signal?: AbortSignal;
  onProgress?: ProgressFn;
}): Promise<TransferOutcome> {
  const body = randomBlob(options.bytes);
  return new Promise<TransferOutcome>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = performance.now();
    const onAbort = () => xhr.abort();

    xhr.open('POST', '/api/nimbus/up');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-bifrost-device', getDeviceId());
    xhr.responseType = 'text';

    xhr.upload.onprogress = (event) => {
      options.onProgress?.(event.loaded, performance.now() - started);
    };
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', onAbort);
      if (xhr.status === 409) {
        reject(new BroomBusyError());
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, 'upload failed'));
        return;
      }
      try {
        const parsed = JSON.parse(xhr.responseText) as TransferOutcome;
        resolve({ bytes: parsed.bytes, ms: parsed.ms });
      } catch {
        reject(new ApiError(xhr.status, 'upload response was not readable'));
      }
    };
    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new ApiError(0, 'upload failed'));
    };
    xhr.onabort = () => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('aborted', 'AbortError'));
    };

    if (options.signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    options.signal?.addEventListener('abort', onAbort);
    xhr.send(body);
  });
}

/**
 * Random bytes, in 64 KiB pieces because `getRandomValues` refuses more than
 * 65536 at a time. Random rather than zeros for the same reason the server's
 * pool is: a compressible body would report throughput the link never had.
 */
export function randomBlob(bytes: number): Blob {
  const parts: BlobPart[] = [];
  const chunk = 64 * 1024;
  for (let sent = 0; sent < bytes; sent += chunk) {
    const part = new Uint8Array(new ArrayBuffer(Math.min(chunk, bytes - sent)));
    crypto.getRandomValues(part);
    parts.push(part);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

export const bytesForMb = (mb: number): number => mb * MB;
