import { describe, expect, it } from 'vitest';
import { decodeJwt, verdictLabel } from './jwt';
import { encodeBase64 } from './base64';

/** Build a token the way a real issuer would, so the tests decode real input. */
function makeToken(header: unknown, payload: unknown, signature = 'c2lnbmF0dXJl'): string {
  const part = (value: unknown) => encodeBase64(JSON.stringify(value), 'url-safe');
  return `${part(header)}.${part(payload)}.${signature}`;
}

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const seconds = (ms: number) => Math.floor(ms / 1000);

describe('decodeJwt', () => {
  it('decodes header, payload and signature', () => {
    const token = makeToken({ alg: 'HS256', typ: 'JWT' }, { sub: 'device-7', name: 'Bifrost' });
    const view = decodeJwt(token, NOW);

    expect(view.error).toBeNull();
    expect(view.alg).toBe('HS256');
    expect(view.typ).toBe('JWT');
    expect(JSON.parse(view.payload as string)).toEqual({ sub: 'device-7', name: 'Bifrost' });
    expect(view.signature).toBe('c2lnbmF0dXJl');
  });

  it('reads unpadded base64url, which is the only form a JWT comes in', () => {
    // A payload whose base64 needs padding — proof normalizeBase64 is doing its job.
    const token = makeToken({ alg: 'none' }, { a: 1 });
    expect(token).not.toContain('=');
    expect(decodeJwt(token, NOW).error).toBeNull();
  });

  it('survives payloads with non-ASCII claims', () => {
    const token = makeToken({ alg: 'HS256' }, { name: 'Þórr 🌉' });
    expect(JSON.parse(decodeJwt(token, NOW).payload as string).name).toBe('Þórr 🌉');
  });

  it('renders exp/iat/nbf and calls an expired token expired', () => {
    const token = makeToken(
      { alg: 'HS256' },
      { iat: seconds(NOW - 3600_000), exp: seconds(NOW - 60_000) },
    );
    const view = decodeJwt(token, NOW);
    expect(view.times.map((t) => t.name)).toEqual(['iat', 'exp']);
    expect(view.verdict).toBe('expired');
    expect(verdictLabel(view.verdict)).toBe('Expired');
  });

  it('calls a live token unexpired — never "valid", since nothing was verified', () => {
    const token = makeToken({ alg: 'HS256' }, { exp: seconds(NOW + 3600_000) });
    const view = decodeJwt(token, NOW);
    expect(view.verdict).toBe('valid');
    expect(verdictLabel(view.verdict)).toBe('Unexpired');
    expect(verdictLabel(view.verdict)).not.toMatch(/\bvalid\b/i);
  });

  it('honours nbf in the future', () => {
    const token = makeToken(
      { alg: 'HS256' },
      { nbf: seconds(NOW + 600_000), exp: seconds(NOW + 3600_000) },
    );
    expect(decodeJwt(token, NOW).verdict).toBe('not-yet-valid');
  });

  it('says so when there is no expiry claim at all', () => {
    const view = decodeJwt(makeToken({ alg: 'HS256' }, { sub: 'x' }), NOW);
    expect(view.verdict).toBe('no-expiry');
    expect(view.times).toEqual([]);
  });

  it('accepts the two-segment unsecured form', () => {
    const token = makeToken({ alg: 'none' }, { sub: 'x' }).split('.').slice(0, 2).join('.');
    const view = decodeJwt(token, NOW);
    expect(view.error).toBeNull();
    expect(view.signature).toBe('');
  });

  it('reports a wrong segment count instead of throwing', () => {
    expect(decodeJwt('a.b.c.d', NOW).error).toMatch(/three dot-separated parts/);
    expect(decodeJwt('nodots', NOW).error).toMatch(/three dot-separated parts/);
    // Two segments is the right *shape* (unsecured form), so the complaint
    // moves to the content rather than the count.
    expect(decodeJwt('just.one', NOW).error).toMatch(/header/);
  });

  it('names which half is broken', () => {
    const good = makeToken({ alg: 'HS256' }, { sub: 'x' });
    const [header, , signature] = good.split('.');
    expect(decodeJwt(`${header}.@@@@.${signature}`, NOW).error).toMatch(/payload/);
    expect(decodeJwt(`@@@@.${good.split('.')[1]}.${signature}`, NOW).error).toMatch(/header/);
  });

  it('keeps the header when only the payload is broken', () => {
    const good = makeToken({ alg: 'HS256', typ: 'JWT' }, { sub: 'x' });
    const view = decodeJwt(`${good.split('.')[0]}.notjson.sig`, NOW);
    expect(view.alg).toBe('HS256');
    expect(view.payload).toBeNull();
  });

  it('treats empty input as empty, not as an error', () => {
    const view = decodeJwt('   ', NOW);
    expect(view.error).toBeNull();
    expect(view.header).toBeNull();
  });

  it('ignores a non-numeric exp rather than inventing a verdict', () => {
    const view = decodeJwt(makeToken({ alg: 'HS256' }, { exp: 'soon' }), NOW);
    expect(view.verdict).toBe('no-expiry');
    expect(view.times).toEqual([]);
  });
});
