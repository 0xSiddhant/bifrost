import { EventEmitter } from 'node:events';
import type { BifrostEventMap, BifrostEventName } from './events.js';

export type { BifrostEventMap, BifrostEventName } from './events.js';

/**
 * Typed in-process event bus — the ONLY channel for cross-module
 * communication (see architecture rule 2).
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Modules subscribe independently; don't warn at 10+ listeners.
    this.emitter.setMaxListeners(100);
  }

  emit<K extends BifrostEventName>(event: K, payload: BifrostEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  /** Returns an unsubscribe function. */
  on<K extends BifrostEventName>(
    event: K,
    handler: (payload: BifrostEventMap[K]) => void,
  ): () => void {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
