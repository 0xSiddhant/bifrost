/**
 * localStorage scratch draft for the Groot editor (PLAN-19) — a refresh mid-edit
 * of an unsaved document must not eat the buffer. Allowed non-critical
 * localStorage class per coding rules (draft buffers). Saved documents live on
 * the server; saving clears this.
 */

export interface GrootDraft {
  title: string;
  text: string;
  savedAt: number;
}

const KEY = 'bifrost.groot.draft';

export function loadDraft(): GrootDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GrootDraft>;
    if (typeof parsed.title !== 'string' || typeof parsed.text !== 'string') return null;
    return { title: parsed.title, text: parsed.text, savedAt: Number(parsed.savedAt) || 0 };
  } catch {
    // Unreadable or blocked storage — a missing draft is a designed fallback,
    // not a failure worth reporting.
    return null;
  }
}

export function saveDraft(draft: GrootDraft): void {
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
