/**
 * Rate-limited failure reporting for the OTel exporter (PLAN-16b Step 4).
 *
 * Extracted from `otel.ts` so it can be tested: that file has module-level side
 * effects by design (it must run before the app is imported).
 *
 * The bind here is real. Four distinct faults all present as "no traces
 * appear" — the `--import` was missed (silent by design), the exporter cannot
 * reach Tempo, Tempo ingests but the datasource is wrong, or sampling is
 * misconfigured. Turning diagnostics off protects the log archive but leaves no
 * way to tell them apart; leaving them on lets a dead collector retrying every
 * few seconds flood the very files this plan exists to keep readable. So: the
 * first failure is reported, then at most one per window, and the count of what
 * was swallowed rides along on the next one so nothing is quietly lost.
 */

export const FAILURE_WINDOW_MS = 5 * 60 * 1000;

export interface ReporterOptions {
  write: (line: string) => void;
  now?: () => number;
  windowMs?: number;
}

export function createRateLimitedReporter(options: ReporterOptions): (message: string) => void {
  const now = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? FAILURE_WINDOW_MS;
  let lastReported: number | null = null;
  let suppressed = 0;

  return (message: string) => {
    const at = now();
    if (lastReported !== null && at - lastReported < windowMs) {
      suppressed += 1;
      return;
    }
    // Exporter errors arrive as a whole serialized AggregateError; the first
    // line says what happened and the stack is a node-internals tour.
    const headline = message.split('\n')[0]?.slice(0, 300) ?? message;
    const extra = suppressed > 0 ? ` (${suppressed} similar suppressed)` : '';
    lastReported = at;
    suppressed = 0;
    options.write(`otel: exporter failure — ${headline}${extra}`);
  };
}
