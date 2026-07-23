import type { FeatureModule } from '../../core/module.js';

/**
 * Loki (PLAN-12): the JavaScript workbench — transforms, a regex tester, and
 * (Part B) sandboxed execution. Every transform and the regex tester run as
 * pure client compute, and Part B's runner is a client-side Web Worker, so the
 * server side is capability-only: being in the manifest is what puts the page
 * in /api/capabilities and therefore the Ollivanders nav card.
 *
 * Registered in BOTH profiles so transforms/regex are available everywhere.
 * Part B's execution UI is gated client-side on `capabilities.profile ===
 * 'local'` (a module in both profiles can't advertise a sub-capability), so the
 * runner is never reachable in the cloud profile.
 */
export const lokiModule: FeatureModule = {
  name: 'loki',
  register() {
    // No routes, no tables, no events — presence in the manifest is the feature.
  },
};
