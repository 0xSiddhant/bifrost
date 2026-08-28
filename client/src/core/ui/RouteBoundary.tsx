import { Component, type ReactNode } from 'react';
import { isChunkLoadError } from '../chunkError';
import { log } from '../log';
import { notify } from '../notify';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { WifiOffIcon } from './icons';

/** Cheap, exists in both deploy profiles, and says nothing but "I am here". */
const HEALTH_URL = '/api/health';
/** A vanished host never refuses, so the probe needs its own patience limit. */
const PROBE_TIMEOUT_MS = 3_000;
/** How often to ask again while the panel is up and the bridge is down. */
const PROBE_INTERVAL_MS = 5_000;

interface RouteBoundaryProps {
  children: ReactNode;
  /** Current route; a change to it clears a stale failure. */
  pathname: string;
  /** Bumped by the app when it rebuilds the lazy pages; clears the failure. */
  retryToken: number;
  /** Ask the app for fresh `lazy` payloads — a cached rejection is forever. */
  onRetry: () => void;
}

interface RouteBoundaryState {
  error: Error | null;
  /**
   * Is the server answering *right now*? Decides which way out we can offer,
   * so it is measured rather than inferred — see `probeBridge`.
   */
  bridgeUp: boolean;
}

/**
 * Sits between the shell and the routed pages, and exists for one failure: a
 * `React.lazy` chunk that could not be fetched because the bridge is
 * unreachable (PLAN-22).
 *
 * Before this, that ended at the app-wide `ErrorBoundary` — the whole shell
 * replaced by "The bridge wavered", offering a reload the browser cannot
 * perform while offline. So one wrong click cost the user the tab, including
 * the pages they *had* warmed. Here it costs them a message instead: the
 * header, nav and every warmed page stay exactly where they were.
 *
 * **Why the way out depends on whether the bridge is up.** A module URL that
 * fails to fetch is recorded as failed in the document's module map, and every
 * later `import()` of that same URL rejects from the map without touching the
 * network — verified in Chromium, and the reason a plain retry can look like it
 * does nothing. Rebuilding the `lazy` payload still recovers the case where our
 * own timeout fired but the fetch landed a moment later (the map holds a
 * *fulfilled* entry, so the retry resolves with no request), which is what a
 * slow bridge looks like. It cannot recover a genuine fetch failure: only a
 * reload can, because only a new document gets a new module map. So while the
 * bridge is down we offer the retry, and once it answers again we say plainly
 * that this page needs a reload.
 *
 * Anything that is not a missing chunk is re-thrown, so the app-wide boundary
 * still owns reporting and the crash card. Still a class component:
 * `componentDidCatch` has no hook equivalent.
 */
export class RouteBoundary extends Component<RouteBoundaryProps, RouteBoundaryState> {
  override state: RouteBoundaryState = { error: null, bridgeUp: false };

  /**
   * The message already reported for the failure currently on screen. React
   * re-renders synchronously after an error thrown during a concurrent render,
   * so one unreachable chunk reaches `componentDidCatch` twice — which without
   * this is two archive lines and a "×2" on a toast the user saw once.
   */
  private reported: string | null = null;

  private poll: ReturnType<typeof setInterval> | null = null;

  private mounted = false;

  static getDerivedStateFromError(error: Error): Partial<RouteBoundaryState> {
    return { error };
  }

  override componentDidMount(): void {
    this.mounted = true;
  }

  override componentWillUnmount(): void {
    this.mounted = false;
    this.stopWatching();
  }

  /**
   * While the panel is up and the bridge is down, keep asking.
   *
   * The obvious signal — the SSE reconnecting — is both indirect and slow: its
   * backoff runs to 15s, and an EventSource keeps reporting `open` for seconds
   * after the network has gone. Asking the server itself, on a short cycle, is
   * what makes "I came back" feel like coming back.
   */
  private startWatching(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      void this.probeBridge().then((bridgeUp) => {
        if (!this.mounted || !bridgeUp) return;
        this.stopWatching();
        this.setState({ bridgeUp });
        // One free attempt: if the chunk had merely timed out, the fetch has
        // landed by now and a fresh payload resolves from the module map with
        // no request at all. If it truly failed, we land back here with the
        // bridge known to be up, and the panel says so.
        this.props.onRetry();
      });
    }, PROBE_INTERVAL_MS);
  }

  private stopWatching(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  /**
   * Ask the server directly whether it is there.
   *
   * The SSE status is the obvious signal and the wrong one: an EventSource that
   * has not yet failed still reports `open` seconds after the network went
   * away, which had the panel telling a freshly-offline user that the bridge
   * was back and to reload — the one action that would cost them the tab. One
   * small request answers the question the panel is actually asking, and it
   * only ever runs on a failure.
   */
  private async probeBridge(): Promise<boolean> {
    try {
      const response = await fetch(HEALTH_URL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      // Any failure here *is* the answer: unreachable. Nothing to report — the
      // chunk failure it accompanies is already logged.
      return false;
    }
  }

  override componentDidCatch(error: Error): void {
    // Only ours. A real render error is re-thrown from render() and reported by
    // the app-wide boundary; logging it here too would double every crash.
    if (!isChunkLoadError(error)) return;
    if (this.reported === error.message) return;
    this.reported = error.message;
    // warn, not error: an unreachable server is a condition, not a defect. It
    // still belongs in the archive — it is the difference between "the hub was
    // down" and "the hub was up and the page was broken".
    log.warn(`route chunk unavailable: ${error.message}`, { module: 'offline-mode' });
    void this.probeBridge().then((bridgeUp) => {
      if (!this.mounted) return;
      this.setState({ bridgeUp });
      if (!bridgeUp) this.startWatching();
      // Raised after the probe so the popup and the panel say the same thing.
      notify.error(
        bridgeUp
          ? "The bridge is back, but this page's code has to be fetched again. Reload to open it."
          : "That page's code hasn't been loaded into this tab, and the bridge can't be reached — you're offline, or the server is down.",
        {
          title: bridgeUp ? 'This page needs a reload' : 'Not available offline',
          dedupeKey: 'route-unavailable',
        },
      );
    });
  }

  override componentDidUpdate(previous: RouteBoundaryProps): void {
    // Navigating elsewhere clears it, so returning later re-tries the import
    // instead of showing a failure for a route that is no longer open. A new
    // retryToken means the app has rebuilt the pages, so the same is true.
    const moved = previous.pathname !== this.props.pathname;
    const rebuilt = previous.retryToken !== this.props.retryToken;
    if (this.state.error && (moved || rebuilt)) {
      this.reported = null;
      this.stopWatching();
      if (rebuilt) notify.dismissKey('route-unavailable');
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    // The app owns the retry: React caches a lazy rejection for the life of the
    // payload, so clearing this boundary alone would re-throw the same error
    // without re-fetching anything. The rebuild comes back as a new retryToken,
    // which is what actually clears the panel (see componentDidUpdate).
    this.props.onRetry();
  };

  private reload = (): void => {
    // Flush first: a reload would otherwise discard the batch that explains it.
    void log.flush().finally(() => window.location.reload());
  };

  private goBack = (): void => {
    window.history.back();
  };

  override render(): ReactNode {
    const { error, bridgeUp } = this.state;
    if (!error) return this.props.children;
    if (!isChunkLoadError(error)) throw error;

    return (
      <EmptyState
        icon={<WifiOffIcon size={24} />}
        title={bridgeUp ? 'This page needs a reload' : 'Not available offline'}
        hint={
          bridgeUp
            ? "The bridge is back, but the browser remembers this page's code failing and will not fetch it again in this tab. A reload will."
            : "This page has to be fetched from the bridge, and the bridge can't be reached. Pages warmed with the Offline switch open without it."
        }
        action={
          <div className="row">
            {bridgeUp ? (
              <Button onClick={this.reload}>Reload the page</Button>
            ) : (
              <Button onClick={this.retry}>Try again</Button>
            )}
            <Button variant="ghost" onClick={this.goBack}>
              Go back
            </Button>
          </div>
        }
      />
    );
  }
}
