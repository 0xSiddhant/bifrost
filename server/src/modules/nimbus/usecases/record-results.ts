import type { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { NimbusListFilter, NimbusRepository, NimbusResult } from '../ports.js';

/**
 * Sanity ceiling on a reported figure. The client measures its own numbers, so
 * this is not a trust boundary against a determined poster — it is the line
 * between "a plausible LAN reading" and a value that would wreck every
 * sparkline it appears in (10 Tbps, NaN, a negative latency).
 */
const MAX_MBPS = 100_000;
const MAX_LATENCY_MS = 60_000;

export interface SaveResultInput {
  downMbps: number;
  upMbps: number;
  latencyMs: number;
  testMb: number;
  deviceId: string | null;
}

function finite(value: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new AppError(`${label} is not a plausible measurement`, 422, 'UNPROCESSABLE_ENTITY');
  }
  // Two decimals is more precision than a Wi-Fi reading deserves, and it keeps
  // the history rows readable when someone opens the DB.
  return Math.round(value * 100) / 100;
}

export class SaveResultUseCase {
  constructor(
    private readonly repo: NimbusRepository,
    private readonly bus: EventBus,
    private readonly maxTestMb: number,
    private readonly now: () => number = Date.now,
  ) {}

  execute(input: SaveResultInput): NimbusResult {
    if (!Number.isInteger(input.testMb) || input.testMb < 1 || input.testMb > this.maxTestMb) {
      throw new AppError('test size outside the configured range', 422, 'UNPROCESSABLE_ENTITY');
    }
    const result = this.repo.insert({
      deviceId: input.deviceId,
      downMbps: finite(input.downMbps, MAX_MBPS, 'download'),
      upMbps: finite(input.upMbps, MAX_MBPS, 'upload'),
      latencyMs: finite(input.latencyMs, MAX_LATENCY_MS, 'latency'),
      testMb: input.testMb,
      createdAt: this.now(),
    });
    this.bus.emit('nimbus.completed', { result });
    return result;
  }
}

export interface ListResultsInput {
  device?: string;
  limit?: number;
}

export class ListResultsUseCase {
  constructor(private readonly repo: NimbusRepository) {}

  execute(input: ListResultsInput): NimbusResult[] {
    const filter: NimbusListFilter = {
      deviceId: input.device?.trim() || undefined,
      limit: Math.min(Math.max(input.limit ?? 200, 1), 500),
    };
    return this.repo.list(filter);
  }
}

/**
 * Retention prune, on the audit policy (plan). History exists to answer "is the
 * bedroom still slow" — a reading from last spring answers nothing, and the
 * shared retention number means one setting governs all recorded activity.
 */
export class PruneResultsUseCase {
  constructor(
    private readonly repo: NimbusRepository,
    private readonly retentionDays: number,
    private readonly now: () => number = Date.now,
  ) {}

  execute(): number {
    return this.repo.deleteBefore(this.now() - this.retentionDays * 24 * 60 * 60 * 1000);
  }
}
