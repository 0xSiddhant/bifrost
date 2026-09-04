# PLAN-99 — Future Backlog (reference only, never implemented wholesale)

Ideas we deliberately deferred. When one is scheduled, promote it into a new numbered plan file (PLAN-08+) with the standard format, and log the decision in `memory/decisions.md`. Do not implement anything from this file directly.

## Tier A — likely next (natural extensions)

| Idea                      | Notes captured during planning                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared markdown notes** | 2–3 persistent scratch notes, editable from any device, autosave + live SSE sync ("LAN Apple Notes"). Cloud-profile candidate. Reuses MarkdownViewer (PLAN-03) + clipboard patterns (PLAN-06). Conflict strategy: last-write-wins with edit lock indicator — keep it simple. |
| **Send-to-device push**   | Pick a live device from presence → push a file/text directly to it; target shows a toast via its SSE connection. Builds on deviceId + presence (PLAN-06).                                                                                                                    |
| **Download-all-as-zip (whole-library / multi-select)** | **Partially delivered by PLAN-24** (Download folders, 2026-09-04): a single folder's contents can be downloaded as one `.zip`, streamed via `archiver`, from two places — a direct icon on the folder's root row and an explicit button inside the folder. What's still open is the broader idea this row originally named: selecting an arbitrary set of root-level items (files and/or folders) across the whole Receive listing and zipping that selection — PLAN-24 explicitly scoped that out as "the broader backlog item stays open." |

_(**Upload thumbnails** and **Auto-cleanup policy** — DROPPED 2026-07-26 by owner decision. PLAN-17 makes both moot: it puts **Preview** directly on the upload card, which is what thumbnails were for, and turns `uploads/` into a staging area you actively move or delete from rather than a pile needing retention rules. Do not re-add without a new decision.)_

## Tier B — valuable, larger

| Idea                                  | Notes captured during planning                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edda: paste-image upload**          | Paste/drop an image into the editor → stored server-side, markdown link inserted. Needs an image-storage story (folder, cleanup, size caps) — real scope, own design pass. Listed in coming-soon. |

| Idea                                                  | Notes                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Variant: three-way merge**                          | Base + left + right with conflict detection and take-left/take-right resolution. Big complexity jump — needs its own spike + plan. |
| **Variant: language-aware highlighting in text mode** | Auto-detect + lazy-load CM language packages. Deferred as scope creep; plain text + diff colors covers the core job.               |
| **Variant: diff-annotated tree view**                 | Confirmed still undone (PLAN-08's own `[ ] *(stretch)* Diff-annotated tree view` task is unchecked, and `core/ui/TreeView.tsx` has no diff-tinting code) — not done as the PLAN-08 stretch task after all. Tree nodes tinted by op with badge counts on collapsed branches.  |
| **Runestone version history**                         | Store diff records per save; reuses the Variant walker output shape.                                                               |

_(**Variant: JSON Patch export (RFC 6902)** and **Variant: unified `.diff`/`.patch` file export** — PROMOTED 2026-09-04 to **PLAN-26**, combined into one plan since the second is explicitly the text-mode sibling of the first. See `PLAN-26-variant-diff-export.md`.)_

| Idea                      | Notes                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloud profile go-live** | Deploy `cloud` manifest (toolbox, notes, qr-tool, themes) to a VPS/PaaS: Postgres repos behind existing interfaces, real auth (not PIN), HTTPS, hardened rate limits. Follow `docs/cloud-profile.md` (PLAN-07). Separate DB from local by design. |
| **Wake-on-LAN**           | Magic-packet buttons for known MACs on the presence dashboard.                                                                                                                                                                                    |
| **Shared SSE across browser tabs** | **RCA (2026-07-24):** the app is served over **HTTP/1.1** on the LAN (plain http — no HTTP/2 without TLS), and browsers cap concurrent connections at **~6 per origin, shared across every tab**. Each tab holds **one permanent `EventSource('/api/events')`** for its whole lifetime (`core/sse.ts`, opened in `App.tsx`), so once ~6 tabs are open **every connection slot is consumed by idle-but-open SSE streams**. Any further request then queues forever — critically the lazy `import()` of a code-split route chunk (every page is `lazy()`-loaded) — leaving tabs stuck on the `<Suspense>` **"Crossing the bridge…"** loader (or blank if the shell itself isn't cached). **Reproduced** headless: 6 tabs saturate the pool, a 7th to a fresh route stalls, and **closing a tab instantly unblocks it** — proving connection exhaustion, not a chunk/code error. **Why we want it:** it's a real correctness bug the more tabs you open, and it will only get worse as the app grows more pages/chunks. **Fix (the reason this is a backlog item, not a quick patch):** elect a **single leader tab** — a `SharedWorker`, or `BroadcastChannel` + a Web-Locks/`localStorage` lock — that owns the **one** real `EventSource` and **fans every event out to all tabs over `BroadcastChannel`**; follower tabs render from the broadcast and never open their own connection, so **N tabs cost 1 connection** regardless. That is a cross-cutting rework of `core/sse.ts` (leader election, worker lifecycle, reconnect/heartbeat ownership, per-tab status derivation, presence deviceId accounting) that deserves its own spike + plan. **Interim if it bites first:** pause/close the SSE on `visibilitychange` when `document.hidden` and reopen on visible (~15 lines) — hidden tabs release their slot, covering the common single-focused-tab case. **HTTP/2** would also dissolve the limit but needs HTTPS (self-signed TLS trust on phones), which this offline LAN tool deliberately avoids. |

## Tier C — someday / experiments

| Idea                                 | Notes                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebRTC device-to-device transfer** | Server signals only; bytes go peer-to-peer (huge files without touching the Mac's disk). Significant complexity jump — own plan, own spike first.        |
| **Bifrost CLI**                      | `bifrost push <file>` / `bifrost clip "text"` from any terminal on the LAN. Pairs with owner's Swift/CLI interests — could be the Swift sibling project. |
| **E2E tests (Playwright)**           | Multi-device flows are currently manual; automate the top 5 journeys.                                                                                    |
| **i18n**                             | Only if the household needs it.                                                                                                                          |

## Owner-reviewed additions (2026-07-22 idea round)

Ideas surfaced in the 2026-07-22 review. **Accio · Nimbus · Portkey** from the same round were promoted to **PLAN-13 · PLAN-14 · PLAN-15** (see `decisions.md`); the rest stay parked here.

| Idea | Notes captured during review |
|---|---|
| **Pythia** (mock API server) | Define `/mock/<slug>` endpoints: status/headers/delay/body — killer synergy: a saved runestone can BE the response body. Dev-fixture server for app work while real backends are down. Pairs with Howler as one "dev endpoints" module. Medium. |
| **Howler** (webhook/request catcher) | Anything hitting `/hook/<id>` logged (method/headers/body) and streamed live via the SSE hub; the self-hosted webhook.site. JSON bodies render via existing viewers. Small-medium. |
| **Time-Turner** (shared timers) | Start a timer on one device, it rings on all via SSE; countdowns-to-date. Domestic delight on existing infrastructure. Small. |
| **Echo** (voice memos) | MediaRecorder in-browser → library/downloads, playable anywhere via the PLAN-03 range-request audio path. Small-medium. |
| **Skald** (Edda slideshow mode) | Render a saved edda as fullscreen slides (`---` breaks, arrow/tap nav) — a presentation tool as a view over PLAN-11. Small. |
| **Argus** (home services status page) | Ping/HTTP-check a configurable list (router, NAS, printer), up/down tiles + history sparkline. Heimdall watches the bridge; Argus watches the realm. Medium. |

## Explicitly rejected (do not resurrect without a new decision)

- Public internet exposure of `file-transfer` — never; it's local-profile by design.
- WebSockets replacing SSE — revisit only if a truly bidirectional feature ships.
- Postgres locally / Docker as the macOS run mode — see decision log for reasoning.
