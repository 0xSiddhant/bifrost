import http from 'node:http';

/**
 * One `GET /api/events` held open over a real socket (PLAN-33) — what a
 * browser tab does, without the browser. Everything received is kept, so a
 * test can wait for a frame that arrived before it started looking.
 */
export interface EventStream {
  /** Everything received so far. */
  text(): string;
  /** Resolve once the received text matches; reject after the timeout. */
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<string>;
  close(): void;
}

export function openEventStream(baseUrl: string, deviceId: string): Promise<EventStream> {
  return new Promise((resolve, reject) => {
    let received = '';
    const waiters: (() => void)[] = [];
    const request = http.get(
      `${baseUrl}/api/events?deviceId=${encodeURIComponent(deviceId)}`,
      { headers: { 'user-agent': 'bifrost-e2e-api' } },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`/api/events → ${response.statusCode}`));
          return;
        }
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          received += chunk;
          for (const waiter of waiters.splice(0)) waiter();
        });
        resolve({
          text: () => received,
          waitFor(pattern, timeoutMs = 10_000) {
            return new Promise((done, fail) => {
              const timer = setTimeout(
                () => fail(new Error(`no ${pattern} on the event stream; got:\n${received}`)),
                timeoutMs,
              );
              const check = () => {
                const match = pattern.exec(received);
                if (match) {
                  clearTimeout(timer);
                  done(match[0]);
                } else waiters.push(check);
              };
              check();
            });
          },
          close: () => request.destroy(),
        });
      },
    );
    request.on('error', (error) => {
      // A deliberate close() destroys the socket; that is not a failure.
      if (!request.destroyed) reject(error);
    });
  });
}
