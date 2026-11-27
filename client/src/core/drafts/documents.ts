import { hashText, type DraftCodec } from './records';

/**
 * The draft shape Runestone, Edda, Groot and Atlas share (PLAN-43): a title, a
 * text and, for Runestone, a format. A saved document's working copy also
 * carries the **baseline** it was edited from, so a reload can tell whether
 * the server copy moved on meanwhile and ask which one to keep, rather than
 * overwrite either.
 */

export interface DocBaseline {
  /** Hash of the server copy's name, format and content when the edits began. */
  hash: string;
  modifiedAt: number;
}

export interface TextDraft {
  title: string;
  text: string;
  /** Runestone's JSON/JSONC; absent elsewhere. */
  format?: string;
  /** Set on a saved document's working copy; null on scratch. */
  baseline: DocBaseline | null;
}

export interface ServerDoc {
  name: string;
  content: string;
  format?: string;
  modifiedAt: number;
}

export function baselineOf(doc: ServerDoc): DocBaseline {
  return {
    hash: hashText(`${doc.name}\u0000${doc.format ?? ''}\u0000${doc.content}`),
    modifiedAt: doc.modifiedAt,
  };
}

/** The server copy is the one these edits started from. */
export function sameBaseline(draft: DocBaseline | null, doc: ServerDoc): boolean {
  return draft !== null && draft.hash === baselineOf(doc).hash;
}

export const textDraftCodec: DraftCodec<TextDraft> = (raw) => {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<TextDraft>;
  if (typeof value.title !== 'string' || typeof value.text !== 'string') return null;
  let baseline: DocBaseline | null = null;
  if (value.baseline !== null && value.baseline !== undefined) {
    const candidate = value.baseline as Partial<DocBaseline>;
    if (typeof candidate.hash !== 'string' || typeof candidate.modifiedAt !== 'number') return null;
    baseline = { hash: candidate.hash, modifiedAt: candidate.modifiedAt };
  }
  return {
    title: value.title,
    text: value.text,
    ...(typeof value.format === 'string' ? { format: value.format } : {}),
    baseline,
  };
};

/**
 * Reads a pre-PLAN-43 single-slot draft (`bifrost.<editor>.draft`:
 * `{ title, text, savedAt, format? }`). Null when it is unreadable or holds
 * nothing worth restoring (`blank`).
 */
export function legacyTextParse(blank: (text: string) => boolean) {
  return {
    parse: (raw: string): { payload: TextDraft; savedAt: number } | null => {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        return null;
      }
      if (typeof value !== 'object' || value === null) return null;
      const old = value as { title?: unknown; text?: unknown; format?: unknown; savedAt?: unknown };
      if (typeof old.title !== 'string' || typeof old.text !== 'string' || blank(old.text)) return null;
      return {
        payload: {
          title: old.title,
          text: old.text,
          ...(typeof old.format === 'string' ? { format: old.format } : {}),
          baseline: null,
        },
        savedAt: Number(old.savedAt) || 0,
      };
    },
  };
}
