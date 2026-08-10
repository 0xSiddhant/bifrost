/**
 * localStorage draft survival, the Runestone/Edda precedent: the scratch buffer
 * must not be eaten by a refresh mid-edit. Allowed non-critical localStorage
 * class per coding rules (draft buffers). Saved documents live on the server.
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
