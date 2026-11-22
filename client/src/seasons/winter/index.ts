import type { Season } from '../../core/decor/types';

/**
 * Winter: snow falling behind every page, Christmas lights under the header,
 * and a snowy footer with Santa's sleigh riding by. Each shows in a theme
 * that turns it on (`--decor-<id>`; Yule turns on all three) and reads its
 * colours from the theme (`--decor-snow`, `--decor-snow-rim`, the core roles).
 *
 * This file is the season's manifest and holds no component: the shell and
 * Heimdall read it at boot, and the decorations themselves load in one chunk
 * (`components.ts`) once the browser is idle. To take winter out, remove its
 * import from `app/season.ts`, point `SEASON` at another season (or `null`)
 * and delete this folder; no other code names it (see
 * `client/src/seasons/README.md`).
 */
export const WINTER: Season = {
  id: 'winter',
  label: 'Winter',
  decorations: [
    {
      id: 'snowfall',
      slot: 'sky',
      label: 'Snowfall',
      description: "Falls in a theme that has snow (Yule). Off keeps this device's sky still.",
      switchable: true,
      keywords: ['snow', 'winter', 'yule', 'motion', 'sky'],
    },
    {
      id: 'string-lights',
      slot: 'header',
      label: 'String lights',
      description: 'Christmas lights under the header.',
      switchable: false,
    },
    {
      id: 'footer-scene',
      slot: 'footer',
      label: 'Snowy footer',
      description: "Snow, pines and Santa's sleigh along the footer.",
      switchable: false,
    },
  ],
  load: () => import('./components').then((module) => module.WINTER_COMPONENTS),
};
