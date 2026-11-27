import { memoryBackend } from './coordinator';
import { randomId } from './records';
import { DraftSession, setDraftSessionForTests, type SessionDeps } from './session';
import { browserLocalStorage, memoryStorage } from './storage';

/**
 * A draft session for component tests (PLAN-43): jsdom's `localStorage`, a
 * `sessionStorage` of its own, no channel and an in-memory coordinator, so
 * offers and transfers work where jsdom has no IndexedDB. Installed as the
 * session every hook uses; stop it (or install another) between tests.
 */
export function createTestSession(overrides: Partial<SessionDeps> = {}): DraftSession {
  return new DraftSession({
    local: browserLocalStorage(),
    session: memoryStorage(),
    openChannel: () => null,
    backend: memoryBackend(),
    now: () => Date.now(),
    newId: randomId,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    target: window,
    doc: document,
    ...overrides,
  });
}

let installed: DraftSession | null = null;

export function installTestSession(overrides: Partial<SessionDeps> = {}): DraftSession {
  installed?.stop();
  installed = createTestSession(overrides);
  installed.start();
  setDraftSessionForTests(installed);
  return installed;
}

export function uninstallTestSession(): void {
  installed?.stop();
  installed = null;
  setDraftSessionForTests(null);
}
