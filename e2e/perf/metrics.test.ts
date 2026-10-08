import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bucketQuantile,
  parseExposition,
  parsePsRss,
  requestHistograms,
  snapshotOf,
} from './metrics.js';

// A real `/metrics` exposition, recorded from the built server after four requests.
const fixture = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'metrics.txt'),
  'utf8',
);

describe('parseExposition', () => {
  it('reads names, labels and values, and skips comments', () => {
    const samples = parseExposition(fixture);
    expect(samples.length).toBeGreaterThan(100);
    expect(samples.some((sample) => sample.name.startsWith('#'))).toBe(false);
    const health = samples.find(
      (sample) =>
        sample.name === 'bifrost_http_request_duration_seconds_count' &&
        sample.labels.route === '/api/health',
    );
    expect(health).toEqual({
      name: 'bifrost_http_request_duration_seconds_count',
      labels: { route: '/api/health', method: 'GET', status: '200' },
      value: 2,
    });
  });

  it('reads +Inf, escaped label values and exponent notation', () => {
    const samples = parseExposition(
      ['x_bucket{le="+Inf",path="a\\"b"} 3', 'y 1.5e-7', 'z{a="1"} NaN 1700000000000'].join('\n'),
    );
    expect(samples[0]).toEqual({ name: 'x_bucket', labels: { le: '+Inf', path: 'a"b' }, value: 3 });
    expect(samples[1]!.value).toBeCloseTo(1.5e-7);
    expect(Number.isNaN(samples[2]!.value)).toBe(true);
  });
});

describe('snapshotOf', () => {
  it('picks the figures the report needs', () => {
    const snapshot = snapshotOf(parseExposition(fixture), 1234);
    expect(snapshot.atMs).toBe(1234);
    expect(snapshot.rssBytes).toBe(207138816);
    expect(snapshot.heapUsedBytes).toBe(89903248);
    expect(snapshot.heapTotalBytes).toBeGreaterThan(snapshot.heapUsedBytes);
    expect(snapshot.eventLoopLagP99Seconds).toBeCloseTo(0.023642111);
    expect(snapshot.activeHandles).toBe(15);
    expect(snapshot.openFds).toBe(35);
    expect(snapshot.gcSecondsTotal).toBeGreaterThan(0);
    expect(snapshot.sseClients).toBe(0);
  });

  it('names the metric it cannot find', () => {
    expect(() => snapshotOf([], 0)).toThrow(/bifrost_process_resident_memory_bytes/);
  });
});

describe('requestHistograms', () => {
  it('groups buckets per route, method and status, in ascending order', () => {
    const histograms = requestHistograms(parseExposition(fixture));
    const health = histograms.find((histogram) => histogram.route === '/api/health');
    expect(health).toMatchObject({ method: 'GET', status: '200', count: 2 });
    expect(health!.buckets.at(-1)).toEqual([Infinity, 2]);
    expect(health!.buckets.map(([bound]) => bound)).toEqual(
      [...health!.buckets.map(([bound]) => bound)].sort((a, b) => a - b),
    );
    expect(health!.sumSeconds).toBeGreaterThan(0);
  });

  it('places a quantile in its bucket', () => {
    const histogram = {
      route: '/r',
      method: 'GET',
      status: '200',
      count: 10,
      sumSeconds: 1,
      buckets: [
        [0.005, 2],
        [0.01, 9],
        [0.1, 10],
        [Infinity, 10],
      ] as [number, number][],
    };
    expect(bucketQuantile(histogram, 0.5)).toBe(0.01);
    expect(bucketQuantile(histogram, 0.99)).toBe(0.1);
    expect(bucketQuantile({ ...histogram, count: 0 }, 0.5)).toBeNull();
  });
});

describe('parsePsRss', () => {
  it('reads ps kilobytes as bytes, and a gone process as null', () => {
    expect(parsePsRss('  51234\n')).toBe(51234 * 1024);
    expect(parsePsRss('')).toBeNull();
    expect(parsePsRss('\n')).toBeNull();
  });
});
