/**
 * JWT decoding (PLAN-18).
 *
 * **Decoding only — nothing here verifies a signature**, and the panel says so
 * in as many words. Verification needs the key, no key material belongs in a
 * browser tool on a LAN, and a green panel that a reader takes as "this token
 * is valid" would be worse than no tool at all.
 */
import { decodeBase64 } from './base64';

export type ExpiryVerdict = 'valid' | 'expired' | 'not-yet-valid' | 'no-expiry';

export interface JwtTimeClaim {
  name: 'exp' | 'iat' | 'nbf';
  seconds: number;
  iso: string;
  local: string;
  relative: string;
}

export interface JwtView {
  header: string | null;
  payload: string | null;
  signature: string;
  /** `alg`/`typ` lifted out of the header for the summary line. */
  alg: string | null;
  typ: string | null;
  times: JwtTimeClaim[];
  verdict: ExpiryVerdict;
  /** Set when the token could not be read; every other field is best-effort. */
  error: string | null;
}

function decodeSegment(segment: string): unknown {
  // A JWT segment is base64url without padding — normalizeBase64 (shared with
  // the Base64 tool) already accepts exactly that.
  return JSON.parse(decodeBase64(segment)) as unknown;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : null;
}

function readSeconds(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'number' && Number.isFinite(found) ? found : null;
}

const EMPTY: JwtView = {
  header: null,
  payload: null,
  signature: '',
  alg: null,
  typ: null,
  times: [],
  verdict: 'no-expiry',
  error: null,
};

export function decodeJwt(
  token: string,
  now: number = Date.now(),
  formatTime: (ms: number) => string = (ms) => new Date(ms).toString(),
  formatRelative: (ms: number, now: number) => string = (ms) => new Date(ms).toISOString(),
): JwtView {
  const text = token.trim();
  if (!text) return EMPTY;

  const segments = text.split('.');
  // Two segments is the unsecured (`alg: none`) form, whose signature is empty.
  if (segments.length !== 3 && segments.length !== 2) {
    return { ...EMPTY, error: 'A JWT has three dot-separated parts — this has ' + segments.length + '.' };
  }
  const [headerSegment = '', payloadSegment = '', signature = ''] = segments;

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeSegment(headerSegment);
  } catch {
    return { ...EMPTY, signature, error: 'The header is not valid base64url-encoded JSON.' };
  }
  try {
    payload = decodeSegment(payloadSegment);
  } catch {
    return {
      ...EMPTY,
      header: pretty(header),
      alg: readString(header, 'alg'),
      typ: readString(header, 'typ'),
      signature,
      error: 'The payload is not valid base64url-encoded JSON.',
    };
  }

  const times: JwtTimeClaim[] = [];
  for (const name of ['iat', 'nbf', 'exp'] as const) {
    const seconds = readSeconds(payload, name);
    if (seconds === null) continue;
    const ms = seconds * 1000;
    times.push({
      name,
      seconds,
      iso: new Date(ms).toISOString(),
      local: formatTime(ms),
      relative: formatRelative(ms, now),
    });
  }

  const exp = readSeconds(payload, 'exp');
  const nbf = readSeconds(payload, 'nbf');
  let verdict: ExpiryVerdict = 'no-expiry';
  if (exp !== null && exp * 1000 <= now) verdict = 'expired';
  else if (nbf !== null && nbf * 1000 > now) verdict = 'not-yet-valid';
  else if (exp !== null) verdict = 'valid';

  return {
    header: pretty(header),
    payload: pretty(payload),
    signature,
    alg: readString(header, 'alg'),
    typ: readString(header, 'typ'),
    times,
    verdict,
    error: null,
  };
}

/**
 * The wording shown beside the verdict. "Unexpired", never "valid" — the tool
 * has not checked the signature and must not imply that it has.
 */
export function verdictLabel(verdict: ExpiryVerdict): string {
  switch (verdict) {
    case 'expired':
      return 'Expired';
    case 'not-yet-valid':
      return 'Not valid yet (nbf is in the future)';
    case 'valid':
      return 'Unexpired';
    default:
      return 'No expiry claim';
  }
}
