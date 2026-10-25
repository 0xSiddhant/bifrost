import { useEffect, useState } from 'react';

/** Read a media query from JS where it is absent (jsdom, very old engines). */
function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/**
 * A media query as live React state — for layout decisions that change what is
 * rendered or which classes other elements carry, not just how one looks
 * (PLAN-31's floating pager also reserves a gutter on the rows beside it).
 */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatch(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return match;
}
