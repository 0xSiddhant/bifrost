import type { ComponentType } from 'react';

/**
 * Seasonal decorations: plug-in UI that comes and goes with the season
 * (winter's snowfall, string lights and snowy footer today; something else
 * next spring), as opposed to themes and relics, which stay. A season lives
 * in its own folder under `client/src/seasons/`, and the app installs at
 * most one (`app/season.ts`). Nothing in the shell names a decoration: the
 * shell has three slots, and a season fills them.
 */

/**
 * Where a decoration can appear. Each is a `DecorSlot` the shell renders once:
 * - `sky`: inside the fixed `.sky` layer, behind every card, over the relics;
 * - `header`: right after the sticky header, in `.shell` (a decoration there
 *   positions itself; `--header-h` is the header's height);
 * - `footer`: inside `.shell-footer`, which is its containing block
 *   (`position: relative`), with the 48 px `.shell-main` leaves above it free.
 */
export type DecorSlotName = 'sky' | 'header' | 'footer';

/** What the shell and Heimdall may know about a decoration: no component. */
export interface DecorationMeta {
  /** Unique within the season, `a-z0-9-`. A theme turns it on with the token `--decor-<id>`. */
  id: string;
  slot: DecorSlotName;
  /** Heimdall's label for its per-device switch. */
  label: string;
  /** One sentence under the switch. */
  description: string;
  /** True when a device may switch it off (Heimdall → Sky Relics). */
  switchable: boolean;
  /** Extra words Heimdall's search finds the switch by. */
  keywords?: readonly string[];
}

/** The decorations' components, by id, from the season's lazily loaded chunk. */
export type DecorationComponents = Readonly<Record<string, ComponentType>>;

/** A season: its manifest, and a loader for its components' chunk. */
export interface Season {
  id: string;
  label: string;
  decorations: readonly DecorationMeta[];
  load: () => Promise<DecorationComponents>;
}
