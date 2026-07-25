import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type {
  NewNimbusResult,
  NimbusListFilter,
  NimbusRepository,
  NimbusResult,
} from '../ports.js';
import { ListResultsUseCase, PruneResultsUseCase, SaveResultUseCase } from './record-results.js';

/** In-memory stand-in for the Drizzle repo — usecases only know the interface. */
class FakeRepo implements NimbusRepository {
  readonly rows: NimbusResult[] = [];
  private nextId = 1;

  insert(result: NewNimbusResult): NimbusResult {
    const row = { ...result, id: this.nextId++ };
    this.rows.push(row);
    return row;
  }
  list(filter: NimbusListFilter): NimbusResult[] {
    return this.rows
      .filter((row) => !filter.deviceId || row.deviceId === filter.deviceId)
      .slice()
      .reverse()
      .slice(0, filter.limit);
  }
  deleteBefore(ts: number): number {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if ((this.rows[i]?.createdAt ?? 0) < ts) this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
}

let repo: FakeRepo;
let bus: EventBus;

beforeEach(() => {
  repo = new FakeRepo();
  bus = new EventBus();
});

const save = (maxTestMb = 100) => new SaveResultUseCase(repo, bus, maxTestMb, () => 5_000);

const good = {
  downMbps: 312.456,
  upMbps: 128.4,
  latencyMs: 3.2,
  testMb: 50,
  deviceId: 'device-alpha',
};

describe('SaveResultUseCase', () => {
  it('stores a result, rounds it, and announces it', () => {
    const seen = vi.fn();
    bus.on('nimbus.completed', seen);

    const result = save().execute(good);

    expect(result).toEqual({
      id: 1,
      deviceId: 'device-alpha',
      // Two decimals — more precision than a Wi-Fi reading deserves.
      downMbps: 312.46,
      upMbps: 128.4,
      latencyMs: 3.2,
      testMb: 50,
      createdAt: 5_000,
    });
    expect(seen).toHaveBeenCalledWith({ result });
  });

  it('refuses a test size the server never offered', () => {
    expect(() => save(50).execute({ ...good, testMb: 100 })).toThrow(AppError);
    expect(() => save().execute({ ...good, testMb: 0 })).toThrow(AppError);
    expect(() => save().execute({ ...good, testMb: 10.5 })).toThrow(AppError);
    expect(repo.rows).toHaveLength(0);
  });

  it('refuses implausible measurements rather than poisoning the history', () => {
    for (const bad of [
      { downMbps: Number.NaN },
      { upMbps: Infinity },
      { latencyMs: -1 },
      { downMbps: 500_000 },
      { latencyMs: 120_000 },
    ]) {
      expect(() => save().execute({ ...good, ...bad })).toThrow(AppError);
    }
    expect(repo.rows).toHaveLength(0);
  });

  it('keeps an anonymous result rather than dropping it', () => {
    // A device that never sent an id still gets its number recorded; only the
    // per-device grouping is lost.
    expect(save().execute({ ...good, deviceId: null }).deviceId).toBeNull();
  });
});

describe('ListResultsUseCase', () => {
  beforeEach(() => {
    save().execute(good);
    save().execute({ ...good, deviceId: 'device-beta', downMbps: 90 });
  });

  it('lists every device by default, newest first', () => {
    const rows = new ListResultsUseCase(repo).execute({});
    expect(rows.map((row) => row.deviceId)).toEqual(['device-beta', 'device-alpha']);
  });

  it('filters to one device', () => {
    const rows = new ListResultsUseCase(repo).execute({ device: 'device-alpha' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceId).toBe('device-alpha');
  });

  it('bounds the limit', () => {
    expect(new ListResultsUseCase(repo).execute({ limit: 1 })).toHaveLength(1);
    // A hostile or fat-fingered limit can't ask for the whole table.
    expect(new ListResultsUseCase(repo).execute({ limit: 100_000 })).toHaveLength(2);
  });
});

describe('PruneResultsUseCase', () => {
  it('drops results older than the retention window', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    repo.insert({ ...good, createdAt: now - 91 * day });
    repo.insert({ ...good, createdAt: now - 2 * day });

    const pruned = new PruneResultsUseCase(repo, 90, () => now).execute();

    expect(pruned).toBe(1);
    expect(repo.rows).toHaveLength(1);
  });
});
