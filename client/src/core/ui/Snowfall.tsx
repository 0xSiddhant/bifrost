import { useSnowfallEnabled, useThemeOptIn } from './useThemeOptIn';
import './snowfall.css';

/**
 * Snow falling behind every page, in a theme that turns it on with
 * `--snow-alpha` (the Yule world), unless this device switched it off in
 * Heimdall → Sky Relics. Three depth layers of flakes, each painted once and
 * moved by `transform` on the compositor (snowfall.css). Not rendered at all
 * otherwise, so no other theme runs its animations.
 */
export function Snowfall() {
  const level = useThemeOptIn('--snow-alpha');
  const enabled = useSnowfallEnabled();
  if (level === 0 || !enabled) return null;
  return (
    <div className="snowfall" aria-hidden="true">
      {(['far', 'mid', 'near'] as const).map((depth) => (
        <div key={depth} className={`snowfall__sway snowfall__sway--${depth}`}>
          <div className={`snowfall__layer snowfall__layer--${depth}`} />
        </div>
      ))}
    </div>
  );
}
