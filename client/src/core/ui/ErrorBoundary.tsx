import { Component, type ErrorInfo, type ReactNode } from 'react';
import { log } from '../log';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The last net under the app (PLAN-16a). Without it a render throw unmounts the
 * whole tree and leaves a white screen — no message on the device, and nothing
 * in the archive, since the failure never reached the server.
 *
 * Still a class component: `componentDidCatch` has no hook equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  // Fires once per caught error, not per re-render, so the report can't storm.
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error(`render error: ${error.message}`, {
      stack: `${error.stack ?? ''}${info.componentStack ?? ''}`,
    });
  }

  private reload = (): void => {
    // Flush first: a reload would otherwise discard the batch that explains it.
    void log.flush().finally(() => window.location.reload());
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash__panel">
          <h1 className="crash__title">The bridge wavered</h1>
          <p className="crash__body">
            Something in this page broke while rendering. The details have been sent to the
            server&rsquo;s log, so it can be looked at later.
          </p>
          <p className="crash__detail mono">{error.message}</p>
          <button type="button" className="btn btn--primary" onClick={this.reload}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
