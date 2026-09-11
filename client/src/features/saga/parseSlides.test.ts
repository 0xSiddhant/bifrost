import { describe, expect, it } from 'vitest';
import { parseSlides } from './parseSlides';

describe('parseSlides (PLAN-28)', () => {
  it('splits on a --- line and trims each slide', () => {
    const slides = parseSlides('# One\n\n---\n\n# Two\n\n---\n\n# Three');
    expect(slides.map((slide) => slide.body)).toEqual(['# One', '# Two', '# Three']);
  });

  it('does not split on a --- that is the document’s literal first line', () => {
    // Acceptance 3: a front-matter-shaped opening must not produce an empty
    // leading slide. The dashes stay in the first slide's own body.
    const slides = parseSlides('---\ntitle: Deck\n---\n\n# Real first slide');
    expect(slides).toHaveLength(2);
    expect(slides[0]?.body).toBe('---\ntitle: Deck');
    expect(slides[1]?.body).toBe('# Real first slide');
  });

  it('treats a longer rule the same way CommonMark does', () => {
    expect(parseSlides('a\n-----\nb')).toHaveLength(2);
  });

  it('ignores a --- with other content on the line', () => {
    expect(parseSlides('a\n--- not a break\nb')).toHaveLength(1);
  });

  it('drops slides that are empty or only whitespace', () => {
    expect(parseSlides('# One\n\n---\n\n   \n\n---\n\n# Two')).toHaveLength(2);
    expect(parseSlides('')).toEqual([]);
    // Not empty: the first line is content by the rule above, so this is one
    // slide holding a thematic break rather than three empty ones.
    expect(parseSlides('---\n---\n---')).toEqual([{ body: '---', notes: null }]);
  });

  it('extracts a notes comment and strips it from the body', () => {
    const [slide] = parseSlides('# Title\n\n<!-- notes: say hello slowly -->\n\nBody text');
    expect(slide?.notes).toBe('say hello slowly');
    expect(slide?.body).not.toContain('notes:');
    expect(slide?.body).toContain('Body text');
  });

  it('reads notes case-insensitively and across lines, joining several', () => {
    const [slide] = parseSlides('# T\n<!-- NOTES:\n  first line\n  second line\n-->\n<!-- notes: and again -->');
    expect(slide?.notes).toBe('first line\n  second line\n\nand again');
  });

  it('leaves an unrelated HTML comment alone', () => {
    const [slide] = parseSlides('# T\n<!-- just a comment -->');
    expect(slide?.notes).toBeNull();
    expect(slide?.body).toContain('just a comment');
  });

  it('reports no notes rather than an empty string for a slide without one', () => {
    expect(parseSlides('# Only a title')[0]?.notes).toBeNull();
  });

  /**
   * Pinned as-is, not as a bug to chase: fixing it needs a fence-aware scanner
   * tracking open/close state across the whole document, for a case that is
   * rare in practice. Deckrun has the identical documented caveat. If this test
   * ever fails, the parser gained fence awareness — update it deliberately.
   */
  it('KNOWN CAVEAT: a --- inside a fenced code block still splits', () => {
    const slides = parseSlides('# One\n\n```yaml\nkey: value\n---\nother: value\n```');
    expect(slides).toHaveLength(2);
  });

  it('handles CRLF line endings', () => {
    expect(parseSlides('# One\r\n\r\n---\r\n\r\n# Two')).toHaveLength(2);
  });
});
