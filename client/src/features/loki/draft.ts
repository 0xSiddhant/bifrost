/**
 * Loki keeps no server-side documents, so its workspace is cached locally (the
 * allowed non-critical class — draft buffers) and restored on mount. This is
 * what makes the "Diff before/after → Variant" round trip non-destructive: the
 * page unmounts on navigation, and the buffer + regex workspace come back when
 * you return. Also survives a refresh mid-edit.
 */

const KEY = 'bifrost.loki.draft';

export interface LokiDraft {
  code: string;
  mode: 'transforms' | 'regex';
  rxPattern: string;
  rxFlags: string;
  rxSubject: string;
}

export function loadLokiDraft(): LokiDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LokiDraft>;
    return {
      code: typeof parsed.code === 'string' ? parsed.code : '',
      mode: parsed.mode === 'regex' ? 'regex' : 'transforms',
      rxPattern: typeof parsed.rxPattern === 'string' ? parsed.rxPattern : '',
      rxFlags: typeof parsed.rxFlags === 'string' ? parsed.rxFlags : 'g',
      rxSubject: typeof parsed.rxSubject === 'string' ? parsed.rxSubject : '',
    };
  } catch {
    return null;
  }
}

export function saveLokiDraft(draft: LokiDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // storage full / unavailable — the workspace just won't persist.
  }
}
