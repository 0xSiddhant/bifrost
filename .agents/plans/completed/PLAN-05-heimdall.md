# PLAN-05 — Heimdall (hidden admin panel)

## Goal

The gatekeeper: a hidden, PIN-protected admin area reachable only through secret gestures on the website itself. Manages themes (add/delete via JSON), runtime settings (including the keyboard shortcut itself), views upload **metadata**, server stats, and the join-QR.

## Scope

**In:** `heimdall` module — hidden entry, PIN auth + sessions, theme CRUD UI (over PLAN-04 APIs), settings management, upload metadata view (read-only), stats, QR display.
**Out:** file management (owner uses Finder — by decision), user accounts, download visibility of uploads (never).

## Decisions & reasoning

- **Two entry gestures, both required to exist, either one opens the door:**
  1. *Touch:* N hidden taps (default 7, from settings) on the footer server-identity mark within 3s.
  2. *Keyboard:* configurable combo, default `Shift+⌘+,` (`HEIMDALL_SHORTCUT_DEFAULT`), parsed from a stored string like `shift+meta+comma`. **Stored in the DB `settings` table and editable inside Heimdall** — this is exactly why config = env defaults + DB overlay was built in PLAN-00. Changing it broadcasts `settings.updated` so open clients rebind without reload.
- **Gesture ≠ auth.** The gesture only reveals the PIN screen at a non-linkable route (`/heimdall`, direct navigation without the gesture flag shows 404-lookalike). Auth = PIN from `.env` (never in DB, never sent to client) → `@fastify/secure-session` httpOnly cookie, 30 min sliding expiry. Rate limit: 5 attempts / 15 min per IP with incremental delay, attempts logged.
- **Upload metadata view** reads the audit trail (`file.uploaded` events already persisted from PLAN-02 via a minimal recorder; full audit UI is PLAN-06): name, size, time, uploader IP/device hint. **No content access, no download button — metadata only, per decision log.**
- **Stats:** disk usage per storage folder, counts, uptime, connected SSE clients, recent activity sparkline. Computed on request; no polling daemons.

## API contracts (all under `/api/heimdall`, session-guarded except login)

| Method & path | Purpose |
|---|---|
| `POST /api/heimdall/login` | `{ pin }` → session cookie; 429 on rate limit |
| `POST /api/heimdall/logout` | Kill session |
| `GET /api/heimdall/settings` / `PATCH` | Read/update runtime settings (shortcut, tap count, default theme, blocklist additions) |
| `GET /api/heimdall/uploads` | Metadata list (paginated) |
| `GET /api/heimdall/stats` | Disk/uptime/clients/activity |
| Theme add/delete | Reuses PLAN-04 `POST/DELETE /api/themes`, now behind the session guard |

## Task checklist

- [ ] Gesture service (tap counter + shortcut listener from settings; rebind on `settings.updated`)
- [ ] Auth: secure-session setup, login/logout, guard decorator applied to heimdall + theme-mutation routes, rate limiting, structured attempt logging
- [ ] Settings usecases with validation (shortcut string parser + conflict check against browser-reserved combos)
- [ ] Heimdall UI: login, dashboard (stats), themes manager (upload JSON w/ ajv errors + contrast warnings surfaced, delete with confirm), settings page, uploads metadata table, join-QR card (from PLAN-03 `<QrCard>`)
- [ ] 404-lookalike for direct `/heimdall` hits without gesture

## Acceptance criteria

1. Neither entry gesture is discoverable from markup (no `heimdall` string in served HTML before gesture); direct URL shows the 404-lookalike.
2. 7 taps or the shortcut → PIN screen; wrong PIN ×5 → locked out 15 min (logged); correct PIN → dashboard; session survives refresh, dies after expiry.
3. Changing the shortcut in settings takes effect on all open clients without reload; persists across server restart (DB, not env).
4. Theme JSON upload round-trip works end-to-end including a validation-failure case showing ajv paths.
5. Uploads table shows metadata for files uploaded in PLAN-02 testing; no route exposes their content.

## Test checklist

- [ ] Unit: shortcut parser, tap-window logic, settings validation
- [ ] Integration: login rate limit, guard on every heimdall + theme-mutation route (401 without cookie)
- [ ] Manual: gesture on iPhone (taps) + Mac (keyboard); session expiry behavior
