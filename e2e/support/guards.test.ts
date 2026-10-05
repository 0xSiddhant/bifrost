import { describe, expect, it } from 'vitest';
import { isAllowed, isExternal, type Violation } from './guards.js';

describe('isExternal', () => {
  it.each([
    ['http://127.0.0.1:4646/api/health', false],
    ['http://localhost:3000/x', false],
    ['http://[::1]:80/', false],
    ['data:image/png;base64,AAAA', false],
    ['blob:http://127.0.0.1:4646/uuid', false],
    ['about:blank', false],
    ['https://fonts.googleapis.com/css', true],
    ['http://192.168.1.10:4646/', true],
    ['https://example.com/', true],
  ])('%s → %s', (url, expected) => {
    expect(isExternal(url)).toBe(expected);
  });
});

describe('isAllowed', () => {
  const failed = (url: string, detail: string): Violation => ({
    kind: 'requestfailed',
    page: '',
    url,
    detail,
  });

  it('allows the SSE stream being cancelled by a navigation', () => {
    expect(isAllowed(failed('http://127.0.0.1:1/api/events?deviceId=x', 'net::ERR_ABORTED'))).toBe(
      true,
    );
  });

  it('allows a request the page aborted itself', () => {
    expect(isAllowed(failed('http://127.0.0.1:1/api/accio?q=a', 'net::ERR_ABORTED'))).toBe(true);
    expect(isAllowed(failed('http://127.0.0.1:1/api/accio', 'cancelled'))).toBe(true);
  });

  it('does not allow a refused connection, a page error, a 5xx or an external request', () => {
    expect(isAllowed(failed('http://127.0.0.1:1/api/x', 'net::ERR_CONNECTION_REFUSED'))).toBe(
      false,
    );
    expect(isAllowed({ kind: 'pageerror', page: '', detail: 'TypeError: x is undefined' })).toBe(
      false,
    );
    expect(
      isAllowed({ kind: 'http5xx', page: '', url: 'http://127.0.0.1:1/api/x', detail: '500' }),
    ).toBe(false);
    expect(
      isAllowed({ kind: 'external', page: '', url: 'https://example.com/', detail: 'blocked' }),
    ).toBe(false);
    expect(isAllowed({ kind: 'console.error', page: '', detail: 'boom' })).toBe(false);
  });
});
