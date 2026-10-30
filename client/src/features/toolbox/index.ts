import { lazy } from 'react';

export { TOOLS, availableTools, isSupported, resetSupportCache, type ToolCard } from './registry';
export { useToolState, clearToolState } from './useToolState';

/**
 * The tool bodies, code-split away from the hub. The registry (titles, icons,
 * layout) stays in the main graph because Diagon Alley renders the cards on
 * first paint; only the bodies are deferred, and they arrive as one chunk.
 * Their stylesheet (`toolbox.css`) comes with them since PLAN-41, imported by
 * `ToolBody`: Vite's preload helper resolves the import only once that
 * stylesheet has loaded, so a panel never shows a body unstyled. (It used to be
 * imported here, eagerly, for exactly that reason.)
 */
export const LazyToolBody = lazy(() =>
  import('./ToolBody').then((module) => ({ default: module.ToolBody })),
);
