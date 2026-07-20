import type { FeatureModule } from '../../core/module.js';

/**
 * Variant (PLAN-08): the JSON & text diff checker. Every comparison runs as
 * pure client compute, so the server side is capability-only — being in the
 * manifest is what puts the page in /api/capabilities and therefore the nav.
 * Registered in both profiles; the client hides its runestone library picker
 * on its own when that capability is absent (cloud-profile ready).
 */
export const variantModule: FeatureModule = {
  name: 'variant',
  register() {
    // No routes, no tables, no events — presence in the manifest is the feature.
  },
};
