import { useEffect, useRef } from 'react';
import type { CursorListStatus } from '../useCursorList';
import { Button } from './Button';

/** "Showing 90 of 312", or "All 312 shown" once nothing is left to load. */
export function countLabel(loaded: number, total: number, noun: string): string {
  if (loaded < total) return `Showing ${loaded} of ${total}`;
  return total === 1 ? `1 ${noun}` : `All ${total} shown`;
}

interface LoadMoreProps {
  hasMore: boolean;
  status: CursorListStatus;
  onLoadMore: () => void;
  /** Rows currently shown — the observer re-arms after each batch lands. */
  loaded: number;
}

/**
 * The end of an infinitely scrolled list (PLAN-31).
 *
 * A sentinel watched by an `IntersectionObserver` with a 600px margin asks for
 * the next batch before the reader reaches the end. The "Load more" button is
 * not decoration: it is always there while more exists, so keyboard and
 * switch-access users never depend on scrolling, and it is the whole mechanism
 * where `IntersectionObserver` is missing. A failed batch shows "Try again" and
 * never retries on its own — a dead server is not hammered.
 */
export function LoadMore({ hasMore, status, onLoadMore, loaded }: LoadMoreProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const armed = hasMore && status === 'idle';
  useEffect(() => {
    const node = sentinel.current;
    if (!armed || !node || typeof IntersectionObserver === 'undefined') return;
    // Re-created after every batch (`loaded` changes): an observer reports the
    // current state on observe(), so a sentinel still on screen after a short
    // batch asks again instead of waiting for a scroll that may never come.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current();
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [armed, loaded]);

  if (!hasMore) return null;

  return (
    <div className="load-more">
      <div className="load-more__sentinel" ref={sentinel} aria-hidden="true" />
      {status === 'error-more' ? (
        <div className="load-more__error" role="alert">
          <span>Couldn’t load more.</span>
          <Button variant="ghost" size="sm" onClick={onLoadMore}>
            Try again
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={onLoadMore}
          disabled={status !== 'idle'}
          aria-busy={status === 'loading-more'}
        >
          {status === 'loading-more' ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
