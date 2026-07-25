import {
  BroomBusyError,
  bytesForMb,
  downloadTest,
  pingOnce,
  releaseGuard,
  saveResult,
  uploadTest,
  type NimbusResult,
  type ProgressFn,
  type TransferOutcome,
} from './api';
import { fraction, mbps, median } from './metrics';

/**
 * The test orchestrator: warmup → ping ×N → download → upload → save.
 *
 * Sequential on purpose. Running the directions together would measure them
 * competing with each other, and the point of the tool is to answer "how fast is
 * this corner of the house", not "what happens when I saturate it twice".
 *
 * Every network call is injected, so the whole sequence — including cancellation
 * and the busy path — is unit-testable without a server.
 */

export type Phase = 'warmup' | 'ping' | 'down' | 'up' | 'saving';

export interface TestProgress {
  phase: Phase;
  /** 0–1 through the current phase; drives the broom along its track. */
  fraction: number;
  /** Live throughput of the active transfer, null while warming up or pinging. */
  liveMbps: number | null;
  /** Filled in as each phase lands, so the result card grows during the run. */
  latencyMs: number | null;
  downMbps: number | null;
  upMbps: number | null;
}

export interface RunDeps {
  ping: (signal: AbortSignal) => Promise<number>;
  download: (mb: number, onProgress: ProgressFn, signal: AbortSignal) => Promise<TransferOutcome>;
  upload: (bytes: number, onProgress: ProgressFn, signal: AbortSignal) => Promise<TransferOutcome>;
  save: (input: {
    downMbps: number;
    upMbps: number;
    latencyMs: number;
    testMb: number;
  }) => Promise<NimbusResult>;
  release: () => Promise<void>;
}

/** Wired to the real endpoints; tests pass their own. */
export const liveDeps: RunDeps = {
  ping: (signal) => pingOnce(signal),
  download: (mb, onProgress, signal) => downloadTest({ mb, onProgress, signal }),
  upload: (bytes, onProgress, signal) => uploadTest({ bytes, onProgress, signal }),
  save: saveResult,
  release: releaseGuard,
};

/**
 * Untimed transfer before the real one. TCP starts every connection slowly and
 * ramps up; without a warmup a 10 MB test would spend a visible slice of itself
 * inside slow-start and report a link slower than the one you have.
 */
const WARMUP_MB = 1;

export interface RunOptions {
  testMb: number;
  pingSamples: number;
  signal: AbortSignal;
  onProgress: (progress: TestProgress) => void;
  deps?: RunDeps;
}

export class TestCancelled extends Error {
  constructor() {
    super('test cancelled');
    this.name = 'TestCancelled';
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof TestCancelled ||
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error && error.name === 'AbortError');

/**
 * Runs one full test and saves it. Throws `TestCancelled` if the caller aborted,
 * `BroomBusyError` if another device holds the server, and passes any other
 * failure through. The lease is released in every one of those cases — a
 * cancelled test must not make the next device wait.
 */
export async function runSpeedTest(options: RunOptions): Promise<NimbusResult> {
  const deps = options.deps ?? liveDeps;
  const { signal, testMb } = options;
  const totalBytes = bytesForMb(testMb);

  const state: TestProgress = {
    phase: 'warmup',
    fraction: 0,
    liveMbps: null,
    latencyMs: null,
    downMbps: null,
    upMbps: null,
  };
  const emit = (patch: Partial<TestProgress>) => {
    Object.assign(state, patch);
    options.onProgress({ ...state });
  };
  const abortCheck = () => {
    if (signal.aborted) throw new TestCancelled();
  };

  try {
    abortCheck();

    // Warmup — both directions, untimed, and small enough not to bore anyone.
    emit({ phase: 'warmup', fraction: 0, liveMbps: null });
    await deps.download(WARMUP_MB, () => undefined, signal);
    emit({ fraction: 0.5 });
    await deps.upload(bytesForMb(WARMUP_MB), () => undefined, signal);
    emit({ fraction: 1 });
    abortCheck();

    // Latency — N sequential round trips, reported as their median.
    emit({ phase: 'ping', fraction: 0, liveMbps: null });
    const samples: number[] = [];
    for (let index = 0; index < options.pingSamples; index += 1) {
      abortCheck();
      samples.push(await deps.ping(signal));
      // Publish the running median, not just progress: the gauge then settles
      // towards the final figure instead of showing an empty placeholder for
      // the whole phase.
      emit({ fraction: fraction(index + 1, options.pingSamples), latencyMs: median(samples) });
    }
    const latencyMs = median(samples) ?? 0;
    emit({ latencyMs });

    // Download.
    emit({ phase: 'down', fraction: 0, liveMbps: null });
    const down = await deps.download(
      testMb,
      (bytes, ms) => emit({ fraction: fraction(bytes, totalBytes), liveMbps: mbps(bytes, ms) }),
      signal,
    );
    const downMbps = mbps(down.bytes, down.ms);
    emit({ fraction: 1, downMbps, liveMbps: downMbps });
    abortCheck();

    // Upload.
    emit({ phase: 'up', fraction: 0, liveMbps: null });
    const up = await deps.upload(
      totalBytes,
      (bytes, ms) => emit({ fraction: fraction(bytes, totalBytes), liveMbps: mbps(bytes, ms) }),
      signal,
    );
    const upMbps = mbps(up.bytes, up.ms);
    emit({ fraction: 1, upMbps, liveMbps: upMbps });
    abortCheck();

    emit({ phase: 'saving', fraction: 1 });
    const result = await deps.save({ downMbps, upMbps, latencyMs, testMb });
    return result;
  } catch (error) {
    if (isAbort(error)) throw new TestCancelled();
    throw error;
  } finally {
    // Hand the guard back whatever happened — success, cancel, or crash.
    await deps.release();
  }
}

export { BroomBusyError };
