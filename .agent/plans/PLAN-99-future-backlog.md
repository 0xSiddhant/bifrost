# PLAN-99 — Future Backlog (reference only, never implemented wholesale)

Ideas we deliberately deferred. When one is scheduled, promote it into a new numbered plan file (PLAN-08+) with the standard format, and log the decision in `memory/decisions.md`. Do not implement anything from this file directly.

## Tier A — likely next (natural extensions)

| Idea                      | Notes captured during planning                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared markdown notes** | 2–3 persistent scratch notes, editable from any device, autosave + live SSE sync ("LAN Apple Notes"). Cloud-profile candidate. Reuses MarkdownViewer (PLAN-03) + clipboard patterns (PLAN-06). Conflict strategy: last-write-wins with edit lock indicator — keep it simple. |
| **Utility toolbox page**  | Base64 encode/decode, UUID gen, timestamp converter. 100% client-side, zero backend. Prime cloud-profile candidate. One `toolbox` module, each tool lazy-loaded. _(JSON formatter/validator pulled into PLAN-07 Runestone, diff viewer into PLAN-08 — 2026-07-14.)_          |
| **Send-to-device push**   | Pick a live device from presence → push a file/text directly to it; target shows a toast via its SSE connection. Builds on deviceId + presence (PLAN-06).                                                                                                                    |
| **Download-all-as-zip**   | If not done as PLAN-02 stretch: `archiver` streamed, selection UI on downloads page.                                                                                                                                                                                         |
| **PWA manifest + icons**  | Add-to-home-screen on iPhone/iPad/Android so Bifrost feels like an app. No offline caching of file lists (SSE is the truth) — manifest + icons + theme-color only.                                                                                                           |

## Tier B — valuable, larger

| Idea                                                  | Notes                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Variant: JSON Patch export (RFC 6902)**             | Structural diff records map ~1:1 onto patch ops; one button turns Variant into a pipeline tool. Cheap once the walker exists.      |
| **Variant: unified `.diff`/`.patch` file export**     | Text-mode sibling of JSON Patch export.                                                                                            |
| **Variant: three-way merge**                          | Base + left + right with conflict detection and take-left/take-right resolution. Big complexity jump — needs its own spike + plan. |
| **Variant: language-aware highlighting in text mode** | Auto-detect + lazy-load CM language packages. Deferred as scope creep; plain text + diff colors covers the core job.               |
| **Variant: diff-annotated tree view**                 | If not done as the PLAN-08 stretch task: tree nodes tinted by op with badge counts on collapsed branches.                          |
| **Runestone version history**                         | Store diff records per save; reuses the Variant walker output shape.                                                               |

| Idea                      | Notes                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloud profile go-live** | Deploy `cloud` manifest (toolbox, notes, qr-tool, themes) to a VPS/PaaS: Postgres repos behind existing interfaces, real auth (not PIN), HTTPS, hardened rate limits. Follow `docs/cloud-profile.md` (PLAN-07). Separate DB from local by design. |
| **Auto-cleanup policy**   | Heimdall-configurable retention for `uploads/` (age/size caps), dry-run preview before delete.                                                                                                                                                    |
| **Upload thumbnails**     | Server-side image thumbs (sharp) for the audit/metadata views. Careful: keep uploads write-only for non-admin surfaces.                                                                                                                           |
| **Wake-on-LAN**           | Magic-packet buttons for known MACs on the presence dashboard.                                                                                                                                                                                    |

## Tier C — someday / experiments

| Idea                                 | Notes                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebRTC device-to-device transfer** | Server signals only; bytes go peer-to-peer (huge files without touching the Mac's disk). Significant complexity jump — own plan, own spike first.        |
| **Bifrost CLI**                      | `bifrost push <file>` / `bifrost clip "text"` from any terminal on the LAN. Pairs with owner's Swift/CLI interests — could be the Swift sibling project. |
| **E2E tests (Playwright)**           | Multi-device flows are currently manual; automate the top 5 journeys.                                                                                    |
| **i18n**                             | Only if the household needs it.                                                                                                                          |

## Explicitly rejected (do not resurrect without a new decision)

- Public internet exposure of `file-transfer` — never; it's local-profile by design.
- WebSockets replacing SSE — revisit only if a truly bidirectional feature ships.
- Postgres locally / Docker as the macOS run mode — see decision log for reasoning.
