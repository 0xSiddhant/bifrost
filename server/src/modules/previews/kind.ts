import { mimeForExt, FALLBACK_MIME } from '../../core/http/mime.js';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'none';

export interface KindInput {
  /** Mime detected from the file's first bytes, if the sniffer recognized it. */
  sniffedMime: string | undefined;
  /** Lowercased extension including the dot ('' when none). */
  ext: string;
  /** Content sample contained no null bytes (only consulted when sniffing failed). */
  probablyText: boolean;
  size: number;
}

export interface KindResult {
  kind: PreviewKind;
  mime: string;
  previewable: boolean;
}

const MARKDOWN_EXTS = new Set(['.md', '.markdown']);

/** Sources render as plain text; html/svg deliberately preview as source, never as documents. */
const TEXT_EXTS = new Set([
  '.txt', '.log', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html',
  '.xml', '.svg', '.yml', '.yaml', '.toml', '.ini', '.conf', '.env.example', '.sh', '.zsh',
  '.py', '.rb', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.java', '.kt', '.swift', '.sql',
  '.csv', '.tsv', '.diff', '.patch',
]);

export const TEXT_PREVIEW_CAP_BYTES = 1024 * 1024;

/**
 * Sniffed bytes outrank the extension — extensions lie (PLAN-03). Text-ish
 * formats have no magic bytes, so when sniffing comes back empty the
 * extension plus a null-byte check decide.
 */
export function resolveKind(input: KindInput): KindResult {
  const { sniffedMime, ext, probablyText, size } = input;

  if (sniffedMime) {
    const kind = binaryKindOf(sniffedMime);
    return { kind, mime: sniffedMime, previewable: kind !== 'none' };
  }

  if (MARKDOWN_EXTS.has(ext)) return textResult('markdown', ext, size);
  if (TEXT_EXTS.has(ext) || (ext === '' && probablyText) || probablyText) {
    return textResult('text', ext, size);
  }
  return { kind: 'none', mime: mimeForExt(ext), previewable: false };
}

function binaryKindOf(mime: string): PreviewKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'none';
}

function textResult(kind: 'markdown' | 'text', ext: string, size: number): KindResult {
  const mime = ext === '' ? 'text/plain; charset=utf-8' : mimeForExt(ext);
  return {
    kind,
    mime: mime === FALLBACK_MIME ? 'text/plain; charset=utf-8' : mime,
    // The viewers fetch the whole body — a 1 MB cap keeps phones honest.
    previewable: size <= TEXT_PREVIEW_CAP_BYTES,
  };
}
