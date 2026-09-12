import { describe, expect, it } from 'vitest';
import { CliError } from './output.js';
import { looksLikeFilePath, PREVIEWABLE_EXTENSIONS, routeLocalFile } from './preview.js';

describe('preview routing table (PLAN-28)', () => {
  describe('telling a file path from a document slug', () => {
    it('reads a path as a path', () => {
      expect(looksLikeFilePath('./deck.md')).toBe(true);
      expect(looksLikeFilePath('/tmp/deck.md')).toBe(true);
      expect(looksLikeFilePath('decks/talk.markdown')).toBe(true);
      expect(looksLikeFilePath('~/deck.md')).toBe(true);
      expect(looksLikeFilePath('deck.md')).toBe(true);
    });

    it('reads a bare filename with ANY extension as a path', () => {
      // The regression this file did not have: every path in the tests above is
      // absolute or dotted, so `data.json` alone fell through to slug
      // resolution and answered with the wrong error. Live-verify caught it.
      expect(looksLikeFilePath('data.json')).toBe(true);
      expect(looksLikeFilePath('slides.pdf')).toBe(true);
      expect(looksLikeFilePath('notes.txt')).toBe(true);
      expect(looksLikeFilePath('archive.tar')).toBe(true);
    });

    it('leaves PLAN-27’s bare slugs alone', () => {
      // A slug is a bare memorable word; nothing here may start resolving as a
      // file, or `preview <slug>` would stop working.
      expect(looksLikeFilePath('sublime-usecase-ueyqid')).toBe(false);
      expect(looksLikeFilePath('alpha-notes-e1')).toBe(false);
      expect(looksLikeFilePath('notes')).toBe(false);
      // A trailing group of digits is an id, not an extension.
      expect(looksLikeFilePath('release-1.2.3-abc123')).toBe(false);
    });
  });

  describe('destinations', () => {
    it('routes a markdown file to Saga under --type saga', () => {
      const destination = routeLocalFile('deck.md', 'saga');
      expect(destination.id).toBe('saga');
      expect(destination.clientPath('http://127.0.0.1:5000/payload')).toBe(
        '/saga?source=http%3A%2F%2F127.0.0.1%3A5000%2Fpayload',
      );
    });

    it('accepts .markdown as well as .md, case-insensitively', () => {
      expect(routeLocalFile('DECK.MARKDOWN', 'saga').id).toBe('saga');
    });

    it('refuses --type saga on a .json, naming what saga does accept', () => {
      // Acceptance 12: refused in the terminal before any browser is opened or
      // any server started — this function runs before either.
      expect(() => routeLocalFile('data.json', 'saga')).toThrow(CliError);
      expect(() => routeLocalFile('data.json', 'saga')).toThrow(/markdown/);
      expect(() => routeLocalFile('data.json', 'saga')).toThrow(/\.md, \.markdown, \.pdf/);
    });

    it('routes a PDF to Saga with no --type at all (PLAN-29)', () => {
      // Markdown needs the flag because a second destination for it is planned;
      // a PDF has exactly one thing `preview` can do with it, so asking a
      // presenter to choose from a list of one would be ceremony.
      const destination = routeLocalFile('slides.pdf');
      expect(destination.id).toBe('saga');
      expect(destination.clientPath('http://127.0.0.1:5000/payload')).toBe(
        '/saga?source=http%3A%2F%2F127.0.0.1%3A5000%2Fpayload',
      );
    });

    it('accepts --type saga on a PDF too, case-insensitively', () => {
      expect(routeLocalFile('SLIDES.PDF', 'saga').id).toBe('saga');
    });

    it('refuses an unknown --type for a file', () => {
      expect(() => routeLocalFile('deck.md', 'edda')).toThrow(/unknown --type "edda"/);
    });

    it('refuses an extension it has no row for at all', () => {
      expect(() => routeLocalFile('notes.txt')).toThrow(/\.md, \.markdown, \.pdf/);
    });

    it('requires --type for markdown rather than assuming a destination', () => {
      // PLAN-28 names Edda as markdown's intended default, and the hand-off that
      // would seed Edda from a URL does not exist. Requiring the flag keeps that
      // default free to arrive without taking a Saga default back later.
      expect(() => routeLocalFile('deck.md')).toThrow(/--type saga/);
    });

    it('exposes exactly the extensions the table knows', () => {
      expect([...PREVIEWABLE_EXTENSIONS]).toEqual(['.md', '.markdown', '.pdf']);
    });
  });
});
