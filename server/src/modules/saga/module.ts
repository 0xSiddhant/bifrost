import type { FeatureModule } from '../../core/module.js';

/**
 * Saga (PLAN-28): the fullscreen slideshow over a saved Edda or a dropped `.md`
 * file. Every part of it is client compute — `renderMarkdown` is the same pure
 * function Edda's own surfaces already feed from, and the two content sources
 * are an existing endpoint (`GET /api/edda/:slug`) and an object URL that never
 * leaves the browser — so like `toolbox` and `variant` this module is
 * capability-only: its `register()` is a deliberate no-op, and being in the
 * manifest is what puts `saga` in /api/capabilities and therefore the card on
 * Midgard and the "Present" action on Pensieve's Edda rows.
 *
 * Registered in both profiles: it adds no route, reads no disk and holds no
 * state, so there is nothing here a cloud deployment would need to withhold.
 * It exists so one can be dropped without a client change.
 */
export const sagaModule: FeatureModule = {
  name: 'saga',
  register() {
    // No routes, no tables, no events — presence in the manifest is the feature.
  },
};
