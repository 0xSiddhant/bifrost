export type SseStatus = 'connecting' | 'open' | 'closed';

type StatusListener = (status: SseStatus) => void;
type EventListener = (payload: unknown) => void;

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;

/**
 * Thin wrapper over EventSource for the app-wide `/api/events` stream.
 * EventSource reconnects transient drops natively; this adds typed
 * subscriptions, status reporting, and backoff re-open after hard closes.
 */
export class BifrostEvents {
  private source: EventSource | null = null;
  private retryTimer: number | null = null;
  private retryAttempt = 0;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly eventListeners = new Map<string, Set<EventListener>>();

  /** Current status snapshot — late subscribers (route changes) start from truth. */
  get status(): SseStatus {
    if (!this.source) return 'closed';
    return this.source.readyState === EventSource.OPEN ? 'open' : 'connecting';
  }

  connect(): void {
    if (this.source) return;
    this.setStatus('connecting');
    this.source = new EventSource('/api/events');
    this.source.onopen = () => {
      this.retryAttempt = 0;
      this.setStatus('open');
    };
    this.source.onerror = () => {
      // CONNECTING means EventSource is retrying by itself; only take over
      // once the browser gives up entirely.
      if (this.source?.readyState === EventSource.CLOSED) {
        this.teardown();
        this.scheduleReconnect();
      } else {
        this.setStatus('connecting');
      }
    };
    for (const event of this.eventListeners.keys()) this.attach(event);
  }

  on(event: string, listener: EventListener): () => void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
      this.attach(event);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.teardown();
  }

  private attach(event: string): void {
    this.source?.addEventListener(event, (message) => {
      const listeners = this.eventListeners.get(event);
      if (!listeners) return;
      let payload: unknown = null;
      try {
        payload = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        // non-JSON payloads delivered as null
      }
      for (const listener of listeners) listener(payload);
    });
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.retryAttempt, RETRY_MAX_MS);
    this.retryAttempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private teardown(): void {
    this.source?.close();
    this.source = null;
    this.setStatus('closed');
  }

  private setStatus(status: SseStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}

export const bifrostEvents = new BifrostEvents();
