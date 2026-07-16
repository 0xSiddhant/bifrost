/**
 * A stable per-browser device id (PLAN-06). Generated once and cached in
 * localStorage — the same allowed class as the theme choice. Sent as the SSE
 * `deviceId` query param (presence) and the `X-Bifrost-Device` header (clipboard
 * attribution). Not a security token; just a friendly handle.
 */
const KEY = 'bifrost.deviceId';

function generate(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // crypto.randomUUID needs a secure context; plain LAN http may block it.
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let cached: string | null = null;

export function getDeviceId(): string {
  if (cached) return cached;
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
    if (!id) {
      id = generate();
      localStorage.setItem(KEY, id);
    }
  } catch {
    // localStorage unavailable (private mode) — fall back to an in-memory id.
    id = id ?? generate();
  }
  cached = id;
  return id;
}
