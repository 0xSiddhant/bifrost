import http from 'node:http';

/**
 * A multipart upload streamed from a generator, never held in memory on this
 * side (PLAN-33): a 300 MB body is 300 one-MiB writes, each waiting for the
 * socket to drain. `chunked` transfer, so the server cannot shortcut on a
 * declared length and must stream the whole thing.
 */

export interface StreamUploadOptions {
  baseUrl: string;
  fileName: string;
  totalBytes: number;
  chunkBytes?: number;
  /** Called after each chunk is accepted by the socket; await it to slow the upload down. */
  onChunk?: (sentBytes: number) => Promise<void> | void;
  /** Aborts the request part-way (a test that kills the server mid-upload). */
  signal?: AbortSignal;
}

export interface StreamUploadResult {
  status: number;
  body: string;
}

const BOUNDARY = 'BifrostE2EStreamBoundary';

export function streamUpload(options: StreamUploadOptions): Promise<StreamUploadResult> {
  const chunkBytes = options.chunkBytes ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    const request = http.request(`${options.baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'transfer-encoding': 'chunked',
        'x-bifrost-device': 'e2e-api-stream',
      },
      signal: options.signal,
    });
    request.on('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);

    const write = (data: Buffer | string): Promise<void> =>
      new Promise((done) => {
        if (request.write(data)) done();
        else request.once('drain', () => done());
      });

    void (async () => {
      try {
        await write(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="${options.fileName}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n',
        );
        // A repeating, non-trivial pattern: cheap to make, and not all zeros.
        const chunk = Buffer.alloc(chunkBytes, 'bifrost-e2e-stream-');
        let sent = 0;
        while (sent < options.totalBytes) {
          const size = Math.min(chunkBytes, options.totalBytes - sent);
          await write(size === chunkBytes ? chunk : chunk.subarray(0, size));
          sent += size;
          await options.onChunk?.(sent);
          if (request.destroyed) return;
        }
        await write(`\r\n--${BOUNDARY}--\r\n`);
        request.end();
      } catch (error) {
        request.destroy(error as Error);
      }
    })();
  });
}

/** Resident set size of the server, read from its own Prometheus exposition. */
export async function serverRss(baseUrl: string): Promise<number> {
  const text = await (await fetch(`${baseUrl}/metrics`)).text();
  const match = /^bifrost_process_resident_memory_bytes (\d+(?:\.\d+)?(?:e\+\d+)?)$/m.exec(text);
  if (!match?.[1]) throw new Error('no bifrost_process_resident_memory_bytes in /metrics');
  return Number(match[1]);
}
