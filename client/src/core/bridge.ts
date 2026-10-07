/**
 * "The Bifröst is closed" (PLAN-35): the one signal behind the sheet. Two
 * things raise it:
 *
 * - **standalone**: a hub-only action (a stub in `core/api.ts`), or a deep
 *   link to a hub-only page;
 * - **hub**: a request that never reached the server (`HubUnreachableError`).
 *
 * `core/api.ts` raises it and `core/ui/BridgeClosed.tsx` listens, so neither
 * imports the other. A page with a local alternative raises it again with a
 * `download` action, which the sheet merges into the one already showing.
 */

export type BridgeClosedReason = 'standalone' | 'unreachable';

export interface BridgeClosedRequest {
  reason: BridgeClosedReason;
  /** "Download instead": the page's local answer to the action that failed. */
  download?: () => void;
}

type Listener = (request: BridgeClosedRequest) => void;

const listeners = new Set<Listener>();

export function onBridgeClosed(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showBridgeClosed(request: BridgeClosedRequest): void {
  for (const listener of listeners) listener(request);
}

/**
 * Go to a hub-only page (the Pensieve, Brotli): in the hub build, navigate; on
 * the standalone site, open the sheet over the page instead, so the document
 * on screen is still there when it closes.
 */
export function hubNavigate(navigate: (to: string) => unknown, to: string): void {
  if (__HUB__) void navigate(to);
  else showBridgeClosed({ reason: 'standalone' });
}
