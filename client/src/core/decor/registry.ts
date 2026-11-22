import type { DecorationMeta, Season } from './types';

/**
 * The installed season. `core` may not import a season (seasons import
 * `core`), so the composition root hands it over at boot (`main.tsx`, from
 * `app/season.ts`), the way `app/offlineWarmLoad.ts` hands over loaders.
 */
let installed: Season | null = null;

export function installSeason(season: Season | null): void {
  installed = season;
}

export function installedSeason(): Season | null {
  return installed;
}

/** The installed season's decorations, or none. Heimdall builds its switches from this. */
export function decorationCatalog(): readonly DecorationMeta[] {
  return installed?.decorations ?? [];
}

/** The theme token that turns a decoration on, as a 0–1 level. */
export function decorationToken(id: string): string {
  return `--decor-${id}`;
}
