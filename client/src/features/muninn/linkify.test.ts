import { describe, expect, it } from 'vitest';
import { linkify, opensInNewTab, type LinkifyToken } from './linkify';

function links(tokens: LinkifyToken[]): Array<{ text: string; href: string }> {
  return tokens.filter((t) => t.type === 'link').map(({ text, href }) => ({ text, href }));
}

function rejoin(tokens: LinkifyToken[]): string {
  return tokens.map((t) => t.text).join('');
}

describe('linkify', () => {
  it('returns plain text untouched', () => {
    expect(linkify('just a note about nothing')).toEqual([
      { type: 'text', text: 'just a note about nothing' },
    ]);
  });

  it('always preserves the full text across tokens', () => {
    const text = 'see https://a.com, mail me@b.org or call +1 (555) 123-4567.';
    expect(rejoin(linkify(text))).toBe(text);
  });

  it('detects http(s) urls inside text', () => {
    const text =
      'read https://tech.groww.in/improving-the-efficiency-of-rendering-user-holdings-ec2e9ccc4ca7 today';
    expect(links(linkify(text))).toEqual([
      {
        text: 'https://tech.groww.in/improving-the-efficiency-of-rendering-user-holdings-ec2e9ccc4ca7',
        href: 'https://tech.groww.in/improving-the-efficiency-of-rendering-user-holdings-ec2e9ccc4ca7',
      },
    ]);
  });

  it('trims sentence punctuation glued to a url', () => {
    expect(links(linkify('go to https://example.com/a.'))[0]?.text).toBe('https://example.com/a');
    expect(links(linkify('(see https://example.com/a)'))[0]?.text).toBe('https://example.com/a');
  });

  it('keeps balanced parentheses inside a url', () => {
    const url = 'https://en.wikipedia.org/wiki/Muninn_(raven)';
    expect(links(linkify(`ref ${url}`))[0]?.text).toBe(url);
  });

  it('detects app deeplinks (scheme://path)', () => {
    expect(links(linkify('open groww://stocks/reliance now'))).toEqual([
      { text: 'groww://stocks/reliance', href: 'groww://stocks/reliance' },
    ]);
  });

  it('detects explicit tel:, mailto: and sms: links', () => {
    expect(links(linkify('tel:+919876543210'))[0]?.href).toBe('tel:+919876543210');
    expect(links(linkify('mailto:odin@asgard.dev'))[0]?.href).toBe('mailto:odin@asgard.dev');
    expect(links(linkify('sms:+15551234567'))[0]?.href).toBe('sms:+15551234567');
  });

  it('turns bare emails into mailto links', () => {
    expect(links(linkify('ping contactsiddhant2155@gmail.com please'))).toEqual([
      { text: 'contactsiddhant2155@gmail.com', href: 'mailto:contactsiddhant2155@gmail.com' },
    ]);
  });

  it('prefixes www. and bare domains with https', () => {
    expect(links(linkify('www.example.com/x'))[0]?.href).toBe('https://www.example.com/x');
    expect(links(linkify('see groww.in/holdings'))[0]?.href).toBe('https://groww.in/holdings');
    expect(links(linkify('at bifrost.local:4646'))[0]?.href).toBe('https://bifrost.local:4646');
  });

  it('does not linkify filenames or version strings as domains', () => {
    expect(links(linkify('open MuninnPage.tsx and notes.md'))).toEqual([]);
    expect(links(linkify('bump to v1.2.3'))).toEqual([]);
  });

  it('turns phone numbers into tel links', () => {
    expect(links(linkify('call +91 98765 43210 today'))).toEqual([
      { text: '+91 98765 43210', href: 'tel:+919876543210' },
    ]);
    expect(links(linkify('office: (555) 123-4567'))[0]?.href).toBe('tel:5551234567');
    expect(links(linkify('or 9876543210'))[0]?.href).toBe('tel:9876543210');
  });

  it('does not treat dates, ips, or short numbers as phones', () => {
    expect(links(linkify('shipped on 2026-07-16'))).toEqual([]);
    expect(links(linkify('host 192.168.1.100 is up'))).toEqual([]);
    expect(links(linkify('room 12345'))).toEqual([]);
    expect(links(linkify('card 4111 1111 1111 1111'))).toEqual([]);
  });

  it('never links executable or exfiltrating schemes', () => {
    for (const bad of [
      'javascript://%0aalert(1)',
      'data://text/html;base64,x',
      'file:///etc/passwd',
      'vbscript://msgbox',
    ]) {
      expect(links(linkify(`see ${bad} here`))).toEqual([]);
    }
  });

  it('tokenizes multiple links with surrounding text', () => {
    const tokens = linkify('a https://x.com b tel:+123456789 c');
    expect(tokens.map((t) => t.type)).toEqual(['text', 'link', 'text', 'link', 'text']);
  });
});

describe('opensInNewTab', () => {
  it('is true only for web urls', () => {
    expect(opensInNewTab('https://x.com')).toBe(true);
    expect(opensInNewTab('http://x.com')).toBe(true);
    expect(opensInNewTab('tel:+123')).toBe(false);
    expect(opensInNewTab('mailto:a@b.c')).toBe(false);
    expect(opensInNewTab('groww://stocks')).toBe(false);
  });
});
