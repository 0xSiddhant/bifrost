# Decision Log

The decisions that still shape Bifrost, one line each: what was decided, and why. The code is the source of truth for *how*; this file says *why*, so nobody reverses a deliberate choice by accident. A superseded decision is replaced, not kept beside its successor. The full history (every session, every superseded row) is in git: `git log -p -- .agents/memory/decisions.md`.

Add a line only for a decision a future change could plausibly undo without knowing it: an architecture or product rule, a trade-off, an owner's call. Not for implementation detail the code already shows.

## Architecture

- **2026-07-12** — Vertical-slice modules; modules talk only through the core event bus; a `DEPLOY_PROFILE` manifest (`local`/`cloud`) decides what loads. *Why:* features stay removable and the cloud profile can drop LAN-only modules.
- **2026-07-12** — SQLite (better-sqlite3 + Drizzle, WAL) behind repository interfaces. *Why:* embedded and restart-safe now; a Postgres swap for cloud stays mechanical.
- **2026-07-12** — SSE, not WebSockets, for live updates. *Why:* one-way notifications, browser auto-reconnect, far less lifecycle code.
- **2026-07-12** — Docker is not the run mode on macOS; PM2/launchd run it natively. Only the web host may run in Docker on a Mac, with a native mDNS advertiser (PLAN-39, owner). *Why:* mDNS, FSEvents and Finder break inside Docker's VM.
- **2026-07-15** — Auth is a core service (`app.requireAdmin`), not part of the heimdall module. *Why:* other modules' admin routes need the same guard.
- **2026-08-04** — The Pensieve is a client-side `Promise.allSettled` fan-out over each kind's own list API, never a server aggregate. *Why:* no cross-module server code; one failed kind does not blank the page.
- **2026-10-04** — Two client builds from one source: the hub, and a standalone site that cannot reach a server by construction (`__HUB__` branches, `hubOnly` stubs, `check-standalone`). *Why:* the public site must never depend on a hub.
- **2026-10-04** — Themes are client code (`client/src/assets/themes/`); the server theme API is gone. *Why:* both builds need them, and there is nothing to store.
- **2026-10-08** — Two processes, one address (PLAN-36): a web host on `PORT` serves the client and proxies to the API on loopback `API_PORT`. *Why:* the API can restart while the page and `bifrost.local` stay up.
- **2026-10-08** — PLAN-36 proxy: `@fastify/http-proxy` (reply-from over undici), chosen by a spike (SSE, 1 GB upload, ranges, zip, Brotli, client abort); pool unbounded, timeouts off. *Why:* each passed unchanged; reply-from's 128-connection default hung the 129th event stream.
- **2026-10-09** — A run's shape (`BIFROST_RUN`, `MDNS_ADVERTISER`, `OTEL_ENABLED`) comes from the launcher, never `.env`. *Why:* one `.env` serves every way of running it.
- **2026-11-21** — Seasonal decorations are plug-in seasons (`client/src/seasons/<name>/`, one line in `app/season.ts`), never shell or theme code. *Why:* a season is removed by deleting a folder.

## API

- **2026-07-14** — Download ids are the `sha256` of the path under `downloads/`, base64url (16 chars), derived independently by file-transfer and previews. *Why:* two modules agree on an id without talking.
- **2026-07-19** — Raw document endpoints (`/<kind>/api/v1/:slug`) serve the stored text with CORS `*` (owner). *Why:* a saved document is a stable data URL any tool can fetch.
- **2026-07-26** — A taken Portkey slug is a plain `409`; the client suggests a free variant, the server never renames one (owner). *Why:* a memorable slug is the point.
- **2026-07-26** — `server/src/core/reserved-roots.ts` is the one list of top-level path roots; every new root is added there. *Why:* a Portkey slug must never shadow a real page.
- **2026-09-30** — List endpoints gain an opt-in `paged=true` envelope; the legacy bare arrays stay byte-identical. *Why:* the installed CLI and old clients keep working.
- **2026-10-04** — Every route ships response schemas proven by a byte-identical contract guard, and `server/openapi.json` is committed. *Why:* a schema rewrites bytes; documentation must never lie about them.
- **2026-10-04** — Versioning by path: everything under `/api/v1/…`; old unversioned paths are rewritten to v1 before routing (one route, one rate-limit bucket), spiked. *Why:* an alias route per path would split buckets and guards.
- **2026-10-04** — v1 only grows; a breaking change is `/api/v2/<module>/…` for that module alone. *Why:* clients on the LAN update at different times.
- **2026-10-04** — API docs (Swagger UI) live on the API server's loopback port only, invisible to the client by construction, with no configuration. *Why:* nothing to secure or forget on the LAN.
- **2026-10-09** — The CLI probes `/api/v1/health` once per run and falls back to unversioned paths on a 404. *Why:* an installed CLI can be newer than its hub.
- **2026-11-27** — A folder zip stats its files one at a time (`statConcurrency: 1`). *Why:* the API promises code-point entry order, and archiver's concurrent stats queued entries in completion order.

## Security and storage

- **2026-07-12** — Uploads stream to tmp and are published by atomic link/rename; filenames sanitized; an extension blocklist. *Why:* no half-written file is ever visible; nothing executable is served.
- **2026-07-14** — `.html`, `.js` and `.svg` are served as `text/plain` from uploads and downloads. *Why:* never execute user content same-origin.
- **2026-07-15** — The Heimdall login throttle is in memory, per IP (5 failures per 15 minutes, a growing delay), not `@fastify/rate-limit`. *Why:* the PIN is the gate; this is DoS insurance, and a restart clearing it is fine.
- **2026-07-21** — Heimdall asks for the PIN on every opening of the modal; the entry gesture is not a security boundary. *Why:* shared household devices.
- **2026-07-22** — Portkey is local-only for good, its targets are http(s) only, and its redirects are always `302`. *Why:* a public go-links service is an open redirect; a cached `301` would pin a moved target.
- **2026-07-24** — Loki runs code in a fresh module Web Worker per run, killed with `terminate()` by the watchdog or Stop; execution and the runner's `fetch` are Heimdall switches. *Why:* no DOM, storage or cookies, and a `while(true)` stays killable.
- **2026-07-25** — Accio stores any scheme as a link except those that execute or embed in the page (`javascript:`, `data:`, `vbscript:`, `blob:`, `filesystem:`). *Why:* a stored row renders as an href, and an href must never be a script.
- **2026-07-30** — Staged uploads are readable (preview, rename, publish): `UPLOAD_EXT_BLOCKLIST` is load-bearing (PLAN-17b). *Why:* the sender previews before publishing.
- **2026-09-24** — `DEPLOY_PROFILE`, `STORAGE_ROOT`, `PORT` and `HEIMDALL_PIN` are required, no defaults. *Why:* a silent default once pointed storage at the wrong place.
- **2026-09-24** — Restore validates every archive entry (no symlinks, absolute paths or `..`) before extracting anything. *Why:* a crafted backup must not write outside `storage/`.

## Client

- **2026-07-13** — Self-hosted fonts (Space Grotesk, Inter, JetBrains Mono); no font CDNs. *Why:* LAN-only, offline, private.
- **2026-07-16** — Lore names (Hermes, Wardens, Pensieve, Nótt, Sigil) are frontend-only: server module ids, API paths, events and tables keep plain names, and old routes redirect. New toolbox tools get plain titles (owner). *Why:* the plumbing stays readable, and a tool is found by what it does.
- **2026-07-21** — Navigation is three category hubs (Midgard, Ollivanders, Diagon Alley); a tool is a card on its hub, not a tab (owner). *Why:* seven flat tabs were truncated on a phone's bottom bar.
- **2026-07-24** — Card colours follow position via the 10-slot palette (`cardToneClass(index + 1)`), never hand-picked. Exceptions by design: Accio's tile colour comes from a hostname hash (a site keeps its colour), and the Pensieve badge from the document kind. *Why:* reordering recolours consistently.
- **2026-07-20** — Diffing runs only on the Compare button, in both Variant modes; JSON and text are separate workspaces. *Why:* owner's model: an edit drops the results.
- **2026-07-25** — Nótt (the screensaver) is dismissed only by a click or a keystroke; moving the mouse keeps it up (owner). *Why:* it is a sky you part with the cursor, not an overlay in the way.
- **2026-08-02** — The toolbox's tools expand in place on Diagon Alley; open state lives in the URL. *Why:* Back closes the panel and a tool is linkable.
- **2026-08-04** — `renderMarkdown` is pure and synchronous; Mermaid is a separate async pass, treated as untrusted (`securityLevel: 'strict'`, extended `secure` keys). *Why:* one renderer for every surface, and DOMPurify keeps `<style>` in SVG.
- **2026-08-10** — Cross-tool hand-offs travel as one-shot `sessionStorage` seeds (`core/*Seed.ts`). *Why:* an unsaved document has no URL to carry it.
- **2026-08-26** — Offline mode warms chunks in an open tab; no Service Worker. Its switch starts off on every load, warms only on a click, and shows on Ollivanders and Diagon Alley only (owner). *Why:* Service Workers need a secure context; the hub is plain http.
- **2026-08-27** — A cold route with no bridge gets `core/ui/RouteBoundary`, not the app-wide crash card; every route loader has an 8 s `withChunkTimeout`. *Why:* a vanished host hangs a fetch instead of refusing it.
- **2026-10-04** — Standalone Heimdall: device-local settings through `SettingsStore`, no PIN. *Why:* nothing to protect without a hub.
- **2026-10-25** — Only the standalone site is search-engine optimised (`client/seoBuild.ts`, standalone build only); the hub is not (owner). *Why:* the public site is meant to be found; the hub is a private LAN app.
- **2026-10-26** — Accent-coloured text uses a derived `--accent-text` that reaches 4.5:1 on every backdrop; `--accent` is for fills. *Why:* contrast without changing a theme's look.
- **2026-10-27** — Every client-side file save goes through `core/saveBlob.ts` (`saveBlob` for bytes, `saveText` for text) (owner). *Why:* one implementation, not seven copies.
- **2026-10-29** — Page styles load with their page; the shell stylesheet is inlined; a first-load JS and CSS budget fails the build. *Why:* first paint is a download problem (PLAN-40/41).
- **2026-11-21** — Yule is the built-in default theme for every first visit. *Why:* owner.
- **2026-11-21** — Short looping decorations are Web Animations with literal keyframes; long-running motion uses `transform` only, never a CSS `filter`. *Why:* measured: CSS iterations woke React's listener (0.9 s of every 3 s); software compositors re-apply filters every frame.
- **2026-11-22** — Relic collections are stored as the ones switched off (`bifrost.relics.off`). *Why:* a new collection shows on devices that saved a choice.
- **2026-11-27** — Heimdall's Uploads section previews a staged file by opening the existing `/upload/:name/preview` route in a new tab; Move and Delete call the files API. *Why:* the sniffed preview surface is reused without Heimdall importing another feature.

## Editors and documents

- **2026-07-19** — Runestone ids are 6-char base36 and double as the key; slugs are `<kebab>-<id>` and a stale slug 301s. *Why:* rename freely without breaking links.
- **2026-08-02** — Groot parses YAML only in the client; the server stores text. Same for Atlas and XML (no plist library). *Why:* one parser, no server attack surface.
- **2026-08-27** — Atlas's plist table edits the source surgically (value edits replace a text span). *Why:* untouched bytes stay untouched.
- **2026-09-05** — Brotli runs server-side through Node's `zlib`, with an output cap that destroys the pipeline. *Why:* browsers' `CompressionStream` has no Brotli; a bomb must not fill memory.
- **2026-09-05** — Variant's JSON Patch export is replayed against both documents before it is offered. *Why:* never hand out a patch that does not reproduce the compare.
- **2026-11-21** — JSONC is an opt-in format per Runestone document (comments and trailing commas only); strict JSON stays the default. JSON and JSONC are one kind with a format column. *Why:* JSONC is an editor mode, not JSON5.
- **2026-11-23** — JSONC transforms are comment-safe or refused: the key sort re-renders from source slices and checks its own output. *Why:* never drop a comment silently.
- **2026-11-24** — JSONL (PLAN-44) is a third Runestone format: any strict JSON value per line, blank lines invalid. *Why:* the standard allows any value; skipping blanks would shift line numbers.

## Drafts (PLAN-43)

- **2026-11-26** — Drafts are kept per tab, editor and workspace in `localStorage`; a tab restores its own silently, another tab's is only offered and taken once. *Why:* two tabs on one editor overwrote each other.
- **2026-11-26** — "Known closed" = departure marker at `pagehide` + IndexedDB-registered lifetime not reclaimed + a grace (10 s offer, 10 min prune); owner accepted the gap that a tab returning after the grace may find its draft moved or pruned. *Why:* the spike found no signal that tells a close from a reload.
- **2026-11-26** — Pruning and offers: newest draft wins (owner), decided per editor and workspace (scratch, each saved document, Variant's workbench). *Why:* the next visit should offer what was last left there; a scratch draft must never cost a document's unsaved edits.
- **2026-11-26** — The cross-tab lock is an IndexedDB read/write transaction; everything that must agree across tabs lives in IndexedDB. *Why:* `navigator.locks` needs a secure context, and `localStorage` reads can be stale under a lock.
- **2026-11-26** — A duplicated tab yields its copied id (`BroadcastChannel` handshake); a leaving page stops answering at `pagehide`. *Why:* a copy must not share drafts; a reload must keep its own.
- **2026-11-26** — A saved document's draft carries a hash of the server copy; a mismatch asks Keep local / Use server, and Save is off until one is picked. *Why:* never overwrite either version silently.
- **2026-11-27** — A restore never overwrites this tab's own draft, and one that lands after the page moved to another workspace waits in its own; a dismissed offer is not offered again (any tab) while its source stays closed, and the draft stays put. *Why:* code review of #122; "dismiss keeps" without an offer on every load.
- **2026-11-27** — No multi-tab browser journeys for drafts (owner); unit tests are the coverage. *Why:* they failed in CI's WebKit one engine quirk at a time.

## Testing and CI

- **2026-10-04** — An `e2e/` workspace: browser journeys (Chromium desktop + mobile, standalone; WebKit by hand), the installed CLI, a black-box API suite with fuzzing and a security sweep. It imports no product source. *Why:* test what ships.
- **2026-10-04** — Playwright is for UI journeys only; CLI and API suites run under Vitest. *Why:* owner.
- **2026-10-04** — Load testing is on demand (`./bifrost test load`), never a CI gate. *Why:* results depend on the machine.
- **2026-10-05** — A journey failure is a client break, not a flake: zero retries; an out-of-scope bug is pinned with `test.fail`. *Why:* retries hide real bugs.
- **2026-10-07** — The editor helper types with the input each engine proved reliable (`fill()` on WebKit, keyboard on Chromium). *Why:* measured flakiness per engine.
- **2026-10-27** — CI's browser shards run in Microsoft's Playwright image; nothing installs from apt. *Why:* a slow mirror held shards for 17–32 minutes.
- **2026-11-24** — Journeys run with the season's snowfall off; the season journey opts back in. *Why:* WebKit without a GPU (CI's, until 2026-11-27; a by-hand run in a container) starved for animation frames.
- **2026-11-27** — The e2e harness retries a server start on new ports after `EADDRINUSE` (API or web host), and counts a start as up only once its own processes log listening on its ports. *Why:* four workers race for free ports, and a stranger's health answer is not this start's server.
- **2026-11-27** — Playwright runs four workers in CI and two locally. *Why:* CI's shards are sized at four; four on a busy developer machine pushed Edda/Groot journeys past the 8 s route-chunk timeout.
- **2026-11-27** — Three failing tests removed at the owner's call, their coverage dropped: the downloads watcher's new-folder rescan case, the CLI's Portkey/Go lifecycle case and its push/pull terminal-vs-pipe case. *Why:* owner chose removal over investigation.
- **2026-11-27** — WebKit journeys are not run in CI; `./bifrost test e2e webkit` runs them by hand before a release, beside a real iPhone or iPad (owner). Chromium mobile uses an iPhone 14's 390×664. *Why:* CI's GPU-less WebKit failed journeys for reasons a real iPhone does not have; the iPhone size keeps phone layout on every PR.
- **2026-11-27** — CI skips every build and test job when a change is documentation only, and splits unit tests over two machines, the Chromium journeys over four shards and the Docker images over three jobs (owner). `scripts/ci-changes.sh` decides: Markdown is docs except under `client/src/`, `cli/man/` and `CHANGELOG.md` (all used by the build or the server); a rename counts its old path; only an explicit `code=false` skips a job, so a failed or empty check runs everything. *Why:* no CI minutes for Markdown, never a green run that tested nothing; the slowest job drops from about 4 minutes to 2–3.

## Operations and process

- **2026-07-12** — Logs: pino JSON files with rotation; Grafana/Loki/Tempo optional. `LOG_LEVEL` defaults to `trace`; no in-app log viewer. *Why:* the file is an archive; filter in Grafana.
- **2026-07-29** — Metrics: a snapshot log line per interval is the system of record; Prometheus and OTel traces are accelerators, OTel off by default. *Why:* works with nothing else running.
- **2026-09-24** — Scheduled backups run from a launchd agent into a cloud-synced folder. *Why:* off-machine copies without a server.
- **2026-10-09** — `npm audit` must report 0 at every severity; a finding is fixed before other work. *Why:* owner.
- **2026-10-09** — Every repo task runs through `./bifrost`; root npm scripts are kept minimal. *Why:* one discoverable entry point.
- **2026-10-24** — Node floor 22 (`>=22.23.4`). *Why:* CVE-2026-111497 (brotli decoder).
- **2026-07-12** — ESLint stays on 9 and TypeScript on 5.9. *Why:* typescript-eslint 8 targets them.
- **2026-10-28** — No `Co-authored-by` in ordinary commits; merge messages credit multiple authors and reviewers (`Reviewed-by`). *Why:* owner.
- **2026-11-27** — The `.agents/` files are guidance, not a record: progress is one line per plan, decisions are the ones in force, plans are deleted once merged. *Why:* owner; they cost tokens every session and the code is the source of truth.

## Dependency overrides

Each root `overrides` entry in `package.json` and why. Drop a line when its override goes.

- **2026-07-25** — `brace-expansion ^5`: eslint 9's `minimatch@3` pulls a DoS-vulnerable version; the API is one unchanged function. Chosen over the eslint 10 major.
- **2026-08-23** — `@esbuild-kit/core-utils → esbuild >=0.25.0`: drizzle-kit's pinned esbuild; scoped to that one path.
- **2026-10-08** — `shell-quote ^1.12.0` (concurrently pins 1.9.0 exactly); `autocannon → hyperid ^4` (hyperid 3 needs a vulnerable uuid; 4 drops it with the same API); `mermaid → katex ^0.19` (mermaid only calls `renderToString`).
- **2026-10-08** — `micromatch` is the in-repo shim `tools/micromatch-shim/`, wired as a root devDependency plus `"micromatch": "$micromatch"`. *Why:* eslint-plugin-boundaries pins micromatch 4.0.8, and the shim is its three functions copied on picomatch, never reaching `braces`; a `file:` path directly in `overrides` does not resolve.
- **2026-10-09** — `handlebars ^4.7.10`: three critical JavaScript-injection advisories in ≤ 4.7.9.
- **2026-11-02** — `glob ^14.0.3` and `minimatch ^11.0.4`: advisories with no backport, reaching us through eslint 9, typescript-eslint, archiver, @fastify/static and gaxios; every consumer's calls still work on the patched majors.
