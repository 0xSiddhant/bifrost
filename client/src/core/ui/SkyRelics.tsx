import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RELIC_COLLECTIONS, type Relic } from '../../assets/relics';
import { getEnabledCollections, onRelicPrefsChange } from '../relicPrefs';

/**
 * Scatters a few random relics through the sky layer — a different handful
 * on every page and every reload, drawn from the collections enabled in
 * Heimdall. Pure atmosphere: faint, behind everything, collision-free,
 * invisible to screen readers and pointers.
 */

interface Placement {
  relic: Relic;
  leftPx: number;
  topPx: number;
  size: number;
  rotate: number;
  tone: string;
  duration: number;
  delay: number;
}

function pool(): Relic[] {
  return getEnabledCollections().flatMap((name) => [...RELIC_COLLECTIONS[name].relics]);
}

/** Rejection-sample positions so no two relics overlap (circle test + margin). */
function seed(): Placement[] {
  const relics = pool();
  if (relics.length === 0) return [];

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const count = Math.min(6 + Math.floor(Math.random() * 4), relics.length); // 6–9
  const placements: Placement[] = [];
  const usedIndexes = new Set<number>();

  for (let i = 0; i < count; i++) {
    let relicIndex = Math.floor(Math.random() * relics.length);
    while (usedIndexes.has(relicIndex)) relicIndex = Math.floor(Math.random() * relics.length);

    const size = 56 + Math.random() * 84;
    let leftPx = 0;
    let topPx = 0;
    let placed = false;

    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      // bias toward the margins so relics rarely sit under running text
      const edge = Math.random() < 0.7;
      const leftPct = edge
        ? Math.random() < 0.5
          ? Math.random() * 14
          : 84 + Math.random() * 12
        : 15 + Math.random() * 70;
      const topPct = 8 + Math.random() * 80;
      leftPx = (leftPct / 100) * vw;
      topPx = (topPct / 100) * vh;
      placed = placements.every((other) => {
        const dx = leftPx + size / 2 - (other.leftPx + other.size / 2);
        const dy = topPx + size / 2 - (other.topPx + other.size / 2);
        const minGap = (size + other.size) / 2 + 24;
        return dx * dx + dy * dy > minGap * minGap;
      });
    }
    if (!placed) continue; // sky is crowded here — drop this relic rather than overlap

    usedIndexes.add(relicIndex);
    const relic = relics[relicIndex];
    if (!relic) continue;
    placements.push({
      relic,
      leftPx,
      topPx,
      size,
      rotate: -24 + Math.random() * 48,
      tone: ['muted', 'teal', 'violet'][i % 3] as string,
      duration: 10 + Math.random() * 9,
      delay: -Math.random() * 10,
    });
  }
  return placements;
}

export function SkyRelics() {
  const { pathname } = useLocation();
  const [prefsVersion, setPrefsVersion] = useState(0);

  // Heimdall's relic setting applies immediately, no reload needed
  useEffect(() => onRelicPrefsChange(() => setPrefsVersion((v) => v + 1)), []);

  // re-seed per route and per prefs change; Math.random() varies every reload
  const placements = useMemo(seed, [pathname, prefsVersion]);

  return (
    <>
      {placements.map((p, i) => {
        const RelicArt = p.relic;
        return (
          <span
            key={`${pathname}-${prefsVersion}-${i}`}
            className={`relic relic--${p.tone}`}
            style={{
              left: p.leftPx,
              top: p.topPx,
              width: p.size,
              height: p.size,
              transform: `rotate(${p.rotate}deg)`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
            }}
          >
            <RelicArt width="100%" height="100%" />
          </span>
        );
      })}
    </>
  );
}
