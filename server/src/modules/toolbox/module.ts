import type { FeatureModule } from '../../core/module.js';

/**
 * Toolbox (PLAN-18): the small utilities that expand in place on Diagon Alley —
 * Base64, UUID, epoch, the QR generator and the rest. Every one of them is pure
 * client compute (no bytes leave the browser), so like `variant` this module is
 * capability-only: its `register()` is a deliberate no-op and being in the
 * manifest is what puts the tools in /api/capabilities, and therefore on the
 * hub. Registered in both profiles; it exists so a future cloud deployment can
 * drop the toolbox without a client change.
 *
 * Note this is NOT the QR tool's module — `qr-tool` still owns
 * GET /api/qr/server-url, which Midgard's Join card depends on. Only the
 * standalone /sigil page became a tool here.
 */
export const toolboxModule: FeatureModule = {
  name: 'toolbox',
  register() {
    // No routes, no tables, no events — presence in the manifest is the feature.
  },
};
