import type { FeatureModule } from '../../core/module.js';

/**
 * Runestone (PLAN-07): JSON viewer/editor. Part A is fully client-side — the
 * server's only job is exposing the document-size cap so the client never
 * hardcodes it. Part B adds the saved-document library (routes + DB) here.
 */
export const runestoneModule: FeatureModule = {
  name: 'runestone',
  register(app, deps) {
    app.get('/api/runestone/config', () => ({
      maxDocKb: deps.config.runestone.maxDocKb,
    }));
  },
};
