import type { DecorationComponents } from '../../core/decor/types';
import { FooterScene } from './FooterScene';
import { Snowfall } from './Snowfall';
import { StringLights } from './StringLights';

/** Winter's decorations by the ids its manifest (`index.ts`) declares. Its own chunk. */
export const WINTER_COMPONENTS: DecorationComponents = {
  snowfall: Snowfall,
  'string-lights': StringLights,
  'footer-scene': FooterScene,
};
