# PLAN-27 — Bifrost CLI

## Goal

A `bifrost` command, installed via `npm install -g`, that talks to an already-running Bifrost server over the LAN: push files, pull from Receive, read/write the shared clipboard, fetch a saved document by slug, open a saved document's rendered preview in a browser, manage go-links, check server status and connected devices, and run a speed test — all against endpoints that already exist and are unchanged by this plan. No new server surface; this is a new, third npm workspace consuming the existing API.

## Gate

PLAN-26 merged. Single PR.

## Verified against the codebase, not assumed

Every endpoint below was read directly from its route file (or, for the four document endpoints, from `architecture.md`'s own maintained description of them) rather than reconstructed from memory:

- `POST /api/files` (multipart, field name `files`, up to `MAX_FILES_PER_UPLOAD` per request), `GET /api/downloads` (flat `DownloadEntry[]`, **today's shape** — PLAN-24's folder fields are not live; see Scope), `GET /api/downloads/:id/content` (streamed bytes, range-capable).
- `GET /api/clipboard`, `POST /api/clipboard` (`{ text, kind?, lang?, ttlSeconds? }` → 201), `DELETE /api/clipboard/:id` → 204.
- `POST /api/portkey` (`{ slug, url, note? }` → 201), `GET /api/portkey?q&limit&offset`, `PATCH /api/portkey/:slug`, `DELETE /api/portkey/:slug`, `GET /go/:slug` (302, or a 302 bounce to `/portkey?go=<slug>` when the slug is unknown — never a plain 404).
- `GET /api/presence` → `{ devices: [...] }`.
- `GET /api/health` → `{ ok, uptime, profile }`; `GET /api/capabilities` → `{ profile, modules: string[] }`.
- `GET /api/nimbus/config`, `GET /api/nimbus/ping` (204, no body), `GET /api/nimbus/down?mb=&warmup=` (streamed, `content-encoding: identity`), `POST /api/nimbus/up` (raw `application/octet-stream` body, server counts and discards — **not** multipart), `POST /api/nimbus/release`, `POST /api/nimbus/results` (`{ downMbps, upMbps, latencyMs, testMb }` → 201), `GET /api/nimbus/results?device&limit`. The single-flight guard 409s ("another broom is flying") when a browser test is already running — a real response shape to design around, not an edge case to ignore.
- `core/device.ts`'s `deviceIdOf(request)` reads the optional `x-bifrost-device` header and returns `null` if absent, with **no validation failure** either way — confirmed directly, so the CLI needs no device-identity story to function; it's a nice-to-have, not a requirement (see Decisions).
- `GET /runestone/api/:slug`, `/edda/api/:slug`, `/groot/api/:slug`, `/atlas/api/:slug` — raw stored document bytes, CORS `*`, stale slugs 301, `?download=1` → attachment on the three that support it. All four exist specifically so "a saved document doubles as a stable data URL for third-party tools" (architecture.md, verbatim) — this plan is the first thing that actually exercises that intent from outside a browser.
- `client/package.json` and root `package.json` checked directly: `workspaces` is `["server", "client"]` today; `client/src/core/` really is one flat file per capability area (`atlas.ts`, `edda.ts`, `groot.ts`, `runestone.ts`, `loki.ts`, …) — the pattern this plan's `cli/src/core/` deliberately mirrors, confirmed rather than assumed.
- `client/src/core/library/registry.tsx` and `App.tsx`'s route table checked directly for `preview`: only `eddaEntry` carries a `readRoute` (`/edda/preview/:slug`, a real, already-shipped client SPA route). Runestone, Groot and Atlas have none — there is no rendered read-only page for those three today, only their raw-content endpoints. This is a real, confirmed gap, not an oversight to design around silently — see the `preview` decision below.

## Scope

**In:**
- New npm workspace `cli/`, published as a global-installable package with a `bifrost` binary.
- Commands: `push`, `pull`, `clip`, `open`, `preview`, `portkey` (+`go`), `status`, `devices`, `speed`.
- `commander` for argument parsing.
- A config file (`--host` override, persisted default) and default discovery via `bifrost.local`.
- `--json` output mode on every command, for scripting.

**Out:**
- Anything Heimdall-gated (admin settings, PIN login). Every command above hits an endpoint that's already unauthenticated LAN-trust; adding a PIN/session flow for the CLI is a separate, unasked-for feature.
- Folder-aware `pull`/`push --folder`. PLAN-24 (Download folders) is drafted but **not implemented** — `GET /api/downloads` today returns the flat, pre-folder `DownloadEntry` shape. This plan targets what's actually shipped; folder support is a natural follow-up once PLAN-24 lands, not something to build speculatively against an unmerged plan.
- Active mDNS service discovery (the CLI browsing `_http._tcp` itself). v1 relies on the OS's own `.local` resolution, same as a browser already does; see the discovery spike below for why, and what happens if that assumption is wrong on a given platform.
- Any write-side presence action (`POST /api/presence/prune`, `PATCH /api/presence/name`) — `devices` is read-only in this plan; nothing about a CLI session should silently rename a household device.
- A Swift/native rewrite. Settled before this plan was drafted.

## Decisions & reasoning

### A third workspace, not a subfolder of `client/` or `server/`

The CLI is a genuinely separate deployable artifact (its own `bin`, its own install lifecycle, run on machines that may have neither `server/` nor `client/` checked out) — `root package.json`'s `workspaces` gains `"cli"` alongside the existing `"server"`, `"client"`. `cli/src/core/` mirrors `client/src/core/`'s real, verified shape: one flat file per capability, plus a thin `commands/` layer that parses args and calls `core/` — the same "thin command layer over a core that does the work" shape routes/usecases and commands/core already both express elsewhere in this codebase, just without a usecase tier: there's no business rule to enforce here that the server doesn't already enforce, so a route→usecase→service split would be layering for its own sake.

```
cli/
├── package.json          # bin: { bifrost: "./dist/index.js" }, man: ["./man/bifrost.1"]
├── tsconfig.json
├── README.md              # install, one example per command, config/discovery — see Decisions
├── man/
│   ├── bifrost.1.md       # hand-maintained markdown source
│   └── bifrost.1          # compiled roff, generated at build time — gitignored, not authored directly
└── src/
    ├── index.ts           # shebang, commander program + subcommand registration
    ├── files.int.test.ts  # push + pull against a real running server
    ├── api.int.test.ts    # clip, portkey/go, status, devices against a real running server
    ├── speed.int.test.ts  # nimbus ping/down/up/results + the 409 single-flight guard
    ├── core/
    │   ├── client.ts       # fetch wrapper, base URL from discover.ts, error → clean CLI message
    │   ├── client.test.ts
    │   ├── discover.ts      # bifrost.local default, --host/config override
    │   ├── discover.test.ts
    │   ├── config.ts        # XDG-style path, read/write host + optional device id
    │   ├── config.test.ts
    │   ├── output.ts        # human-readable + --json mode
    │   ├── output.test.ts
    │   ├── files.ts         # push()/listDownloads()/pullFile()
    │   ├── clipboard.ts
    │   ├── documents.ts     # resolveKind() fan-out + --type short-circuit, shared by open & preview
    │   ├── documents.test.ts
    │   ├── browser.ts       # openInBrowser(url), wraps the `open` npm package
    │   ├── browser.test.ts
    │   ├── portkey.ts       # + redirect:'manual' slug resolution for go
    │   ├── presence.ts
    │   └── nimbus.ts
    └── commands/
        ├── push.ts
        ├── pull.ts
        ├── clip.ts
        ├── open.ts
        ├── preview.ts        # --type, --no-open
        ├── portkey.ts        # includes the `go` subcommand
        ├── status.ts
        ├── devices.ts
        ├── speed.ts
        └── config.ts
```

**Test placement follows this codebase's own real convention, not a new one**: a plain `<name>.test.ts` sits beside the file it tests (`file-transfer/sanitize.test.ts`, `file-transfer/services/place-file.test.ts` are the confirmed precedent), and a real-server integration test is a **separate, `.int.test.ts`-suffixed file, split by concern** rather than one giant file — `file-transfer` itself has three (`file-transfer.int.test.ts`, `uploads.int.test.ts`, `watcher-sse.int.test.ts`), not one, and the CLI's three (`files`, `api`, `speed`) mirror that same split-by-concern shape.

**`discover.ts`, `config.ts`, `output.ts`, `documents.ts`, `client.ts`, and `browser.ts` get a dedicated unit test — the other four `core/` files don't, and the line between them is real, not arbitrary.** `browser.ts` joins that list for the same reason `client.ts` does: it has its own small decision (launch vs. print, and `--json` always overriding `--no-open`'s own value) worth pinning with the `open` package mocked out, rather than trusting whichever path the integration suite happens to exercise. `files.ts`, `clipboard.ts`, `portkey.ts`, `presence.ts`, and `nimbus.ts` are thin, direct HTTP-calling wrappers with no branching of their own — they call `client.ts` and hand back what it returns, so their correctness genuinely does only show up against a real server. `client.ts` is different: its job is a small decision table (map a 2xx through, map a 404/409/5xx/network-failure each to a specific, worded CLI error) that every one of those five wrappers depends on being right — exactly the kind of pure, branchy logic `discover.ts`/`output.ts` already qualified for a unit test on, and worth mocking `fetch` for directly rather than trusting that whichever error cases the integration suite happens to trigger cover the whole table. `commands/*.ts` get no test files of their own for a different reason: they're deliberately thin (parse args, call `core/`, print), and the integration suite already drives them end-to-end through `index.ts`'s real command dispatch.

### `commander` for argument parsing — small, standard, matches the established dependency pattern

The same reasoning PLAN-25 used for `archiver` and PLAN-26 for `diff`: a small, single-purpose, extremely well-known library doing something genuinely fiddly to get right by hand (subcommands, flag parsing, `--help` generation, exit codes). `commander` is the de facto standard for exactly this in the Node ecosystem; hand-rolling argv parsing would be real, unrewarding work with its own edge cases (quoting, `--flag=value` vs `--flag value`, `-abc` short-flag bundling).

### Discovery: default to `bifrost.local`, but this is a real "verify, don't assume" spike, not a given

The server already advertises `bifrost.local` via mDNS/Bonjour, and a browser resolves it with zero special handling because the OS's own resolver is mDNS-aware. **Whether Node's own `fetch`/`dns.lookup()` resolves `.local` names the same way is a genuine platform question, not a safe assumption** — `dns.lookup()` calls the OS's `getaddrinfo()`, which on macOS does go through `mDNSResponder` (so this is very likely to just work there), but Linux only resolves `.local` if `nss-mdns` is configured, which is not universal, and Windows needs Bonjour installed separately. **Mandated spike, before the discovery code is finalized**: run a plain `fetch('http://bifrost.local:<port>/api/health')` from Node on macOS (the owner's actual platform) and confirm it resolves. If it does — which is the expected outcome, and the reason active mDNS browsing is scoped out for v1 — `discover.ts` stays as simple as "default to `bifrost.local`, let `--host`/config override it." If it doesn't, the fallback is not silently failing: `discover.ts` catches a `dns.lookup()`/`fetch` failure against the default host and prints a specific, actionable error ("couldn't reach bifrost.local — pass --host <ip> or run `bifrost config set-host <ip>`"), never a raw stack trace or a generic network-error message. Active `_http._tcp` browsing (a real, more robust fix for the Linux/Windows case) stays a named follow-up, not built speculatively here.

### Config file: hand-rolled XDG-style path, no new dependency

`~/.config/bifrost/config.json` on macOS/Linux (`process.env.APPDATA`-rooted on Windows) — computing this is a handful of lines against `os.homedir()`, not a problem that needs a dependency the way argument parsing does. Holds the persisted `--host` override and nothing else for v1; `config.ts` is the one file that reads/writes it, matching `core/`'s one-file-per-concern shape.

### No auth for v1 — every endpoint this plan touches is already unauthenticated LAN-trust

`deviceIdOf`'s verified-null-safe behavior means the CLI doesn't even need a device-identity story to function correctly; it's an optional nicety (a stable id persisted in `config.json`, sent as `x-bifrost-device`, would make clipboard/portkey attribution read as "cli@my-laptop" instead of blank) rather than a requirement, and is left as a small, clearly-optional addition in the task list, not gated behind it. Nothing in this plan reaches a Heimdall-gated route, so there's no PIN/session flow to build at all — deliberately, matching Scope.

### `push <file...>` is variadic, and every file in one invocation goes in one request

`POST /api/files` already accepts multiple files per multipart request (up to `MAX_FILES_PER_UPLOAD`) — confirmed directly, not assumed. `bifrost push a.pdf b.pdf` sends both in **one** multipart request rather than one round trip per file: no reason to pay N connection setups when the server already accepts N files at once, and it's a straight, direct use of a capability that already exists rather than a new one being invented. Per-file accept/reject results from the server's structured response are printed per file, so a mixed batch (one file over the size cap, others fine) is reported clearly rather than as one opaque failure — the browser client already has this exact per-file structure to lean on, and the CLI's output is a straightforward, unsurprising text rendering of it.

### `push`: Node's built-in `fetch` + `FormData`, with a mandated spike on whether it actually streams

`file-transfer`'s upload path is deliberately built to keep server memory flat regardless of file size (PLAN-02's own stated goal); a CLI upload path that silently buffers a multi-gigabyte file into a single in-memory `Buffer`/`Blob` before sending would quietly throw that guarantee away on the client side. Node 18+ ships `fetch`/`FormData`/`Blob` built in (via `undici`), and whether appending a `Blob` backed by a large file streams the read or buffers it fully is a real platform behavior, not something to assume either way. **Mandated spike, before the push command is built**: append a large (multi-hundred-MB) local file to a `FormData`, send it, and watch process memory during the request. If it streams — the expected, and simpler, outcome — `push` is built directly on `fetch`. If it buffers, the fallback is `undici`'s own lower-level streaming request API (already a transitive dependency via Node's `fetch`, so not a new one) rather than accepting an unbounded-memory upload path — state which branch was taken in the task checklist, not just "we'll check."

### `pull`: streamed response body to a local file, no spike needed

The asymmetric case to `push`'s: a `fetch` response's `.body` is already a standard `ReadableStream` in Node, and piping it to `fs.createWriteStream` via `stream/promises`' `pipeline` (or `Readable.fromWeb` + `.pipe()`) is a well-established, unambiguous pattern with no platform uncertainty worth spiking — the download side of this plan carries none of push's risk.

### `open <slug>`: a slug names a document, but not which kind, and that's a real ambiguity to resolve, not paper over

Slugs are unique **within** a document kind, not globally (`core/library/`'s own `LibraryItem` doc comment: `id` is "only unique within a kind"), and this plan's `open` command has exactly one string to go on — there is no single obvious "the" endpoint to hit for an arbitrary slug. Resolved explicitly rather than left as an implicit "try the current one": `open <slug>` tries all four raw endpoints (`runestone`/`edda`/`groot`/`atlas`) concurrently; exactly one 200 is the overwhelmingly common case and is used directly; zero 200s is a clean "no document with that slug" error; **more than one 200 — a genuine cross-kind slug collision, vanishingly rare given each kind mints its own 6-char id space, but not impossible** — is reported explicitly, asking for `--type <kind>` to disambiguate, rather than silently picking one. `--type` also skips the four-way fan-out entirely when the caller already knows the kind. Output defaults to stdout (so `bifrost open my-doc-a1b2c3 | jq .` composes in a shell pipeline the way the endpoints' own public/CORS design already invites); `--out <file>` saves to a file instead.

### `preview <slug>`: opens the rendered page when one exists, the raw content URL when it doesn't — not a paper-over

The owner's own ask was concrete: `bifrost preview <slug>` should behave like clicking a document's row and landing on the same page a browser would show — e.g. `http://bifrost.local:4646/edda/preview/sublime-usecase-ueyqid`. That page is real today for exactly one kind. `preview` reuses `open`'s own slug→kind resolution (same concurrent fan-out across the four raw endpoints, same `--type` short-circuit, same zero/many-match handling) — but factored so both commands share one resolution step in `documents.ts` rather than each re-implementing it: `open` uses the resolved kind *and* the fetched body; `preview` only needs the kind; it discards the body rather than issuing a second request. Once the kind is known, the URL is built one of two ways, and which branch ran is always stated in the output, never left implicit:
- `edda` → the real rendered page, `/edda/preview/:slug`.
- `runestone` / `groot` / `atlas` → no rendered page exists yet, so `preview` opens the raw `/<kind>/api/:slug` URL instead — a browser already renders `application/json`/`application/yaml`/`application/xml` readably in the tab (Chrome's built-in JSON viewer, syntax-highlighted plain text for the other two), so this is a genuine, honest "closest thing to a preview available today," not a silent downgrade dressed up as the real thing. If Runestone/Groot/Atlas ever gain their own rendered page, `preview` needs no change beyond adding that kind's `readRoute` here — same one-array-element extensibility the `core/library` registry already gives the browser app.

Launching the OS's actual browser is a separate small capability, `core/browser.ts`, wrapping the `open` npm package (small, single-purpose, doing something genuinely fiddly by hand — `start`/`xdg-open`/`open` differ by platform and have real shell-quoting hazards — the same `commander`/`archiver`/`diff` reasoning applies here too). **Naming note, not a real ambiguity**: the `open` npm dependency and the CLI's own `open <slug>` command share a name by coincidence; they do unrelated things (launch a browser vs. fetch raw document bytes) and nothing about the CLI's UX exposes the dependency name to a user. `portkey go --open` (already in the task list, previously undetailed) is built on the same `core/browser.ts` helper — one browser-launch mechanism, not two.

`preview` always opens the browser by default — that's the entire point of the command, unlike `go`'s `--open`, which is opt-in because `go`'s primary job is printing the resolved target for scripting. `--no-open` prints the resolved `{ slug, kind, url }` instead of launching anything, for an SSH/headless session. `--json` implies `--no-open` unconditionally — a scripted, piped invocation must never have the side effect of launching a GUI app, so JSON mode never launches a browser regardless of `--no-open`'s own value.

### `speed`: reuses the browser client's own measurement philosophy, doesn't invent a second one

Architecture.md is explicit that Nimbus's design puts the clock on the client deliberately — "the number a person cares about is the one their own device sees" — and that ping takes the median of ten samples, never the mean, because one retried packet would poison an average. The CLI's `speed` command reuses both: ten `GET /api/nimbus/ping` round-trips timed client-side, median taken; `GET /api/nimbus/down?mb=` and `POST /api/nimbus/up` (raw bytes, **not** multipart — confirmed against the route's own custom content-type parser) timed the same way. A completed run is `POST`ed to `/api/nimbus/results`, so a CLI-run test joins the same history a browser-run one would, rather than living in a second, disconnected place. The single-flight guard's 409 ("another broom is flying") is handled as a clean, specific CLI error naming the conflict — never a raw HTTP error dump — matching how the browser client already treats it as an expected state, not a failure.

### `cli/README.md` + a generated man page — a real, first-class CLI needs both, and neither exists elsewhere in this repo to copy

Neither `client/` nor `server/` has its own README today — checked directly, `README.md` at the repo root is the only one in the codebase — and that's the right call for two workspaces that only ever run from inside this monorepo. `cli/` is different: `npm install -g` moves it out of this repo entirely, onto a machine that may have neither `client/` nor `server/` checked out (already established above), and `npm view`, a GitHub folder view, and `npm install -g`'s own tooling all look for a README at the package root. `cli/README.md` is the **first workspace-level README in this codebase**, deliberately — not an inconsistency with the other two, a real difference in what kind of thing this workspace is. It gets install instructions, one example per command, the config file location, and the `--host`/discovery story. Root `README.md`'s existing "Project docs" list (a flat bullet list of `docs/*.md` links) gains one new line pointing at it, next to `docs/pm2.md`/`docs/observability.md`/etc.

A man page is new ground entirely — nothing in this repo has one today. `cli/man/bifrost.1.md` is authored once, by hand, in markdown — the same content shape as `--help`, **not** auto-extracted from `commander`'s own option definitions; a build-time introspection step is more machinery than a CLI this size warrants, so keeping the two in sync by hand is a real, ongoing cost, stated honestly here rather than glossed over as automatic. It's compiled to the actual roff-format `cli/man/bifrost.1` at build time via **`marked-man`** — a small, single-purpose library doing something genuinely fiddly to get right by hand (real roff/troff macro syntax), the same reasoning this plan already leans on for `commander`/`archiver`/`diff`/`open`, and, worth noting, from the same author's family as the `marked` dependency `client/package.json` already carries for Edda's `renderMarkdown` (confirmed directly, `client/package.json:31`) — unrelated workspaces, but a consistent choice of tooling. The compile step is wired in the same way `server/`'s own `prebuild` script already generates a file nobody hand-writes (`scripts/gen-build-info.ts` → the gitignored `server/build-info.json`, confirmed directly) — a `cli/`-local `prebuild` script following an already-established pattern, not a new one. `cli/package.json`'s own `man` field (a real, documented npm packaging feature — an array of man-page paths) is what makes `npm install -g` symlink it into the system man path automatically; nothing here needs a postinstall script or a manual step from whoever installs it.

### API surface is unchanged — this plan is a consumer, and the API contracts section says so precisely, not with a blanket "None"

Unlike PLAN-18/20/25's genuinely route-free plans, this plan is in constant contact with the server — "None" would be actively misleading here. The table below lists every endpoint the CLI calls, each marked pre-existing and unchanged, which is the accurate claim: **zero new or modified server-side routes**, not zero server interaction.

### Package naming needs a real availability check before publish

`bifrost` itself is a common enough word to plausibly be taken on the public npm registry; this isn't assumed either way — checking availability (and falling back to a scoped name like `@bifrost/cli` if needed) is a concrete task-list item, not a detail left to whoever runs `npm publish` first.

## API contracts

All pre-existing, unchanged by this plan — listed here because the CLI's whole surface is built on them.

| Method & path | Used by | Notes |
|---|---|---|
| `POST /api/files` | `push` | multipart, field `files`, up to `MAX_FILES_PER_UPLOAD` |
| `GET /api/downloads` | `pull` (list) | today's flat shape |
| `GET /api/downloads/:id/content` | `pull` (fetch) | streamed, range-capable |
| `GET`/`POST /api/clipboard`, `DELETE /api/clipboard/:id` | `clip` | |
| `GET/POST/PATCH/DELETE /api/portkey`, `GET /go/:slug` | `portkey`, `go` | |
| `GET /api/presence` | `devices` | read-only |
| `GET /api/health`, `GET /api/capabilities` | `status` | |
| `GET /api/nimbus/config\|ping\|down\|up\|release\|results` | `speed` | `up` is raw-body, not multipart |
| `GET /runestone\|edda\|groot\|atlas/api/:slug` | `open`, `preview` (kind resolution only) | tried concurrently unless `--type` given |
| `/edda/preview/:slug` | `preview` | client SPA route, not a JSON API — the CLI never `fetch`es it; it only builds the URL string and hands it to the OS browser launcher |

## Task checklist

**Workspace setup**
- [ ] `cli/package.json`: `bin: { bifrost: "./dist/index.js" }`, `man: ["./man/bifrost.1"]`, `commander` + `open` dependencies, `marked-man` devDependency; availability-check the package name (`bifrost` vs. a scoped fallback) before first publish
- [ ] `cli/tsconfig.json`; root `package.json`'s `workspaces` gains `"cli"`
- [ ] `cli/src/index.ts`: shebang, commander program setup, subcommand registration
- [ ] `cli/man/bifrost.1.md` + a `prebuild` script (mirrors `scripts/gen-build-info.ts`'s pattern) compiling it to `cli/man/bifrost.1` via `marked-man`; the compiled file is gitignored, not committed

**Core (`cli/src/core/`)**
- [ ] `client.ts`: fetch wrapper, base URL from `discover.ts`, non-2xx responses mapped to clean CLI errors (message + exit code, never a raw stack)
- [ ] `discover.ts`: default `http://bifrost.local:<port>`, `--host` flag and `config.ts`-persisted override; **spike task**: confirm Node's `fetch`/`dns.lookup()` actually resolves `.local` on macOS before finalizing the fallback-error path
- [ ] `config.ts`: XDG-style path resolution (hand-rolled, no dependency), read/write `host`, optional persisted device id
- [ ] `output.ts`: human-readable table/text printing + a `--json` mode that passes the raw response through
- [ ] `files.ts`: `push()` (multipart via `fetch`/`FormData` — **spike task**: confirm streaming vs. buffering behavior on a large file before shipping; fall back to `undici`'s streaming request API if it buffers), `listDownloads()`, `pullFile()` (streamed to disk; matches `name` **exactly** against the listing — collisions are already impossible within `downloads/`'s flat namespace per PLAN-17b's own dedup-on-publish guarantee, so exact match is unambiguous, not a simplification that drops a real case)
- [ ] `clipboard.ts`: list/add/remove
- [ ] `documents.ts`: `resolveKind()` — fan-out GET across the four raw endpoints, or a single one when `--type` is given; collision/zero-match handling; used by `open` (which also keeps the fetched body) and `preview` (which discards it)
- [ ] `browser.ts`: `openInBrowser(url)` wrapping the `open` npm package; used by `preview` (default-on) and `portkey go --open` (opt-in) — one shared mechanism
- [ ] `portkey.ts`: list/create/update/remove; resolve-a-slug (for `go`) fetches `GET /go/:slug` with `redirect: 'manual'` and reads the `Location` header directly — there is no `GET /api/portkey/:slug` to ask instead, and the list endpoint's `q` is a fuzzy search, not an exact-match lookup. A `Location` matching the `/portkey?go=` bounce pattern means "unknown slug"; anything else is the real target
- [ ] `presence.ts`: list (read-only)
- [ ] `nimbus.ts`: ping (10x, median), down, up (raw body), release-on-cancel, save-results; single-flight 409 mapped to a specific error

**Commands (`cli/src/commands/`)**
- [ ] `push.ts`, `pull.ts`, `clip.ts`, `open.ts` (+ `--type`, `--out`), `preview.ts` (+ `--type`, `--no-open`; `--json` implies `--no-open`), `portkey.ts` (+ `go` subcommand, `--open` to launch the system browser via `core/browser.ts`), `status.ts`, `devices.ts`, `speed.ts`
- [ ] Global `--json` flag wired through every command via `output.ts`
- [ ] `config` subcommand: `bifrost config set-host <url>` / `bifrost config show`

**Docs**
- [ ] `architecture.md`: a short paragraph noting the CLI as a third workspace and what it's for
- [ ] `tech-stack.md`: add `commander`, `open`, and `marked-man` rows
- [ ] `cli/README.md`: install, one example per command, config file location, `--host`/discovery story
- [ ] Root `README.md`'s "Project docs" list: one new line linking to `cli/README.md`
- [ ] `decisions.md`: log the npm-vs-Swift call (already made, restated for the record with reasoning) and the discovery/push-streaming spike outcomes once run
- [ ] `context-sync` pass once implemented; update `.agent/memory/progress.md`; archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. `npm install -g` from a built tarball puts a working `bifrost` command on `PATH`; `bifrost --help` lists every command below.
2. `bifrost push <file>` against a real running server lands the file in `uploads/`, matching what a browser upload produces — verified by comparing the server-side result, not just a 201 response. `bifrost push a.pdf b.pdf` sends both in one request (verified by request count) and, when one of the two is deliberately made to exceed the size cap, reports the accepted one as accepted and the rejected one as rejected — not a single opaque failure for the whole batch.
3. Pushing a multi-hundred-MB file does not spike CLI process memory to anywhere near the file's size — proven by the push-streaming spike's actual measurement, not assumed from the fetch API's existence.
4. `bifrost pull` with no argument lists today's flat `GET /api/downloads` shape correctly; `bifrost pull <name>` downloads the matching file byte-identical to the source.
5. `bifrost clip "text"` adds a real entry visible from a browser's Hermes page within the normal SSE round-trip; `bifrost clip --list` and `--rm <id>` work against real entries.
6. `bifrost open <slug>` for a real Runestone/Edda/Groot/Atlas document each resolves correctly with no `--type` given; a nonexistent slug is a clean "not found," not a raw 404 dump; `--type` skips the four-way fan-out (verified by request count, not just correct output).
7. `bifrost portkey create <slug> <url>` creates a real go-link a browser can then follow at `/go/<slug>`; `bifrost go <slug>` prints (and, with `--open`, launches) the resolved target; an unknown slug's 302-bounce behavior is handled as "not found," not followed into the management page's HTML.
8. `bifrost status` and `bifrost devices` reflect real server state, including a `profile` that matches the server's actual `DEPLOY_PROFILE`.
9. `bifrost speed` produces a result consistent with a browser-run Nimbus test on the same network, and the completed run appears in `GET /api/nimbus/results` afterward; running it while a browser test is in flight produces a clear, specific error, not a stack trace.
10. `--json` on every command emits parseable JSON with no human-readable text mixed in, verified by piping real output through `jq`.
11. `bifrost --host <explicit-ip>` overrides discovery entirely, and `bifrost config set-host` persists a default that a later bare invocation picks up.
12. On a machine where `bifrost.local` fails to resolve, the error names the specific fix (`--host` or `config set-host`), not a generic network failure.
13. No file under `server/` or `client/` changes in this plan's implementation PR — confirmed by the diff, not assumed from the design.
14. `bifrost preview <slug>` for a real Edda document opens `/edda/preview/<slug>` in the system's default browser, verified by an actual visible browser launch, not just a printed URL; for a real Runestone/Groot/Atlas document it opens that kind's raw `/<kind>/api/<slug>` URL instead, since no rendered page exists for those kinds today. `--no-open` prints the resolved `{ slug, kind, url }` instead of launching anything; `--json` never launches a browser regardless of `--no-open`. A nonexistent slug and a genuine cross-kind collision are handled identically to `open`'s own resolution (clean "not found" / ask for `--type`), not reimplemented differently.
15. `cli/README.md` documents every command with at least one real, runnable example, and root `README.md`'s Project docs list links to it. After `npm install -g` from a packed tarball, `man bifrost` opens and renders with no groff/nroff warnings on the terminal, and documents the same command set `--help` does.

## Test checklist

- [ ] Unit `core/client.test.ts` — each entry in the error-mapping table (404, 409, 5xx, a network/DNS failure) against a mocked `fetch`, asserting the specific worded message and exit code, not just "it throws"
- [ ] Unit `core/discover.test.ts` — default host construction, `--host`/config precedence order, the specific error path when resolution fails (mocked)
- [ ] Unit `core/config.test.ts` — XDG-style path resolution on macOS/Linux vs. the `APPDATA`-rooted Windows branch, read/write round-trip, a missing/corrupt config file falling back to defaults rather than crashing
- [ ] Unit `core/documents.test.ts` — `resolveKind()`'s zero/one/many-match branches, `--type` short-circuit, shared correctly between `open` and `preview`
- [ ] Unit `core/browser.test.ts` — `open` package mocked: default launches, `--no-open` doesn't, `--json` overrides `--no-open`'s own value and never launches
- [ ] Unit `core/output.test.ts` — `--json` mode never mixes in human-readable text; table mode renders a known fixture correctly
- [ ] Integration `files.int.test.ts` — `push`/`pull` against a real listening server (`fastify.inject` doesn't cover multipart-from-a-real-file well); the multi-file-one-request behavior and its per-file accept/reject reporting; the large-file streaming spike as an actual measured test (peak memory during the request), not a manual one-off
- [ ] Integration `api.int.test.ts` — `clip` (add/list/remove), `portkey`/`go` (including the unknown-slug bounce-vs-real-redirect distinction), `preview`'s kind resolution and URL choice for each of the four kinds (browser launch itself mocked out, not actually spawned in CI), `status`, `devices`, each against a real server
- [ ] Integration `speed.int.test.ts` — a full ping/down/up/results cycle against a real server; the 409 single-flight-guard path forced and asserted on
- [ ] Manual: `npm install -g` from a packed tarball on a clean shell, confirm `PATH` wiring and `--help`/`--version`
- [ ] Manual: `man bifrost` after that same global install renders cleanly (no roff warnings) and lists every command `--help` does
- [ ] Live-verify: run each command from a real terminal against the actual dev Mac's Bifrost instance, on the LAN, not just `localhost` — `preview` specifically confirmed by watching an actual browser tab open to the right URL for one document of each kind

## On completion

The **Bifrost CLI** row is already removed from `PLAN-99-future-backlog.md`'s Tier C table — that happens as part of scheduling this plan, not deferred here. Archiving this file into `completed/` happens in this plan's own implementation PR.
