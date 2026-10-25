/**
 * Keeps a fetched list and the live (SSE) changes to it consistent.
 *
 * A page that shows a live list fetches the whole list and applies each SSE
 * change as it arrives. Replacing the list with the fetch's answer loses any
 * change that arrived while the fetch was in flight: the answer was computed
 * before the change, but delivered after it. That is how a row published
 * during a Receive refresh, or a clip posted while Hermes was loading,
 * silently vanished until a reload (found by PLAN-32a's e2e net).
 *
 * The fix: every change is recorded against every fetch still in flight and
 * replayed onto that fetch's answer, and an answer older than one already
 * applied is dropped, since it can only be staler.
 */
export type ListChange<T> = (list: T[]) => T[];

export class LiveListSync<T> {
  private readonly inFlight = new Map<number, ListChange<T>[]>();
  private nextFetch = 0;
  private lastApplied = -1;

  /** A fetch is starting; hand its id back to `settle` or `abandon`. */
  begin(): number {
    const id = this.nextFetch;
    this.nextFetch += 1;
    this.inFlight.set(id, []);
    return id;
  }

  /** A live change: recorded for every fetch in flight, and returned to apply now. */
  record(change: ListChange<T>): ListChange<T> {
    for (const changes of this.inFlight.values()) changes.push(change);
    return change;
  }

  /**
   * Fetch `id` answered `list`. Returns the list to show — the answer with
   * every change since its start replayed on top — or `null` when a newer
   * fetch has already been applied.
   */
  settle(id: number, list: T[]): T[] | null {
    const changes = this.inFlight.get(id) ?? [];
    this.inFlight.delete(id);
    if (id < this.lastApplied) return null;
    this.lastApplied = id;
    return changes.reduce((current, change) => change(current), list);
  }

  /** Fetch `id` failed: stop recording for it. */
  abandon(id: number): void {
    this.inFlight.delete(id);
  }
}
