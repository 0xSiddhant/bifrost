import { asJsonFormat, type JsonFormat } from '../../core/json';

/**
 * localStorage draft survival (PLAN-07 Part A): real saving arrives with the
 * library in Part B, so a refresh mid-edit must not eat the buffer. Allowed
 * non-critical localStorage class per coding rules (draft buffers).
 *
 * The draft carries the document's format (PLAN-42), so a restored JSONC draft
 * comes back as JSONC; a draft cached before PLAN-42 has none and is JSON.
 */

export interface RunestoneDraft {
  title: string;
  text: string;
  format: JsonFormat;
  savedAt: number;
}

const KEY = 'bifrost.runestone.draft';

export function loadDraft(): RunestoneDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunestoneDraft>;
    if (typeof parsed.title !== 'string' || typeof parsed.text !== 'string') return null;
    return {
      title: parsed.title,
      text: parsed.text,
      format: asJsonFormat(parsed.format),
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: RunestoneDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // storage full or blocked — drafts are best-effort
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
