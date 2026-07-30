import { useEffect } from 'react';
import { getDeviceId } from '../core/deviceId';
import { notify, shouldShowForOrigin } from '../core/notify';
import { bifrostEvents } from '../core/sse';

/** One entry however many files land — a bulk move must not paper the screen. */
const DEDUPE_KEY = 'file-published';

interface FilePublished {
  name: string;
  size: number;
  publishedAt: number;
  originDeviceId: string | null;
}

/**
 * "Someone put a file on the bridge" (PLAN-17b).
 *
 * Lives at the app root, not on a page: the point is to reach a phone sitting
 * on Hermes or Nimbus, not only the two people already looking at Downloads.
 *
 * Two rules it must not break:
 *  1. **`file.published` owns the banner; `download.added` owns the listing.**
 *     Both events describe the same file — the watcher's arrives a second or
 *     two later, after chokidar's debounce — so anything that banners on the
 *     second one announces every published file twice.
 *  2. **Suppress only for the device that pressed Move**, and only when both
 *     ids are known: a client with no deviceId must still be told.
 */
export function usePublishedBanner(): void {
  useEffect(() => {
    // Reset by `onDismiss`, so a second wave starts counting from one again
    // rather than resuming a total nobody can see any more.
    let pending = 0;

    return bifrostEvents.on('file.published', (payload) => {
      const event = payload as FilePublished | null;
      if (!event?.name) return;
      if (!shouldShowForOrigin(event.originDeviceId, getDeviceId())) return;

      pending += 1;
      notify.info(
        pending === 1 ? `${event.name} is ready in Receive` : `${pending} files are ready in Receive`,
        {
          dedupeKey: DEDUPE_KEY,
          title: 'New on the bridge',
          onDismiss: () => {
            pending = 0;
          },
        },
      );
    });
  }, []);
}
