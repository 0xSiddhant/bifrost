import { ApiError, apiGet, apiSend } from '../../core/api';
import type { BrotliQualityName } from './quality';

/**
 * The Brotli wire calls. Both codec routes move **raw bytes**, not JSON, so
 * they use `fetch` directly rather than `core/api`'s JSON helpers — everything
 * else on this page (the config read, the Hermes hand-off) goes through those
 * helpers as usual.
 */

export interface BrotliConfig {
  maxInputMb: number;
  maxOutputMb: number;
  qualities: BrotliQualityName[];
  defaultQuality: BrotliQualityName;
}

export const fetchBrotliConfig = (): Promise<BrotliConfig> =>
  apiGet<BrotliConfig>('/api/brotli/config');

export const compressContent = (bytes: Uint8Array, quality: BrotliQualityName): Promise<Uint8Array> =>
  postBytes(`/api/brotli/compress?quality=${quality}`, bytes);

export const decompressContent = (bytes: Uint8Array): Promise<Uint8Array> =>
  postBytes('/api/brotli/decompress', bytes);

/**
 * Puts a result on the Hermes clipboard board.
 *
 * This calls the public `/api/clipboard` endpoint **directly**, exactly as
 * `core/api`'s generic helper backs many features' calls to shared REST
 * routes. It deliberately does not import `features/hermes/api.ts`: that would
 * be a cross-feature import, which is a build failure under
 * `eslint-plugin-boundaries` and would couple two features that only ever
 * needed to agree on one URL.
 */
export const sendToHermes = (text: string): Promise<unknown> =>
  apiSend('POST', '/api/clipboard', { text });

async function postBytes(path: string, bytes: Uint8Array): Promise<Uint8Array> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes as BlobPart,
  });
  if (!response.ok) throw await errorFrom(path, response);

  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    // The server had already answered 200 and started streaming when it hit a
    // decode failure or the output cap, so there was no status left for it to
    // send — it ended the connection instead. Named here rather than surfacing
    // as a bare network error, because it has a real, explainable cause.
    throw new ApiError(0, 'the result stopped partway through', 'STREAM_ENDED', undefined, {
      cause: String(cause),
    });
  }
}

/** Reads the server's `{ error, message }` body, the shape `core/api` expects. */
async function errorFrom(path: string, response: Response): Promise<ApiError> {
  const fallback = `POST ${path} failed with ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const code = typeof body.error === 'string' ? body.error : undefined;
    const detail = typeof body.message === 'string' ? body.message : undefined;
    return new ApiError(response.status, detail ?? fallback, code, detail);
  } catch {
    // A non-JSON error body is not a second failure — the status still carries
    // everything the page needs to say.
    return new ApiError(response.status, fallback);
  }
}
