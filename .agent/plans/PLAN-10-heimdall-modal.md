# PLAN-10 — Heimdall Modal (settings-style overlay + section expansion)

## Goal

Convert Heimdall from a routed page into a **modal overlay** in the style of a desktop app's settings dialog: left panel with search + grouped sections, right content area. The `/heimdall` route is deleted entirely — no URL, no navlink, nothing to probe. Entry is gesture-only on tablet/desktop viewports. Alongside the conversion, Heimdall grows from one long dashboard into discrete sections, adding About, Logs, Devices (admin), Modules, Maintenance, and an expanded Storage section.

## Gate

Starts after PLAN-09 is merged (normal numeric order). Hard dependencies all satisfied by sequence: PLAN-06 (devices/presence + audit tables), PLAN-09 (backup script the "Backup now" button triggers).

## Scope

**In:** modal shell + left-panel navigation + search, route deletion, viewport-gated entry, auth relaxation (see decisions), section restructure of all existing content, new sections: About, Logs (live viewer + runtime log level), Storage (expanded), Devices (admin view), Modules (toggles), Maintenance (danger zone).
**Out:** mobile Heimdall (explicitly removed — see decisions), PIN-in-DB migration (stays in `.env`; revisit only if owner asks), bookmarkable deep links into sections (impossible by design and desired).

## Decisions & reasoning

- **Modal, not route.** `HeimdallModal` mounts at the app shell level, overlaying whatever page is open; closing unmounts with no navigation. Delete: the `/heimdall` route, the 404-lookalike (nothing to look for anymore), and every `heimdall` string from the route table. The reveal flag (`heimdallGate`) now opens the modal instead of navigating.
- **Entry = tablet/desktop only, via viewport (≥ 768px), not UA sniffing.** iPadOS Safari deliberately reports itself as macOS, so device detection is unreliable; capability gating is robust. Below 768px the gesture listeners are **never attached** — entry doesn't fail on phones, it doesn't exist. Both gestures stay: N-taps on the **header "Bifrost" wordmark** (already implemented; the footer-mark tap target from the mobile era is removed along with all mobile-entry code) and the configurable keyboard shortcut. Listeners tear down/re-attach on viewport resize across the threshold.
- **Auth: relax arrival friction, keep content defenses.** Supersedes the 2026-07-15 "PIN on every arrival" hardening: with no routable page, "arrival" no longer exists. New model — gesture always required to open the modal; if the admin session (30-min sliding) is alive, the PIN screen is skipped and content shows directly; if not, PIN view first. Closing the modal does NOT log out (session persists to expiry); explicit Lock button and epoch-revoke remain; unmount no longer calls `logout()`. **Kept unchanged:** PIN itself (env), constant-time compare, per-IP throttle (5/15min), session epoch revoke, `requireAdmin` guard on every API. Rationale: the modal removes the URL attack surface; the PIN still defends against shoulder-surfed gestures.
- **Left panel = grouped nav + search** (per owner's reference screenshot). Search fuzzy-matches section names **and individual setting labels** (each section exports a searchable manifest of its controls); selecting a hit opens the section and scroll-highlights the control. Grouping: *Watchtower* (Overview, Activity, Devices, Logs) · *Realm* (Settings, Themes, Sky Relics, Modules) · *Vault* (Storage, Uploads, Maintenance) · *Bridge* (Network, About).
- **Existing content maps to sections, nothing is lost:** Overview (stat chips), Uploads (metadata table), Settings (shortcut key-caps + tap count + default theme + revoke), Themes (enable/disable toggles), Sky Relics (collection filter), Network (join-QR + LAN IPs + mDNS name/status — promoted from a lone QR card), Storage (existing donut, expanded below).
- **About section:** panel description ("what is Heimdall"), app version + git commit hash + build date **baked at build time**, uptime, Node version, host name, profile; changelog viewer rendering `CHANGELOG.md` — generated from conventional commits (`changelogen`), which the commit discipline has been feeding since PLAN-00; credits + links (GitHub, 0xSiddhant.com). *Single source of truth is the server's `GET /about`* — version/commit/buildDate are baked into the **server build** (build script env/generated file; git is not available at runtime under PM2/Docker), and the client renders what the endpoint returns. Vite `define` is only a fallback for the client's own build stamp, not a second authority.
- **Logs section:** tail of `storage/logs/app.log` (last N lines, server-parsed JSON → readable rows), level + module filters, live-follow via the existing SSE hub (`log.line` events behind an admin-only subscription flag — hub gains per-event auth gating for this one event type), pause/resume, and a **runtime log-level switch** (pino `logger.level`, persisted to settings, applied without restart).
  - *Gating vs. long-lived connections:* the admin flag is evaluated at SSE-connect time, but sessions expire (30-min slide) and are revocable (epoch bump / Lock). The hub must **re-validate the session per `log.line` delivery or drop the connection's admin flag on epoch change** — an SSE stream opened as admin must not keep receiving log lines after revoke/Lock/expiry. Cheapest correct form: store the session epoch + expiry on the connection at connect; before each admin-gated send, compare against the current epoch and clock; on mismatch, silently stop sending admin events (connection itself stays, it's a public endpoint).
- **Storage section (expansion of existing donut):** donut stays; add largest-files list (top 10 across uploads/downloads with folder badge), "Sweep tmp now" (runs the boot sweeper on demand, reports bytes freed), "Backup now" (calls PLAN-09's backup **function in-process** — it is live-safe and importable by design, see PLAN-09; never shells out to the CLI — with progress + last-backup timestamp from settings), audit-retention days input (moves the PLAN-06 prune config from `.env` to DB settings — log the config-source change in decisions.md when implemented).
- **Devices section (admin view over PLAN-06 presence):** live connections (IP, connected-since), known devices with **rename/forget**, kick a live SSE connection. Display follows the PLAN-06 Heimdall convention: **`alias · label`** (character alias plus original UA label — admin sees both; only the public Wardens page hides the label). Public presence page remains the self-service surface; this is the authority surface.
  - *Forget semantics (explicit):* forget deletes the `devices` row. A reconnecting device is treated as new — it receives a **fresh character alias** (the old one returns to the pool), and historical attributions elsewhere (clipboard entries, audit rows, runestone authors) resolve to raw deviceId fallback since the registry no longer knows it. This is accepted; forget is for devices that shouldn't come back. Confirm dialog states it.
- **Modules section (toggles):** per-module enable/disable persisted to `settings['modules.disabled']`; composition root consults it at boot **after** the profile manifest (profile decides what *can* load, settings decide what *does*). Honest label on every toggle: *"applies on next restart"* — the manifest loads at boot and hot-unloading Fastify plugin trees is not worth the complexity for a home tool. Guards: `heimdall` and core cannot be disabled; disabling a module hides its nav/capability everywhere via the existing capabilities endpoint.
  - *Cross-module degradation (must be graceful, capability-driven, never a crash):* disabling `presence` → clipboard/audit/runestone attribution falls back to raw deviceId and the Wardens page disappears; disabling `previews` → downloads list drops its preview affordance; disabling `clipboard` → Muninn nav gone (existing rows stay in the DB); disabling `runestone` → Variant's library pickers hide (already designed in PLAN-08); disabling `audit-log` → recording stops, History card shows an empty/disabled state. Each toggle shows a one-line "also affects…" hint sourced from a small static dependency map in the client.
- **Maintenance / danger zone:** DB integrity check (`PRAGMA integrity_check` with green-tick result), WAL checkpoint now, clear clipboard history, purge audit log — every destructive action behind **type-to-confirm** (type the action word), all emitting audit events (which purge itself records as its final row).

## API contracts (all under `/api/heimdall`, `requireAdmin` unless noted)

| Method & path | Purpose |
|---|---|
| `GET /about` | version, commit, buildDate, uptime, node, host, profile |
| `GET /changelog` | rendered-safe CHANGELOG content |
| `GET /logs?lines=&level=&module=` | parsed tail; SSE `log.line` (admin-gated) for follow |
| `PATCH /logs/level` | `{ level }` → applies live + persists |
| `GET /storage/largest` | top-N files with folder + size |
| `POST /storage/sweep-tmp` | `{ freedBytes }` |
| `POST /storage/backup` | triggers PLAN-09 backup; `{ startedAt }`; status via settings |
| `GET /devices` / `PATCH /devices/:id` / `DELETE /devices/:id` | admin list / rename / forget |
| `POST /devices/:connId/kick` | close a live SSE connection |
| `GET /modules` / `PATCH /modules/:name` | toggle state; 403 for heimdall/core; restart-required flag in response |
| `POST /maintenance/integrity-check` · `/wal-checkpoint` · `/clear-clipboard` · `/purge-audit` | danger-zone ops; body requires `confirm: "<action-word>"` |

## Task checklist

**Conversion**
- [ ] `HeimdallModal` shell: overlay, focus trap, esc-to-close, left panel + right content, responsive ≥768px layouts (iPad portrait = collapsible panel)
- [ ] Delete `/heimdall` route + 404-lookalike + all route-table strings; gate opens modal
- [ ] Viewport-gated gesture attach/detach (wordmark taps + keyboard shortcut); remove footer-mark target and all mobile-entry code
- [ ] Auth relaxation: session-alive → skip PIN view; remove unmount-logout; keep Lock, throttle, revoke; update tests that encoded "PIN on every arrival"
- [ ] Left-panel search: per-section searchable manifests, fuzzy match, jump + highlight

**Section restructure** (move, don't rewrite): Overview, Uploads, Settings, Themes, Sky Relics, Network

**New sections**
- [ ] About (+ build-time version/commit injection, changelogen setup + `CHANGELOG.md` generation script, description copy)
- [ ] Logs (tail endpoint + parser, admin-gated `log.line` SSE with per-send epoch/expiry re-check, filters, follow/pause, runtime level switch)
- [ ] Storage expansion (largest files, sweep-tmp, backup-now wiring, retention input)
- [ ] Devices admin (list/rename/forget/kick over PLAN-06 repos; `alias · label` display; forget-confirm spells out the re-alias/attribution consequence)
- [ ] Modules (settings key, boot consult in composition root, toggle UI + restart banner, guards)
- [ ] Maintenance (four ops, type-to-confirm component, audit emission)

## Acceptance criteria

1. No `heimdall` string in the route table or navigable paths; direct URL guesses hit the SPA fallback like any unknown path; the modal opens over any page and closes back to it with zero navigation. *(Scope note: `/api/heimdall/...` fetch strings inevitably remain in the shell JS bundle since the modal ships with it — that is accepted; those endpoints are `requireAdmin`-guarded and reveal nothing without a session. The criterion is about there being no routable page, not about string-scrubbing the bundle.)*
2. On a phone (≤767px): no gesture listeners exist (verified via devtools), wordmark taps just navigate home. On iPad/desktop: 7 wordmark taps or the shortcut opens the modal.
3. With a live session: gesture → content directly (no PIN). After expiry or Lock or revoke: gesture → PIN view. Throttle still 429s after 5 wrong PINs.
4. Search for a *setting* (e.g. "tap") jumps to Settings with the tap-count control highlighted.
5. Logs section live-follows under load with filters applied; changing log level takes effect immediately without restart and survives restart.
6. Backup-now produces a valid archive (spot-restore); sweep-tmp reports freed bytes; integrity check returns ok.
7. Disabling a module → restart → its capability, nav, and routes are gone; heimdall/core toggles are refused with 403.
8. Kicking a live device closes its SSE connection within the heartbeat window; rename/forget round-trips.

## Test checklist

- [ ] Unit: search manifest matcher, viewport gate attach/detach, module-toggle guards, confirm-word validation
- [ ] Integration: every new endpoint incl. 403s and admin gating on `log.line` (incl. revoke/expiry mid-stream stops delivery); session-alive skip-PIN flow; boot with disabled module
- [ ] Manual: iPad portrait + landscape pass, desktop pass, phone negative pass; kill test during backup-now
