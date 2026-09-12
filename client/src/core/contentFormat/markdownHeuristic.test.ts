import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, markdownConstructCount } from './markdownHeuristic';

describe('looksLikeMarkdown', () => {
  it('matches a README-shaped document', () => {
    const readme = [
      '# Bifrost',
      '',
      'A LAN bridge for moving things between devices.',
      '',
      '- one',
      '- two',
      '',
      'See the [docs](https://example.invalid/docs).',
    ].join('\n');

    expect(looksLikeMarkdown(readme)).toBe(true);
    expect(markdownConstructCount(readme)).toBeGreaterThanOrEqual(3);
  });

  it('leaves plain prose alone', () => {
    expect(looksLikeMarkdown('Just a paragraph of ordinary writing, nothing more.')).toBe(false);
  });

  it('is not fooled by one stray asterisk in a sentence', () => {
    expect(looksLikeMarkdown('The footnote * is unmatched and means nothing here.')).toBe(false);
  });

  it('needs two distinct constructs, not one repeated', () => {
    // A changelog fragment: bullets and nothing else. Real Markdown, but weaker
    // evidence than "Open in Edda" implies, so deliberately not offered.
    expect(looksLikeMarkdown('- fixed a thing\n- fixed another thing\n')).toBe(false);
    expect(looksLikeMarkdown('# Title\n\n- fixed a thing\n')).toBe(true);
  });

  it('reads a fenced code block plus a heading as markdown', () => {
    expect(looksLikeMarkdown('## Usage\n\n```sh\nnpm run dev\n```\n')).toBe(true);
  });
});
