// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { outline } from './outline';
import { renderMarkdown } from './render';

describe('outline', () => {
  it('extracts the heading tree with depths and plain text', () => {
    const items = outline('# Title\n\ntext\n\n## Section **A**\n\n### Deep\n\n## Section B');
    expect(items.map((i) => [i.depth, i.text])).toEqual([
      [1, 'Title'],
      [2, 'Section A'],
      [3, 'Deep'],
      [2, 'Section B'],
    ]);
  });

  it('produces ids that match the rendered anchors, including dedup', () => {
    const md = '# Intro\n\n## Intro\n\n## Setup';
    const ids = outline(md).map((i) => i.id);
    expect(ids).toEqual(['intro', 'intro-1', 'setup']);
    const html = renderMarkdown(md);
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('gives increasing source offsets for later headings', () => {
    const items = outline('# One\n\nbody body\n\n# Two');
    expect(items).toHaveLength(2);
    expect(items[1]!.offset).toBeGreaterThan(items[0]!.offset);
  });

  it('returns nothing for heading-free text', () => {
    expect(outline('just a paragraph, no headings')).toEqual([]);
  });
});
