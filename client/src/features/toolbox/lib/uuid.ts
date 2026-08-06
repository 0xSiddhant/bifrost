/**
 * UUID v4 and v7, built from `crypto.getRandomValues` (PLAN-18).
 *
 * Deliberately NOT `crypto.randomUUID()`: that lives on the same
 * secure-context-only surface as `crypto.subtle`, so it is `undefined` on
 * every device reaching Bifrost over plain LAN http — everywhere except the
 * host Mac at localhost. `getRandomValues` has no such restriction.
 * `core/deviceId.ts` already carries this exact fallback; this is the second
 * place that has to know it, not the first.
 */

export type UuidVersion = 'v4' | 'v7';

/** 16 bytes → canonical 8-4-4-4-12 form. */
export function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/** Stamp the RFC 4122 version nibble and the two variant bits in place. */
export function stampVersion(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | (version << 4);
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function uuidV4(): string {
  return formatUuid(stampVersion(randomBytes(16), 4));
}

/**
 * v7: 48-bit big-endian Unix milliseconds, then version/variant, then random.
 * Sorts by creation time as a string, which is why anyone picks it over v4.
 */
export function uuidV7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = Math.max(0, Math.trunc(now));
  // Split rather than shift: bit ops in JS are 32-bit, and 48 bits is not.
  const high = Math.floor(ms / 0x100000000);
  const low = ms >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  return formatUuid(stampVersion(bytes, 7));
}

export function generateUuids(version: UuidVersion, count: number, uppercase: boolean): string[] {
  const total = Math.min(100, Math.max(1, Math.trunc(count) || 1));
  const make = version === 'v7' ? () => uuidV7() : uuidV4;
  return Array.from({ length: total }, () => (uppercase ? make().toUpperCase() : make()));
}

/** Milliseconds encoded in a v7 UUID — how the tool proves the ordering claim. */
export function timestampFromV7(uuid: string): number | null {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex) || hex.charAt(12).toLowerCase() !== '7') return null;
  return Number.parseInt(hex.slice(0, 12), 16);
}
