# Progress

Where Bifrost stands. The code is the source of truth; this file is a map. Update it when a plan changes status, a release ships, or an owner check opens or closes, with a line, not a session log: commits and PRs hold the detail.

## Now

- **Latest release:** `v2.2.0` (2026-11-21).
- **Last plan:** PLAN-43, per-tab editor drafts (#122).
- **Next:** PLAN-44, Runestone JSONL (gate: PLAN-43 merged).

## Plans

| Plan | What | Status | PR |
| --- | --- | --- | --- |
| 00 | Foundation: tech setup, no feature code | done | direct to `main` |
| 01 | UI/UX foundation: fonts, design system, static pages | done | #2 |
| 02 | File transfer: upload, download, live folder watch | done | #3 |
| 03 | Previews and QR tool | done | #4 |
| 04 | Theming engine (JSON themes) | done | #5 |
| 05 | Heimdall admin panel | done | #6 |
| 06 | Clipboard sync, device presence, audit log | done | #7 |
| 07 | Runestone: JSON editor and library | done | #14, #15 |
| 08 | Variant: JSON and text diff | done | #17 |
| 09 | Ops: PM2, backups, Docker, Grafana stack | done | #19 |
| 10 | Heimdall as a modal | done | #20 |
| 11 | Edda: markdown editor and library | done | #29 |
| 12 | Loki: JS transforms, regex, sandboxed execution | done | #30 |
| 13 | Accio: read-later shelf | done | #35 |
| 14 | Nimbus: LAN speed test | done | #36 |
| 15 | Portkey: LAN go-links | done | #38 |
| 16 | Observability: logging, metrics, traces | done | #42, #43 |
| 17 | Send/Receive and notifications | done | #44, #45 |
| 18 | Toolbox: Diagon Alley tools expand in place | done | #48, #49 |
| 19 | Groot: YAML editor and library | done | #52 |
| 20 | Edda: Mermaid diagrams and PDF export | done | #53 |
| 21 | Pensieve: one library over every document kind | done | #50 |
| 22 | Offline mode (warm-load) | done | #55 |
| 23 | Atlas: XML and plist editor | done | #56 |
| 24 | Download folders: upload into, browse, zip | done | #58 |
| 25 | Brotli compress and decompress | done | #60 |
| 26 | Variant: JSON Patch and unified diff export | done | #61 |
| 27 | Bifrost CLI | done | #62 |
| 28 | Saga: markdown slideshow | done | #65 |
| 29 | Saga: PDF slides | done | #67 |
| 30 | Guide panel | done | #69 |
| 31 | Pagination | done | #80 |
| 32 | API schemas and contract tests, e2e safety net | done | #81–#84 |
| 33 | Black-box API testing | done | #85 |
| 34 | Load, stress and soak testing (on demand) | done | #86 |
| 35 | Hub and standalone client builds | done | #87 |
| 36 | Separate ports: web host and API server | done | #88 |
| 37 | API versioning (`/api/v1`) | done | #90, #91 |
| 38 | API docs (Swagger UI on the API server) | done | #92 |
| 39 | Docker per process | done | #89 |
| 40 | Load performance | done | #108 |
| 41 | First-load CSS | done | #113 |
| 42 | Runestone JSONC | done | #119 |
| 43 | Per-tab editor drafts | done | #122 |
| 44 | Runestone JSONL | not started | |
| 99 | Future backlog | reference | |

Outside any plan: the Halloween world (#110) and the Yule world (#118), which is the default theme now; Heimdall's staged-upload actions (#123); CI without WebKit, skipping docs-only changes (#125).

## Open owner checks

Things only the owner can check, from merged work. Remove a line once it is checked.

- The built app on a real iPhone and iPad, including Yule's look.
- On the Mac: the load runs (PLAN-34); each run mode under PM2 and launchd, the upgrade from the single process, `dns-sd`, an iPhone with the API stopped (PLAN-36); the Docker web host combination (PLAN-39); the API docs locally and over the SSH tunnel (PLAN-38).
- A Linux `docker compose up` (PLAN-36), and the standalone container behind the reverse proxy (PLAN-35).
- The public site's Lighthouse numbers once deployed, noting Bot Fight Mode's state (PLAN-40, PLAN-41).
- Yule: a device that saved a Sky Relics choice before Yule shows Yule's relics; the hub's Heimdall default theme does not pin Halloween.
- PLAN-43: Chrome's and Safari's own Duplicate tab keep separate drafts; ⌘⇧T within 10 minutes brings the draft back; Safari on iPhone unloading a background tab restores it without an offer; a device with a pre-update draft is offered it once.

## Journey

- **July 2026: the hub.** Foundation and design system, then file transfer, previews, themes, Heimdall, clipboard sync and presence (`v1.0.0`, 07-16). Then the editors and LAN tools: Runestone, Variant, Edda, Loki, Accio, Nimbus and Portkey, plus ops and observability (`v1.1.0`–`v1.3.0`).
- **August–September: Ollivanders and the CLI.** The toolbox, the Pensieve, Groot, Atlas, Brotli, Mermaid and PDF export, offline mode, download folders, diff export, the `bifrost` CLI, Saga and the Guide panel (`v1.4.0`, 09-12). Then pagination.
- **October: an API you can trust, and two builds.** Response schemas and contract tests behind browser journeys, black-box API tests, load testing, a standalone public site with no server, a separate web host and API server, `/api/v1`, API docs and per-process Docker images (`v2.0.0`, 10-25). Then load performance and first-load CSS (Lighthouse 60 → 95), and the Halloween world (`v2.1.0`, `v2.1.1`).
- **November: documents and drafts.** The Yule world became the default (`v2.2.0`, 11-21); Runestone gained JSONC; editor drafts became per tab; Heimdall can preview, move and delete staged uploads. CI dropped WebKit (run by hand before a release) and skips documentation-only changes. The `.agents/` files were cut from about 2 MB to what a session needs (owner, 11-27).
