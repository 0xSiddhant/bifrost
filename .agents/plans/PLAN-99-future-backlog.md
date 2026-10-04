# PLAN-99 — Future Backlog (reference only, never implemented wholesale)

Ideas we deliberately deferred. When one is scheduled, promote it into a new numbered plan file with the standard format, remove its row here, and log the decision in `memory/decisions.md`. Do not implement anything from this file directly.

## Tier A — likely next (natural extensions)

| Idea | Notes |
|---|---|
| **Shared markdown notes** | 2–3 persistent scratch notes, editable from any device, autosave + live SSE sync ("LAN Apple Notes"). Reuses MarkdownViewer (PLAN-03) + clipboard patterns (PLAN-06). Conflict strategy: last-write-wins with an edit-lock indicator. |
| **Send-to-device push** | Pick a live device from presence → push a file/text directly to it; the target shows a toast via its SSE connection. Builds on deviceId + presence (PLAN-06). |
| **Multi-select download as zip** | Select any set of root-level items (files and/or folders) across the Receive listing and download them as one `.zip`. PLAN-24 already zips a single folder (streamed via `archiver`); this is the arbitrary-selection version it scoped out. |

## Tier B — valuable, larger

| Idea | Notes |
|---|---|
| **Edda: paste-image upload** | Paste/drop an image into the editor → stored server-side, markdown link inserted. Needs an image-storage story (folder, cleanup, size caps): its own design pass. Listed in coming-soon. |
| **Variant: three-way merge** | Base + left + right with conflict detection and take-left/take-right resolution. Big complexity jump: needs its own spike + plan. |
| **Variant: language-aware highlighting in text mode** | Auto-detect + lazy-load CodeMirror language packages. Plain text + diff colours covers the core job today. |
| **Variant: diff-annotated tree view** | Tree nodes tinted by operation, with badge counts on collapsed branches (PLAN-08's unchecked stretch task; `core/ui/TreeView.tsx` has no diff tinting). |
| **Runestone version history** | Store diff records per save; reuses the Variant walker output shape. |
| **Wake-on-LAN** | Magic-packet buttons for known MACs on the presence dashboard. |
| **Shared SSE across browser tabs** | **RCA (2026-07-24):** over plain-http HTTP/1.1, browsers allow ~6 connections per origin across all tabs, and each tab holds one permanent `EventSource('/api/events')` (`core/sse.ts`, opened in `App.tsx`). Past ~6 tabs every slot is an idle SSE stream, so further requests (critically, lazy route chunks) queue forever and tabs hang on "Crossing the bridge…". Reproduced headless; closing a tab unblocks it. **Fix:** one leader tab (`SharedWorker`, or `BroadcastChannel` + a Web Locks/`localStorage` lock) owns the single `EventSource` and fans events out over `BroadcastChannel`, so N tabs cost one connection. That is a cross-cutting rework of `core/sse.ts` (election, lifecycle, reconnect/heartbeat ownership, per-tab status, presence accounting) needing its own spike + plan. **Interim:** close the SSE on `visibilitychange` when hidden and reopen when visible (~15 lines). HTTP/2 would also remove the limit but needs HTTPS, which this LAN tool avoids. |

## Tier C — someday / experiments

| Idea | Notes |
|---|---|
| **WebRTC device-to-device transfer** | Server signals only; bytes go peer-to-peer (huge files without touching the Mac's disk). Significant complexity jump: own plan, own spike first. |
| **i18n** | Only if the household needs it. |

## Owner-reviewed additions (2026-07-22 idea round)

| Idea | Notes |
|---|---|
| **Pythia** (mock API server) | Define `/mock/<slug>` endpoints: status/headers/delay/body; a saved runestone can be the response body. A dev-fixture server for while real backends are down. Pairs with Howler as one "dev endpoints" module. Medium. |
| **Howler** (webhook/request catcher) | Anything hitting `/hook/<id>` is logged (method/headers/body) and streamed live over SSE; a self-hosted webhook.site. JSON bodies render via the existing viewers. Small-medium. |
| **Time-Turner** (shared timers) | Start a timer on one device, it rings on all via SSE; countdowns-to-date. Small. |
| **Echo** (voice memos) | MediaRecorder in-browser → library/downloads, playable anywhere via the PLAN-03 range-request audio path. Small-medium. |
| **Argus** (home services status page) | Ping/HTTP-check a configurable list (router, NAS, printer); up/down tiles + history sparkline. Heimdall watches the bridge; Argus watches the realm. Medium. |

## Later follow-ups from PLAN-32–38

| Idea | Notes |
|---|---|
| **Standalone client logs → log service** | PLAN-35 leaves the standalone build with a no-op `LogSink`. Add a sink that posts browser errors to a log service running as another container on the same Docker network as the standalone site (never the home hub). One client file plus the service. |

## Explicitly rejected (do not resurrect without a new decision)

- Public internet exposure of `file-transfer`: never; it is local-profile by design.
- Taking the hub server live on the internet (the old "cloud profile go-live" row): the owner does not plan to; the public face is PLAN-35's standalone build, which talks to no server.
- WebSockets replacing SSE: revisit only if a truly bidirectional feature ships.
- Postgres locally / Docker as the macOS run mode: see the decision log for the reasoning.
- Upload thumbnails and an uploads auto-cleanup policy (dropped 2026-07-26): PLAN-17 put Preview on the upload card and made `uploads/` a staging area you act on, which made both moot.
