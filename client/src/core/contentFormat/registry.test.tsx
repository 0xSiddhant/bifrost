// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { availableFormats, CONTENT_FORMATS, detectFormat } from './registry';

const kindOf = (text: string) => detectFormat(text)?.kind ?? null;

describe('detectFormat', () => {
  it('reads a JSON object or array as JSON', () => {
    expect(kindOf('{"a": 1, "b": [2, 3]}')).toBe('json');
    expect(kindOf('[1, 2, 3]')).toBe('json');
  });

  it('refuses a bare JSON scalar, which is valid JSON but nothing to open', () => {
    for (const scalar of ['"hello"', '42', 'true', 'null']) {
      expect(kindOf(scalar), scalar).not.toBe('json');
    }
  });

  it('reads a real XML document as XML', () => {
    expect(kindOf('<?xml version="1.0"?><root><child a="1"/></root>')).toBe('xml');
  });

  it('does not read broken XML as XML', () => {
    expect(kindOf('<root><child></root>')).not.toBe('xml');
  });

  it('reads a YAML mapping or sequence as YAML', () => {
    expect(kindOf('name: bifrost\nport: 4646\n')).toBe('yaml');
    expect(kindOf('- one\n- two\n')).toBe('yaml');
  });

  it('sends JSON-shaped content to Runestone even though it is also valid YAML', () => {
    // The whole reason the registry order is rigid → fuzzy.
    expect(kindOf('{"a": 1}')).toBe('json');
  });

  it('reads a real markdown document as markdown', () => {
    // Prose is what settles it: a paragraph makes the YAML root a plain scalar,
    // which the YAML entry already refuses, so this reaches the markdown test.
    const readme = '# Bifrost\n\nA LAN bridge for devices.\n\n- one\n- two\n';
    expect(kindOf(readme)).toBe('markdown');
    // A fenced block fails the YAML parse outright, which is the other way
    // real markdown reaches this entry.
    expect(kindOf('## Usage\n\n```sh\nnpm run dev\n```\n')).toBe('markdown');
  });

  it('offers nothing at all for content it does not recognise', () => {
    expect(kindOf('2026-09-05 10:00:00 INFO  something happened, then something else')).toBeNull();
    expect(kindOf('')).toBeNull();
  });

  it('documents the accepted false positives rather than pretending them away', () => {
    // A chat log written `Name: message` per line really is a YAML mapping.
    expect(kindOf('alice: are you there\nbob: yes\n')).toBe('yaml');
    // And a markdown document of nothing but a heading and bullets really is a
    // YAML sequence with a comment on top — the plan named the JSON/YAML
    // overlap, and this is the second one, resolved by the same rule: the
    // entry with a real parser behind it wins over the heuristic.
    expect(kindOf('# Notes\n\n- first\n- second\n')).toBe('yaml');
  });

  it('seeds the matched tool, so no feature imports another', () => {
    const entry = detectFormat('{"a": 1}');
    entry?.seed('{"a": 1}');
    expect(sessionStorage.getItem('bifrost.runestone.seed')).toContain('\\"a\\"');
    expect(entry?.route).toBe('/runestone');
  });
});

describe('availableFormats', () => {
  it('drops the formats this profile does not serve', () => {
    const loaded = new Set(['runestone', 'edda']);
    const offered = availableFormats(CONTENT_FORMATS, (module) => loaded.has(module));
    expect(offered.map((entry) => entry.kind)).toEqual(['json', 'markdown']);
  });
});
