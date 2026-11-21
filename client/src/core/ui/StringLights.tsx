import { useThemeOptIn } from './useThemeOptIn';
import './string-lights.css';

/**
 * A strand of Christmas lights hanging below the header at the top of every
 * page, in a theme that turns it on with `--lights-alpha` (the Yule world).
 * It sits in the empty space every page leaves under the header and scrolls
 * away under it, so it never covers text, nor Accio's and Portkey's bars that
 * park below the sticky header. The bulbs are the theme's own accent,
 * accent-2, ok and warn colours, one layer per colour, each twinkling by
 * opacity alone. Not rendered at all in a theme without it.
 */
export function StringLights() {
  const level = useThemeOptIn('--lights-alpha');
  if (level === 0) return null;
  return (
    <div className="string-lights" aria-hidden="true">
      <span className="string-lights__wire" />
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`string-lights__bulbs string-lights__bulbs--${n}`} />
      ))}
    </div>
  );
}
