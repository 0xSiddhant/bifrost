import type { Season } from '../core/decor/types';
import { WINTER } from '../seasons/winter';

/**
 * The installed season: the one line that adds or removes a season's
 * decorations (snowfall, string lights, footer scene…). `null` for none.
 * Themes and relics are not affected. See `client/src/seasons/README.md`.
 */
export const SEASON: Season | null = WINTER;
