import { describe, expect, it } from 'vitest';
import {
  isAllowed,
  isExternal,
  isNavigationCancelShaped,
  NAVIGATION_CANCEL_WINDOW_MS,
  NavigationCancels,
  type Violation,
} from './guards.js';

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

describe('navigation cancels (WebKit)', () => {
  // The exact shapes CI's WebKit reported, including Playwright splitting the
  // message at the URL's colon.
  const fetchCancel: Violation = {
    kind: 'pageerror',
    page: 'http://127.0.0.1:46257/edda/x',
    detail: 'Fetch API cannot load http: /127.0.0.1:46257/api/edda/x due to access control checks.',
  };
  const importCancel: Violation = {
    kind: 'console.error',
    page: 'http://127.0.0.1:36455/pensieve?type=runestone',
    detail: 'TypeError: Importing a module script failed.',
  };

  it('recognises only the two WebKit shapes, and only for loopback fetches', () => {
    expect(isNavigationCancelShaped(fetchCancel)).toBe(true);
    expect(isNavigationCancelShaped(importCancel)).toBe(true);
    expect(
      isNavigationCancelShaped({
        ...fetchCancel,
        detail: 'Fetch API cannot load https://example.com/x due to access control checks.',
      }),
    ).toBe(false);
    expect(isNavigationCancelShaped({ ...importCancel, kind: 'http5xx' })).toBe(false);
    expect(isNavigationCancelShaped({ ...fetchCancel, detail: 'TypeError: x is undefined' })).toBe(
      false,
    );
  });

  it('explains a cancel that lands just after a navigation starts', () => {
    const page = {};
    const cancels = new NavigationCancels<object>();
    cancels.navigated(page, 1_000);
    expect(cancels.offer(page, fetchCancel, 1_200)).toBe(true);
    expect(cancels.unexplained()).toEqual([]);
  });

  it('explains a held cancel once the navigation comes, or the page closes', () => {
    const page = {};
    const cancels = new NavigationCancels<object>();
    expect(cancels.offer(page, importCancel, 1_000)).toBe(false);
    cancels.navigated(page, 1_500);
    expect(cancels.unexplained()).toEqual([]);
  });

  it('keeps a cancel no navigation explains, or one on another page, or one too old', () => {
    const page = {};
    const other = {};
    const cancels = new NavigationCancels<object>();
    cancels.offer(page, fetchCancel, 1_000);
    cancels.offer(other, importCancel, 1_000);
    cancels.navigated(other, 1_000 + NAVIGATION_CANCEL_WINDOW_MS + 1);
    cancels.navigated(page, 9_000);
    expect(cancels.unexplained()).toEqual([fetchCancel, importCancel]);
    expect(cancels.offer(page, fetchCancel, 9_000 + NAVIGATION_CANCEL_WINDOW_MS + 1)).toBe(false);
  });
});
