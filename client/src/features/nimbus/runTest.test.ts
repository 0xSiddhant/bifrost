import { describe, expect, it, vi } from 'vitest';
import { BroomBusyError, type NimbusResult, type TransferOutcome } from './api';
import { runSpeedTest, TestCancelled, type RunDeps, type TestProgress } from './runTest';

const MB = 1024 * 1024;

/** A transport whose transfers land instantly at a known speed. */
function fakeDeps(overrides: Partial<RunDeps> = {}): {
  deps: RunDeps;
  calls: { downloads: number[]; uploads: number[]; pings: number; releases: number };
  saved: Array<Record<string, number>>;
} {
  const calls = { downloads: [] as number[], uploads: [] as number[], pings: 0, releases: 0 };
  const saved: Array<Record<string, number>> = [];

  const transfer = (bytes: number): TransferOutcome => ({ bytes, ms: 1000 });

  const deps: RunDeps = {
    ping: async () => {
      calls.pings += 1;
      // 3 ms round trips with one spike, so the median is exercised end to end.
      return calls.pings === 3 ? 90 : 3;
    },
    download: async (mb, onProgress) => {
      calls.downloads.push(mb);
      onProgress(mb * MB * 0.5, 500);
      return transfer(mb * MB);
    },
    upload: async (bytes, onProgress) => {
      calls.uploads.push(bytes);
      onProgress(bytes * 0.5, 500);
      return transfer(bytes);
    },
    save: async (input) => {
      saved.push({ ...input });
      return { id: 1, deviceId: 'me', ...input, createdAt: 5 } as NimbusResult;
    },
    release: async () => {
      calls.releases += 1;
    },
    ...overrides,
  };
  return { deps, calls, saved };
}

const run = (
  deps: RunDeps,
  signal = new AbortController().signal,
  onProgress: (progress: TestProgress) => void = () => undefined,
) => runSpeedTest({ testMb: 10, pingSamples: 5, signal, onProgress, deps });

describe('runSpeedTest', () => {
  it('runs warmup → ping ×N → down → up → save, in that order', async () => {
    const { deps, calls, saved } = fakeDeps();
    const phases: TestProgress['phase'][] = [];

    const result = await runSpeedTest({
      testMb: 10,
      pingSamples: 5,
      signal: new AbortController().signal,
      onProgress: (progress) => {
        if (phases.at(-1) !== progress.phase) phases.push(progress.phase);
      },
      deps,
    });

    expect(phases).toEqual(['warmup', 'ping', 'down', 'up', 'saving']);
    // A small untimed warmup in both directions, then the real 10 MB test.
    expect(calls.downloads).toEqual([1, 10]);
    expect(calls.uploads).toEqual([1 * MB, 10 * MB]);
    expect(calls.pings).toBe(5);
    // 10 MiB in 1000 ms = 83.9 Mbps; latency is the median (3 ms), not the mean.
    expect(saved).toEqual([
      { downMbps: expect.closeTo(83.9, 1), upMbps: expect.closeTo(83.9, 1), latencyMs: 3, testMb: 10 },
    ]);
    expect(result.id).toBe(1);
    expect(calls.releases).toBe(1);
  });

  it('reports live throughput during a transfer and keeps landed figures', async () => {
    const { deps } = fakeDeps();
    const seen: TestProgress[] = [];
    await run(deps, new AbortController().signal, (progress) => seen.push(progress));

    const midDownload = seen.find((p) => p.phase === 'down' && p.fraction === 0.5);
    expect(midDownload?.liveMbps).toBeGreaterThan(0);
    // Once the download figure lands it stays visible through the upload phase.
    const duringUpload = seen.filter((p) => p.phase === 'up');
    expect(duringUpload.every((p) => p.downMbps !== null)).toBe(true);
    expect(seen.at(-1)?.latencyMs).toBe(3);
  });

  it('publishes a running median while pinging, not one figure at the end', async () => {
    const { deps } = fakeDeps();
    const seen: TestProgress[] = [];
    await run(deps, new AbortController().signal, (progress) => seen.push(progress));

    const pings = seen.filter((p) => p.phase === 'ping');
    // The phase opens with nothing measured yet…
    expect(pings[0]?.latencyMs).toBeNull();
    // …and the gauge has a figure from the very first round trip onwards.
    expect(pings[1]?.latencyMs).toBe(3);
    expect(pings.slice(1).every((p) => p.latencyMs !== null)).toBe(true);
    // …and the spike sample moves the running median without dominating it.
    expect(pings.at(-1)?.latencyMs).toBe(3);
  });

  it('cancels mid-download and still hands the guard back', async () => {
    const controller = new AbortController();
    const { deps, calls } = fakeDeps({
      download: async (mb) => {
        // Cancel arrives while the real (post-warmup) download is in flight.
        if (mb === 10) controller.abort();
        return { bytes: mb * MB, ms: 1000 };
      },
    });

    await expect(run(deps, controller.signal)).rejects.toBeInstanceOf(TestCancelled);
    expect(calls.uploads).toEqual([1 * MB]); // the upload leg never started
    expect(calls.releases).toBe(1);
  });

  it('translates a transport abort into TestCancelled', async () => {
    const { deps, calls } = fakeDeps({
      download: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    });
    await expect(run(deps)).rejects.toBeInstanceOf(TestCancelled);
    expect(calls.releases).toBe(1);
  });

  it('surfaces the busy server instead of reporting a corrupted number', async () => {
    const { deps, saved, calls } = fakeDeps({
      download: () => Promise.reject(new BroomBusyError()),
    });
    await expect(run(deps)).rejects.toBeInstanceOf(BroomBusyError);
    expect(saved).toEqual([]);
    expect(calls.releases).toBe(1);
  });

  it('never saves a partial test', async () => {
    const { deps, saved } = fakeDeps({
      upload: vi.fn().mockRejectedValue(new Error('network went away')),
    });
    await expect(run(deps)).rejects.toThrow('network went away');
    expect(saved).toEqual([]);
  });

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, calls } = fakeDeps();
    await expect(run(deps, controller.signal)).rejects.toBeInstanceOf(TestCancelled);
    expect(calls.downloads).toEqual([]);
  });
});
