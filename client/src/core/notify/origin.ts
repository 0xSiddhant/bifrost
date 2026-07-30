import { getDeviceId } from '../deviceId';

/**
 * Should a broadcast that originated on `originDeviceId` raise a notification
 * *here*? (PLAN-17b announces a published file to every device but the one
 * that sent it; this is the rule that decides.)
 *
 * The suppression is a UX nicety, not isolation — the event still reaches this
 * browser either way. Which is exactly why it must fail open:
 *
 * `core/sse` documents the connection's `deviceId` as "null if the client
 * didn't send one", so the obvious `origin === mine` check makes `null ===
 * null` true and silently swallows the notification on **every** client that
 * lacks an id. The failure is invisible and reads as "notifications don't work
 * sometimes". Suppress only when both ids are known and equal.
 */
export function shouldShowForOrigin(
  originDeviceId: string | null | undefined,
  myDeviceId: string | null | undefined = getDeviceId(),
): boolean {
  if (!originDeviceId || !myDeviceId) return true;
  return originDeviceId !== myDeviceId;
}
