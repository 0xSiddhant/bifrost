import { NotificationStore, type NotifyOptions } from './store';

/** The app-wide stack. One per page — `<NotificationHost/>` renders it. */
export const notifications = new NotificationStore();

/**
 * The imperative handle. Deliberately not a hook: a notification is raised
 * from event handlers, promise rejections, and (in 17b) the SSE layer — none
 * of which are React components, and all of which would otherwise need a
 * context they cannot reach.
 *
 *   notify.error('Upload failed', { dedupeKey: `upload:${file.name}` })
 */
export const notify = {
  info: (message: string, options?: NotifyOptions): number =>
    notifications.push('info', message, options),
  ok: (message: string, options?: NotifyOptions): number =>
    notifications.push('ok', message, options),
  /** Errors stay until dismissed — one that vanishes unread is worse than none. */
  error: (message: string, options?: NotifyOptions): number =>
    notifications.push('error', message, options),
  dismiss: (id: number): void => notifications.dismiss(id),
  /** Clear whatever is standing under a dedupe key; `true` if there was one. */
  dismissKey: (dedupeKey: string): boolean => notifications.dismissKey(dedupeKey),
};
