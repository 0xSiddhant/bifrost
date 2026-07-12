# PLAN-06 — Clipboard Sync · Device Presence · Audit Log

## Goal

Bifrost graduates from file hub to device hub: a LAN pastebin that syncs text instantly across devices, a dashboard of who's connected, and a proper upload history / activity log in Heimdall.

## Scope

**In:** `clipboard` module, `presence` module, `audit-log` module (all local-profile).
**Out:** send-to-device push, shared markdown notes, WebRTC (backlog).

## Decisions & reasoning

- **Clipboard = the killer utility.** One shared board of text entries (snippet, URL, OTP, command). `POST` from any device → persisted in SQLite → `clipboard.updated` on the bus → SSE → every device sees it instantly. Copy button uses the async Clipboard API (needs the page to be a secure-ish context — `.local`/LAN http is fine on Safari, verify Android Chrome; fallback = select-on-tap). Entries capped (default 100, setting) with oldest-out; explicit delete; optional TTL for sensitive entries (default off).
- **Code-flavored entries:** an entry can be marked `code` with a language hint → rendered with highlight.js + copy button. One table, one module — not a separate snippets feature.
- **Presence is SSE-derived, no polling:** the sse-hub already knows every open connection. Presence enriches connections with a stable per-browser `deviceId` (generated client-side, sent as SSE query param), user-agent parsing (`ua-parser-js`) → "iPhone · Safari", and lets a device claim a friendly name ("Siddhant's iPhone") stored in DB keyed by deviceId. Dashboard lists live devices + last-seen for known ones.
- **Audit-log is a pure bus subscriber** — the showcase of Rule 2. Subscribes to `file.uploaded`, `download.added/removed`, `clipboard.updated`, `heimdall.login.*`, `settings.updated`; writes rows `{ts, event, actor(deviceId/ip), payload-summary}`. Nothing imports it; delete the folder and Bifrost still runs. Heimdall gains History page: filter by event type/date, the uploads-metadata view from PLAN-05 now reads this richer store. Retention: pruning job (default 90 days, setting).

## API contracts

| Method & path | Purpose |
|---|---|
| `GET /api/clipboard` | List entries `[{id, text, kind, lang?, deviceName?, ts}]` |
| `POST /api/clipboard` | Add `{text, kind?, lang?}`; 413 over size cap (default 64 KB) |
| `DELETE /api/clipboard/:id` | Remove entry |
| `GET /api/presence` | Live + known devices |
| `PATCH /api/presence/name` | `{deviceId, name}` claim/rename |
| `GET /api/heimdall/audit` | Paginated, filterable log (session-guarded) |
| SSE | `clipboard.updated`, `presence.changed` |

## Task checklist

- [ ] Drizzle schemas per module (`clipboard_entries`, `devices`, `audit_events`) + migrations
- [ ] Clipboard: usecases (add/list/delete/prune), routes, page UI (composer, entry list, copy/copied state, code toggle + highlight, delete)
- [ ] Presence: deviceId bootstrap in client core, hub enrichment, name-claim flow, dashboard page
- [ ] Audit: subscriber service, retention prune on boot + daily timer, Heimdall History page + filters
- [ ] Verify clipboard copy on iOS Safari / Android Chrome over plain LAN http; implement fallback where blocked

## Acceptance criteria

1. Text posted from the Mac appears on an iPhone within ~1s; copy button puts it on the phone clipboard (or fallback works); survives server restart.
2. Presence shows each connected device with sensible auto-labels; renaming persists; closing a tab drops it from live within the heartbeat window.
3. Every upload/download-change/clipboard/login event lands in the audit table; Heimdall History filters correctly; rows older than retention get pruned.
4. Kill test: SIGINT during a burst of clipboard posts → restart → no DB corruption, entries either fully present or absent (no torn rows).
5. `audit-log` module deleted from the manifest → app boots and all other features function (Rule 2 proof, run once in CI-ignored script or manually).

## Test checklist

- [ ] Unit: prune logic, size caps, ua-parsing labels, deviceId stability
- [ ] Integration: clipboard CRUD + SSE broadcast; audit subscriber receives each event type
- [ ] Manual: two-phone + laptop simultaneous session
