/**
 * localStorage draft survival (PLAN-07 Part A): real saving arrives with the
 * library in Part B, so a refresh mid-edit must not eat the buffer. Allowed
 * non-critical localStorage class per coding rules (draft buffers).
 */

export interface RunestoneDraft {
  title: string;
  text: string;
  savedAt: number;
}

const KEY = 'bifrost.runestone.draft';

export function loadDraft(): RunestoneDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunestoneDraft>;
    if (typeof parsed.title !== 'string' || typeof parsed.text !== 'string') return null;
    return { title: parsed.title, text: parsed.text, savedAt: Number(parsed.savedAt) || 0 };
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
