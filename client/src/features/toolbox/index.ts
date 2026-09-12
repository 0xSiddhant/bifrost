import { lazy } from 'react';
// Eager on purpose: the panel styles ship in the main CSS bundle so opening a
// tool costs exactly one lazy chunk and no unstyled flash inside the panel.
import './toolbox.css';

export { TOOLS, availableTools, isSupported, resetSupportCache, type ToolCard } from './registry';
export { useToolState, clearToolState } from './useToolState';

/**
 * The tool bodies, code-split away from the hub. The registry (titles, icons,
 * layout) stays in the main graph because Diagon Alley renders the cards on
 * first paint; only the bodies are deferred, and they arrive as one chunk.
 */
export const LazyToolBody = lazy(() =>
  import('./ToolBody').then((module) => ({ default: module.ToolBody })),
);
