import { Link } from 'react-router-dom';
import { pageWindow } from '../library/paging';
import { useMediaQuery } from '../useMediaQuery';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

/**
 * When the pager floats (PLAN-31): iPad-portrait width and up — the owner's
 * "iPad +" — **and** tall enough. A phone in landscape is 844×390: iPad-wide,
 * but a ~330px vertical column would cover most of that screen, so it gets the
 * inline pager like a phone in portrait does.
 */
export const FLOATING_PAGER_QUERY = '(min-width: 768px) and (min-height: 600px)';

/** Does the pager float right now? The page also needs this, for the row gutter. */
export const usePagerFloats = (): boolean => useMediaQuery(FLOATING_PAGER_QUERY);

interface PagerProps {
  page: number;
  pageCount: number;
  /** The link for page p — real `?page=` URLs, so Back and new-tab both work. */
  hrefFor: (page: number) => string;
  floating: boolean;
}

/**
 * Numbered pages: first, last, current ±1, ellipses between, prev/next arrows —
 * never more than nine controls. A vertical column fixed in the bottom-right
 * corner when `floating`, a horizontal row in the document flow otherwise.
 * Renders nothing for a single page.
 */
export function Pager({ page, pageCount, hrefFor, floating }: PagerProps) {
  if (pageCount <= 1) return null;
  const slots = pageWindow(page, pageCount);
  const orientation = floating ? 'pager--floating' : 'pager--inline';

  return (
    <nav className={`pager ${orientation}`} aria-label="Pages">
      {page > 1 ? (
        <Link className="pager__step" to={hrefFor(page - 1)} aria-label="Previous page" rel="prev">
          <ChevronLeftIcon size={16} />
        </Link>
      ) : (
        <span className="pager__step pager__step--off" aria-hidden="true">
          <ChevronLeftIcon size={16} />
        </span>
      )}
      {slots.map((slot, index) =>
        slot === 'gap' ? (
          <span className="pager__gap" aria-hidden="true" key={`gap-${index}`}>
            …
          </span>
        ) : (
          <Link
            key={slot}
            className={slot === page ? 'pager__page pager__page--on' : 'pager__page'}
            to={hrefFor(slot)}
            aria-current={slot === page ? 'page' : undefined}
            aria-label={`Page ${slot}`}
          >
            {slot}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link className="pager__step" to={hrefFor(page + 1)} aria-label="Next page" rel="next">
          <ChevronRightIcon size={16} />
        </Link>
      ) : (
        <span className="pager__step pager__step--off" aria-hidden="true">
          <ChevronRightIcon size={16} />
        </span>
      )}
    </nav>
  );
}
