import { createHash } from 'node:crypto';

/**
 * Download ids: deterministic, opaque, stable across restarts — same file,
 * same id. Part of the cross-module contract (DownloadEntry.id in bus
 * events); file-transfer mints them from its watcher and previews re-derives
 * them when resolving a name, so the function lives in core.
 */
export function downloadIdFor(name: string): string {
  return createHash('sha256').update(name).digest('base64url').slice(0, 16);
}

export const DOWNLOAD_ID_PATTERN = '^[A-Za-z0-9_-]{16}$';
