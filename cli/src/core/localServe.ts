import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CliError, EXIT } from './output.js';

/**
 * A one-shot local HTTP server, so a browser page can read a file off this
 * machine's disk (PLAN-28).
 *
 * A browser page cannot open an arbitrary local path with no user gesture —
 * that is a hard security boundary, not a limitation to design around — so a
 * terminal-opened file has to reach the page as a real, if local, HTTP request.
 * This is that request's other end: bound to loopback only, on an OS-assigned
 * free port, streamed straight off disk, and gone as soon as it has done its
 * one job.
 *
 * Three deliberate bounds, because this is a server on somebody's laptop:
 * - **Loopback only.** Bound to 127.0.0.1, so nothing on the LAN can reach it
 *   even for the seconds it exists.
 * - **One path, one file.** `/payload` serves the file named at construction
 *   and nothing else; every other path is a 404. There is no path parameter to
 *   traverse out of.
 * - **CORS scoped to one origin.** The Bifrost origin the CLI already resolved,
 *   never `*` — the page doing the fetching is known exactly.
 */

/** Long enough to cover a browser cold-starting; short enough to not linger. */
const DEFAULT_TIMEOUT_MS = 60_000;

const PAYLOAD_PATH = '/payload';

export interface LocalPayloadServer {
  /** The address to hand the browser. */
  url: string;
  /**
   * Resolves when the server has closed — after the payload was served, or
   * after the timeout expired with nobody asking for it. Rejects only if the
   * timeout won the race, so a caller can tell "presented" from "never fetched".
   */
  finished: Promise<void>;
  /** Close early (a browser that never launched, a failure further up). */
  close: () => void;
}

export interface ServeFileOptions {
  /** Exact origin allowed to fetch it, e.g. `http://bifrost.local:4646`. */
  origin: string;
  timeoutMs?: number;
}

/**
 * Serve one file at `/payload` until it has been fetched once.
 *
 * The read stream is opened per request rather than up front: a caller that
 * never fetches must not hold a file handle open for a minute.
 */
export async function serveFileOnce(
  filePath: string,
  options: ServeFileOptions,
): Promise<LocalPayloadServer> {
  const absolute = path.resolve(filePath);
  const stat = await fs.promises.stat(absolute).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new CliError(`no such file: ${filePath}`, EXIT.notFound);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let settle: (error?: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    settle = (error?: Error) => (error ? reject(error) : resolve());
  });

  let served = false;
  let timer: NodeJS.Timeout | null = null;

  const finish = (error?: Error) => {
    if (served) return;
    served = true;
    if (timer) clearTimeout(timer);
    server.close(() => settle(error));
    // A browser using a keep-alive connection keeps `close` pending otherwise.
    server.closeAllConnections();
  };

  const server = http.createServer((request, response) => {
    const url = request.url ?? '';
    if (url.split('?')[0] !== PAYLOAD_PATH) {
      response.writeHead(404).end();
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', options.origin);
    // The file is markdown for now, but the browser only ever reads it as text.
    response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    response.setHeader('Content-Length', String(stat.size));
    response.setHeader('Cache-Control', 'no-store');

    if (request.method === 'HEAD') {
      response.writeHead(200).end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }

    const stream = fs.createReadStream(absolute);
    stream.on('error', (error) => {
      // The stat succeeded moments ago, so this is a file that moved or lost
      // its permissions mid-command — silence would leave the page hanging.
      response.destroy();
      finish(new CliError(`could not read ${filePath}: ${error.message}`));
    });
    // Only after the bytes are actually out: a response that died halfway has
    // not done the job, and closing then would strand the page.
    response.on('finish', () => finish());
    stream.pipe(response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new CliError('could not open a local port to serve the file from');
  }

  timer = setTimeout(() => {
    finish(
      new CliError(
        'the browser never fetched the file — it may have failed to open, ' +
          'or the page could not reach this machine',
      ),
    );
  }, timeoutMs);
  // The command should not be held open by this timer alone.
  timer.unref();

  return {
    url: `http://127.0.0.1:${address.port}${PAYLOAD_PATH}`,
    finished,
    close: () => finish(),
  };
}
