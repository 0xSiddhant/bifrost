import { Component, type ReactNode } from 'react';
import { isChunkLoadError } from '../chunkError';

interface ChunkBoundaryProps {
  children: ReactNode;
  /** Told once when the lazy piece inside could not be fetched. */
  onChunkError: (error: Error) => void;
}

interface ChunkBoundaryState {
  error: Error | null;
}

/**
 * Renders nothing in place of a lazy piece of the shell whose chunk could not
 * be fetched (PLAN-40): the Guide panel in the header, the Join card on the
 * home page.
 *
 * `Suspense` covers only the wait. A rejected `import()` is thrown during
 * render, and without this it would reach `RouteBoundary` (the whole page
 * replaced by its panel) or, from the header, the app-wide `ErrorBoundary`
 * (the whole app). Here it costs that one piece instead, and the owner decides
 * what to say.
 *
 * Anything that is not a missing chunk is re-thrown, as `RouteBoundary` does,
 * so the app-wide boundary still owns reporting real render bugs. Still a
 * class component: `componentDidCatch` has no hook equivalent.
 */
export class ChunkBoundary extends Component<ChunkBoundaryProps, ChunkBoundaryState> {
  override state: ChunkBoundaryState = { error: null };

  /**
   * React re-renders synchronously after an error thrown during a concurrent
   * render, so one failed chunk reaches `componentDidCatch` twice; the owner
   * hears about it once.
   */
  private reported = false;

  static getDerivedStateFromError(error: Error): ChunkBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    if (!isChunkLoadError(error) || this.reported) return;
    this.reported = true;
    this.props.onChunkError(error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isChunkLoadError(error)) throw error;
    return null;
  }
}
