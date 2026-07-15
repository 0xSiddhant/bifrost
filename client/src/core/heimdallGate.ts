/**
 * A one-shot, in-memory flag set when an entry gesture fires. `/heimdall` shows
 * the 404-lookalike unless this is set OR a live session already exists — so the
 * route is never discoverable by typing the URL, but a logged-in refresh (where
 * the flag is gone) still resolves via the session check. Deliberately not
 * persisted: a reload should re-hide the door.
 */
let revealed = false;

export const heimdallGate = {
  reveal(): void {
    revealed = true;
  },
  get revealed(): boolean {
    return revealed;
  },
  reset(): void {
    revealed = false;
  },
};
