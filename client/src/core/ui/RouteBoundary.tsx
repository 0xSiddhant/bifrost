import { Component, type ReactNode } from 'react';
import { isChunkLoadError } from '../chunkError';
import { log } from '../log';
import { notify } from '../notify';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { WifiOffIcon } from './icons';

interface RouteBoundaryProps {
  children: ReactNode;
  /** Current route; a change to it clears a stale failure. */
  pathname: string;
}

interface RouteBoundaryState {
  error: Error | null;
}

/**
 * Sits between the shell and the routed pages, and exists for exactly one
 * failure: a `React.lazy` chunk that could not be fetched because the bridge is
 * unreachable (PLAN-22).
 *
 * Before this, that ended at the app-wide `ErrorBoundary` — the whole shell
 * replaced by "The bridge wavered", offering a reload the browser cannot
 * perform while offline. So one wrong click cost the user the tab, including
 * the pages they *had* warmed. Here it costs them a message instead: the
 * header, nav and every warmed page stay exactly where they were.
 *
 * Anything that is not a missing chunk is a real bug and is re-thrown, so the
 * app-wide boundary still owns reporting and the crash card. Still a class
 * component: `componentDidCatch` has no hook equivalent.
 */
export class RouteBoundary extends Component<RouteBoundaryProps, RouteBoundaryState> {
  override state: RouteBoundaryState = { error: null };

  /**
   * The message already reported for the failure currently on screen. React
   * re-renders synchronously after an error thrown during a concurrent render,
   * so one unreachable chunk reaches `componentDidCatch` twice — which without
   * this is two archive lines and a "×2" on a toast the user saw once.
   */
  private reported: string | null = null;

  static getDerivedStateFromError(error: Error): RouteBoundaryState {
    return { error };
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
    // The popup, so the answer reaches the user even before they read the page.
    notify.error(
      "That page's code hasn't been loaded into this tab, and the bridge can't be reached — you're offline, or the server is down.",
      { title: 'Not available offline', dedupeKey: 'route-unavailable' },
    );
  }

  override componentDidUpdate(previous: RouteBoundaryProps): void {
    // Navigating elsewhere clears it, so returning later re-tries the import
    // instead of showing a failure for a route that is no longer open.
    if (this.state.error && previous.pathname !== this.props.pathname) {
      this.reported = null;
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    notify.dismissKey('route-unavailable');
    // Cleared, so a retry against a bridge that is still down says so again
    // rather than silently redrawing the same panel.
    this.reported = null;
    this.setState({ error: null });
  };

  private goBack = (): void => {
    window.history.back();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isChunkLoadError(error)) throw error;

    return (
      <EmptyState
        icon={<WifiOffIcon size={24} />}
        title="Not available offline"
        hint="This page has to be fetched from the bridge, and the bridge can't be reached. Pages warmed with the Offline switch open without it."
        action={
          <div className="row">
            <Button onClick={this.retry}>Try again</Button>
            <Button variant="ghost" onClick={this.goBack}>
              Go back
            </Button>
          </div>
        }
      />
    );
  }
}
