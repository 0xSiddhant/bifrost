import { describe, expect, it } from 'vitest';
import { normalizeTarget, TARGET_MAX_LENGTH } from './target.js';

describe('normalizeTarget', () => {
  it('keeps an explicit http(s) target', () => {
    expect(normalizeTarget('http://192.168.1.1/admin')).toBe('http://192.168.1.1/admin');
    expect(normalizeTarget('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('defaults a scheme-less host to https', () => {
    expect(normalizeTarget('example.com')).toBe('https://example.com/');
    expect(normalizeTarget('nas.local/photos')).toBe('https://nas.local/photos');
  });

  it('treats host:port as a scheme-less LAN address, not a scheme', () => {
    expect(normalizeTarget('192.168.1.4:8080')).toBe('https://192.168.1.4:8080/');
    expect(normalizeTarget('localhost:3000/app')).toBe('https://localhost:3000/app');
  });

  it('allows any host — router, NAS, localhost, the internet', () => {
    for (const raw of [
      'http://router',
      'http://10.0.0.1',
      'http://localhost:9000',
      'https://news.ycombinator.com',
    ]) {
      expect(normalizeTarget(raw), raw).not.toBeNull();
    }
  });

  it('rejects non-web schemes (the open-redirect / XSS primitives)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>1</script>',
      'vbscript:msgbox',
      'mailto:a@b.com',
      'ftp://host/file',
      'chrome://flags',
    ]) {
      expect(normalizeTarget(bad), bad).toBeNull();
    }
  });

  it('rejects empty, whitespace-bearing, and over-long targets', () => {
    expect(normalizeTarget('')).toBeNull();
    expect(normalizeTarget('   ')).toBeNull();
    expect(normalizeTarget('http://a b.com')).toBeNull();
    expect(normalizeTarget(`https://x.com/${'a'.repeat(TARGET_MAX_LENGTH)}`)).toBeNull();
  });
});
