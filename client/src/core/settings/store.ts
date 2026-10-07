import { log } from '../log';
import { bifrostEvents } from '../sse';
import { sanitize, type SettingsArea } from './rules';

/**
 * One settings layer, two stores (PLAN-35), so Heimdall's sections and the
 * code that reads their values (Nótt, Loki's run gate, the open gesture) are
 * written once:
 *
 * - **HubSettingsStore**: the existing API calls, and the existing SSE event
 *   for live updates. Behaviour-identical to before; the hub journeys prove it.
 * - **LocalSettingsStore**: this browser's `localStorage`, for the standalone
 *   site, which has no server to hold settings for it.
 */
export interface SettingsStore<T> {
  load(): Promise<T>;
  save(patch: Partial<T>): Promise<T>;
  /** Called with the new value when it changes elsewhere (another device, another tab). */
  subscribe(listener: (value: T) => void): () => void;
}

/** The stored envelope: versioned, so a later format migrates old values instead of resetting them. */
interface Stored {
  v: 1;
  values: unknown;
}

const PREFIX = 'bifrost.local.';

/**
 * Device-local settings under `bifrost.local.<area>`. What comes back from
 * `localStorage` is untrusted: an older format, a hand edit, or nothing at all
 * (Safari's private mode throws on access; storage can be cleared). So every
 * read is validated field by field against the server's own rules, anything
 * missing or invalid takes its build-time default, and a throwing store means
 * "the defaults", never a crash.
 */
export class LocalSettingsStore<T extends object> implements SettingsStore<T> {
  private readonly key: string;

  constructor(
    private readonly area: SettingsArea,
    /**
     * Every field, from the build-time `.env` defaults. A field with no rule
     * (the bounds a control clamps to) always keeps its value here.
     */
    private readonly defaults: T,
    private readonly storage: () => Storage = () => window.localStorage,
  ) {
    this.key = `${PREFIX}${area}`;
  }

  load(): Promise<T> {
    return Promise.resolve(this.read());
  }

  save(patch: Partial<T>): Promise<T> {
    const next = sanitize(this.area, { ...this.read(), ...patch }, this.defaults);
    try {
      this.storage().setItem(this.key, JSON.stringify({ v: 1, values: next } satisfies Stored));
    } catch (error) {
      // Private mode or a full store: the change holds for this page only.
      log.warn(`settings: could not save ${this.area} in this browser`, {
        module: 'settings',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
    return Promise.resolve(next);
  }

  /** Another tab saved: the browser's `storage` event keeps every open tab in step. */
  subscribe(listener: (value: T) => void): () => void {
    const onStorage = (event: StorageEvent) => {
      if (event.key === this.key || event.key === null) listener(this.read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  read(): T {
    let raw: string | null = null;
    try {
      raw = this.storage().getItem(this.key);
    } catch {
      // Deliberately silent: no store at all (Safari private mode) is the
      // designed "defaults" case, not a failure, and it fires on every read.
    }
    return sanitize(this.area, migrate(parse(raw)), this.defaults);
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Deliberately silent: a corrupted value is the per-field default case.
    return null;
  }
}

/**
 * The stored envelope's values, migrated to the current version. Version 1 is
 * the only one yet; a v2 adds its step here rather than resetting what people
 * chose. Anything unversioned or from the future is treated as nothing stored.
 */
export function migrate(stored: unknown): unknown {
  if (stored === null || typeof stored !== 'object') return null;
  const envelope = stored as Partial<Stored>;
  if (envelope.v === 1) return envelope.values;
  return null;
}

/**
 * The hub's settings: read and patch through the module's own routes, and
 * follow its SSE broadcast so open pages rebind live.
 */
export class HubSettingsStore<T> implements SettingsStore<T> {
  constructor(
    private readonly fetch: () => Promise<T>,
    private readonly patch: (patch: Partial<T>) => Promise<T>,
    private readonly event: string,
    /** How a broadcast payload becomes the value (most send the whole thing). */
    private readonly fromEvent: (payload: unknown, current: T | null) => T | null = (payload) =>
      payload as T,
  ) {}

  private last: T | null = null;

  async load(): Promise<T> {
    this.last = await this.fetch();
    return this.last;
  }

  async save(patch: Partial<T>): Promise<T> {
    this.last = await this.patch(patch);
    return this.last;
  }

  subscribe(listener: (value: T) => void): () => void {
    return bifrostEvents.on(this.event, (payload) => {
      const next = this.fromEvent(payload, this.last);
      if (next === null) return;
      this.last = next;
      listener(next);
    });
  }
}
