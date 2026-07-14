import { describe, expect, it } from 'vitest';
import { resolveKind, TEXT_PREVIEW_CAP_BYTES } from './kind.js';

const base = { sniffedMime: undefined, ext: '', probablyText: false, size: 100 };

describe('resolveKind', () => {
  it('trusts sniffed bytes over a lying extension', () => {
    expect(resolveKind({ ...base, sniffedMime: 'image/png', ext: '.txt' })).toEqual({
      kind: 'image',
      mime: 'image/png',
      previewable: true,
    });
    expect(resolveKind({ ...base, sniffedMime: 'video/mp4', ext: '.md' }).kind).toBe('video');
    expect(resolveKind({ ...base, sniffedMime: 'audio/mpeg', ext: '.png' }).kind).toBe('audio');
    expect(resolveKind({ ...base, sniffedMime: 'application/pdf', ext: '.jpg' }).kind).toBe('pdf');
  });

  it('marks unpreviewable binary formats as none', () => {
    const result = resolveKind({ ...base, sniffedMime: 'application/zip', ext: '.zip' });
    expect(result).toEqual({ kind: 'none', mime: 'application/zip', previewable: false });
  });

  it('classifies markdown by extension when sniffing is silent', () => {
    expect(resolveKind({ ...base, ext: '.md', probablyText: true })).toEqual({
      kind: 'markdown',
      mime: 'text/markdown; charset=utf-8',
      previewable: true,
    });
  });

  it('classifies known source extensions as text', () => {
    for (const ext of ['.txt', '.json', '.ts', '.py', '.yml']) {
      expect(resolveKind({ ...base, ext, probablyText: true }).kind).toBe('text');
    }
  });

  it('previews html and svg as source text, never as documents', () => {
    const html = resolveKind({ ...base, ext: '.html', probablyText: true });
    expect(html.kind).toBe('text');
    expect(html.mime).not.toContain('text/html');
  });

  it('falls back to the null-byte heuristic for unknown extensions', () => {
    expect(resolveKind({ ...base, ext: '.weird', probablyText: true }).kind).toBe('text');
    expect(resolveKind({ ...base, ext: '', probablyText: true }).kind).toBe('text');
    expect(resolveKind({ ...base, ext: '.weird', probablyText: false }).kind).toBe('none');
  });

  it('caps text/markdown previews at 1 MB', () => {
    const big = { ...base, ext: '.md', probablyText: true, size: TEXT_PREVIEW_CAP_BYTES + 1 };
    expect(resolveKind(big)).toMatchObject({ kind: 'markdown', previewable: false });
    const fits = { ...big, size: TEXT_PREVIEW_CAP_BYTES };
    expect(resolveKind(fits).previewable).toBe(true);
  });
});
