import type { Logger } from '../../../core/logger/index.js';
import type { TitleFetcher } from '../ports.js';
import { extractTitle } from '../title.js';

export interface HttpTitleFetcherOptions {
  /** Per attempt, not for both attempts together. */
  timeoutMs: number;
  /** Stop reading the body after this many bytes — a title lives in the head. */
  maxBytes: number;
  log: Logger;
}

/** One retry, because a first request to a cold host times out more often than it fails. */
const ATTEMPTS = 2;

/**
 * Best-effort `<title>` lookup over HTTP (PLAN-13).
 *
 * Everything about this is defensive: it is an outbound request to an address a
 * user pasted, on a LAN that may have no internet at all. It never throws, it
 * caps how long it waits, and it caps how much it reads — a 4 GB video at a
 * URL that happens to serve `text/html` must not be pulled into memory.
 */
export class HttpTitleFetcher implements TitleFetcher {
  constructor(private readonly options: HttpTitleFetcherOptions) {}

  async fetchTitle(url: string): Promise<string | null> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const title = await this.attempt(url);
      if (title !== undefined) return title;
    }
    return null;
  }

  /** `undefined` = retryable failure; `null` = a definite "no title here". */
  private async attempt(url: string): Promise<string | null | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          // Some sites serve a stub to unknown agents; a plain identifying UA
          // gets the real <head> without pretending to be a browser.
          'user-agent': 'Bifrost/1.0 (+read-later shelf)',
        },
      });
      if (!response.ok) {
        // A 4xx/5xx is an answer, not a glitch — retrying it just wastes time.
        response.body?.cancel().catch(() => {});
        return null;
      }
      const type = response.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
        response.body?.cancel().catch(() => {});
        return null;
      }
      const html = await this.readCapped(response);
      return extractTitle(html);
    } catch (error) {
      this.options.log.debug({ url, err: (error as Error).message }, 'accio: title fetch failed');
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reads at most `maxBytes`, then abandons the rest of the response. */
  private async readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder('utf-8');
    let html = '';
    let read = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.byteLength;
        html += decoder.decode(value, { stream: true });
        // The title is in the head; once we have it (or blew the budget) stop.
        if (read >= this.options.maxBytes || /<\/title\s*>/i.test(html)) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return html;
  }
}
