import http from 'node:http';

/**
 * A local HTTP "page" for Accio's title enrichment, so the suite never reaches
 * the internet: `GET /page/<name>` answers an HTML document whose `<title>` is
 * `Page <name> from the sink`. Anything else is a 404, which Accio reads as
 * "no title".
 */
export interface TitleSink {
  baseUrl: string;
  /** Paths requested so far — proves the server, not the browser, fetched it. */
  hits: string[];
  close(): Promise<void>;
}

export function titleFor(name: string): string {
  return `Page ${name} from the sink`;
}

export async function startTitleSink(): Promise<TitleSink> {
  const hits: string[] = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url ?? '');
    const match = /^\/page\/([\w-]+)$/.exec(request.url ?? '');
    if (!match?.[1]) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html><head><title>${titleFor(match[1])}</title></head><body>sink</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
