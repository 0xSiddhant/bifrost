import { describe, expect, it } from 'vitest';
import { createRateLimitedReporter } from './otel-report.js';

function harness(windowMs = 300_000) {
  const written: string[] = [];
  let clock = 0;
  const report = createRateLimitedReporter({
    write: (line) => written.push(line),
    now: () => clock,
    windowMs,
  });
  return { written, report, advance: (ms: number) => (clock += ms) };
}

describe('rate-limited exporter reporting', () => {
  // The positive half matters as much as the negative one: a mute
  // implementation would pass "does not flood" trivially, and leave four
  // different faults looking identical.
  it('reports the first failure immediately', () => {
    const h = harness();
    h.report('ECONNREFUSED');
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toContain('otel: exporter failure');
    expect(h.written[0]).toContain('ECONNREFUSED');
  });

  it('collapses a burst inside the window into that one line', () => {
    const h = harness();
    for (let i = 0; i < 50; i += 1) {
      h.advance(1000);
      h.report('ECONNREFUSED');
    }
    expect(h.written).toHaveLength(1);
  });

  it('reports again after the window, saying how many it swallowed', () => {
    const h = harness();
    h.report('ECONNREFUSED');
    for (let i = 0; i < 9; i += 1) {
      h.advance(1000);
      h.report('ECONNREFUSED');
    }
    h.advance(300_000);
    h.report('ECONNREFUSED');

    expect(h.written).toHaveLength(2);
    expect(h.written[1]).toContain('9 similar suppressed');
  });

  it('does not claim suppression when there was none', () => {
    const h = harness();
    h.report('first');
    h.advance(300_000);
    h.report('second');
    expect(h.written[1]).not.toContain('suppressed');
  });

  // Exporter errors arrive as a serialized AggregateError whose stack is a tour
  // of node internals — useless in a boot log and long enough to bury the line
  // that matters.
  it('keeps only the headline of a multi-line error', () => {
    const h = harness();
    h.report('AggregateError [ECONNREFUSED]: connect failed\n    at internalConnectMultiple (node:net:1135:18)');
    expect(h.written[0]).toContain('AggregateError [ECONNREFUSED]: connect failed');
    expect(h.written[0]).not.toContain('node:net');
  });

  it('truncates a single enormous line rather than writing it whole', () => {
    const h = harness();
    h.report('x'.repeat(5000));
    expect(h.written[0]?.length).toBeLessThan(400);
  });
});
