# PLAN-16 — Observability (metrics, traces, and a single pane)

## Goal

Know what Bifrost is actually doing: CPU, memory, event-loop hangs, request latency, and usage analytics — all visible in Grafana next to the logs that are already there. Bifrost gains a durable metrics record that survives with **zero Docker dependency**, and the optional stack gains Prometheus + Tempo for high-resolution investigation. Heimdall stops duplicating the log viewer.

## Gate

PLAN-15 merged. **Declared exception: two PRs** (the PLAN-07 precedent), because the two halves answer different questions and the first is worth merging before the second is written.

| PR | Branch | Steps | Ships |
| --- | --- | --- | --- |
| **16a** | `feat/plan-16a-logging` | 0 + 1 | Heimdall Logs deleted, `logLevel` key, trace default + retention, server log gaps closed, client logs exist for the first time |
| **16b** | `feat/plan-16b-metrics` | 2 + 3 + 4 | Metrics snapshot, Prometheus, Tempo + OTel |

16b starts only after 16a merges. The split is along a real seam: **16a fixes the supply side** (what gets written, from both workspaces) and stands alone as a shipped improvement even if 16b is never built; **16b adds new signal types** on top and is the part justified by the skill-building goal rather than by need. Archive this plan file at the **16b** PR, when both halves are done.

## Decisions & reasoning

- **The snapshot is the record; Prometheus and Tempo are accelerators.** Alloy's backfill guarantee is a property of *tailing files*, not of the stack: Prometheus **scrapes** (down = the data never existed, no backfill possible) and Tempo is **pushed to** (down = the exporter buffers, retries, drops). Since the owner runs Docker far less often than Bifrost, anything that only exists while Prometheus is up is useless for the actual question — "why did it hang at 3am last Tuesday?". So the durable path is a **periodic metrics snapshot written into the pino log stream**, which inherits the existing files-first backfill for free.
- **Log deltas, not cumulative counters.** `uploadsDelta: 3` (since the last snapshot), never `uploadsTotal: 4711`. Deltas sum trivially over any window in LogQL and are immune to the counter-reset problem — a cumulative counter drops to zero on every Bifrost restart and corrupts every rate calculation spanning that point. This sidesteps the entire class of bug rather than working around it.
- **Event-loop lag is the headline metric.** In Node a "hang" is almost always a synchronous block. `perf_hooks.monitorEventLoopDelay()` is built in (zero deps) and catches all of it; nothing else on the list will. Note `fs-stats-reader.ts` walks the uploads tree with recursive `readdirSync` — a live suspect, and the first thing to check once lag data exists.
- **Snapshot cost is negligible:** 60s interval ≈ 1,440 lines/day ≈ 0.4 MB/day against a 20 MB rotation cap.
- **`diskMb` must NOT be sampled every snapshot — it would manufacture the hang this plan exists to detect.** `fs-stats-reader.diskUsage()` walks uploads and downloads recursively with **synchronous `readdirSync`**; running that every 60s blocks the event loop every 60s, and the sampler would then faithfully record the lag spike it just caused. Disk usage does not move on a 60s timescale, so `diskMb` is sampled on its own slow cycle (`METRICS_DISK_INTERVAL_SEC`, default 1800) and the last value carried on intervening snapshots. The field is nullable on the very first snapshot before the slow cycle has run once.
- **The disk walker moves to `core/`.** `fs-stats-reader` lives in `heimdall/services/` and modules never import each other, so the `metrics` module cannot reach it. Lift the walk into `core/` (or a `core/disk-usage.ts` helper) and have **both** Heimdall and metrics depend on the core version — one implementation, no boundary violation, and the plan's own "no cross-module imports" rule applies to disk exactly as it does to uploads.
- **Snapshots are gated by `METRICS_ENABLED`, never by `LOG_LEVEL`.** Snapshots are log lines, so raising `LOG_LEVEL` to `warn` or `error` — the escape hatch this plan deliberately keeps for trace noise — would **silently stop the metrics record**, destroying the "survives with zero Docker dependency" premise. The metrics module therefore uses a child logger **pinned at `trace`** (`log.child(bindings, { level: 'trace' })`), which is unaffected by the root level. **Verified**: with the root at `error`, a `trace`-pinned child still writes while ordinary children stay silent. `METRICS_ENABLED` remains the one intended off-switch.
- **Prometheus and Tempo are justified by the skill-building goal, not by need.** Steps 1–2 alone satisfy every practical requirement. PromQL and OpenTelemetry are the transferable, vendor-neutral skills worth building for their own sake — but they are explicitly *not* the system of record, and the plan must not drift into treating them as durable storage they cannot be.
- **A better log UI is worthless over a thin log stream — Step 1 fixes the supply side.** Audit at plan time: **36 log calls server-wide** (19 info / 9 warn / 5 error / 3 debug, **zero fatal**) against **34 catch sites, ~22 of which log nothing**. `setErrorHandler` (`core/http/index.ts:56`) does log unhandled route throws, so the main safety net holds — but there are **no `uncaughtException`/`unhandledRejection` handlers** (a dying process leaves no trace, exactly the case the snapshot exists to explain) and **`app.ts:203` writes config failures to `stderr` then `process.exit(1)`, bypassing the logger entirely** — the commonest startup failure never reaches the archive.
- **Not every silent catch is a bug.** `build-info`, `core/copy`, `core/theme`, `core/deviceId` swallow deliberately (missing git metadata, clipboard fallback, absent localStorage) and must **stay** silent with a comment recording why — otherwise the next audit re-litigates them and trace-level noise buries the real signal. Only swallows that hide a genuine failure get a line.
- **The client is not segregated from the server in the logs — it is absent from them.** `client/src` has zero `console.*`, zero error boundary, zero `window.onerror`, zero `unhandledrejection` handler, and many literal `.catch(() => {})`; `main.tsx` renders straight into `<App />` so a render throw white-screens with nothing recorded anywhere. 100% of `storage/logs/` is server-side, and `module` separates server modules from each other — there is no client/server axis at all. Browser hangs, failed fetches, and SSE drops are invisible, which is half the "hangs and error logs" this plan is for.
- **Client logging is not optional for a multi-device appliance.** Bifrost exists to be opened from phones and tablets on the LAN — that is the product. The owner is not sitting at those devices, so a React crash or failed upload on a phone has **no path back** today: no console anyone reads, no report, no trace in `storage/logs/`. Server-side logging cannot cover it by construction, because the failure never reaches the server. This is the one observability gap where the data does not exist anywhere at all, as opposed to existing but being unqueryable.
- **Sourcemaps are a hard prerequisite, not polish.** `client/vite.config.ts` sets no `build.sourcemap`, so it defaults to `false` and production assets are minified with hashed names. Without maps every reported stack reads `AccioPage-B1aK7NYQ.js:1:48122` — enough to know something broke, useless for knowing where, which is most of the value. Set `build.sourcemap: true`: on a LAN-only app there is no reason to withhold source from your own network, and maps are fetched only when devtools opens. (`'hidden'` keeps maps off the wire but means resolving every trace by hand — wrong trade here.)
- **The client ships `warn` and above; it does not follow the server to `trace`.** The server logs everything because appending to a local file is free. Every client line crosses the network and lands in an unauthenticated endpoint, so the economics invert: `warn`/`error`/`fatal` plus a small set of deliberate lifecycle events, never `debug`/`trace`. A `CLIENT_LOG_LEVEL` setting can lower it temporarily when chasing something specific.
- **`CLIENT_LOG_LEVEL` needs a delivery route — the client is a static build and never sees `.env`.** It ships as a field on the `client-logs` module's own public `GET /api/client-logs/config`, exactly mirroring `/api/loki/config` and `/api/screensaver/config` (the established pattern for env-seeded, admin-tunable, client-read settings). The client fetches it once on boot and falls back to `warn` if the request fails, so logging never depends on the config round-trip succeeding.
- **Client logs ride the existing pipeline rather than a new one.** A batched `POST /api/client-logs` re-emitted through pino means browser errors land in the same files, ship via the same Alloy, and inherit the same backfill — no Faro, no extra container, no second retention story. The endpoint is an unauthenticated write path, so it is rate-limited and size-capped, and the client drops on failure rather than retrying into a crash loop.
- **`source` is a *child* binding, never a `base` one — verified trap.** pino's `child()` **appends to** `base` instead of overriding it, so `base: { source: 'server' }` + `child({ source: 'client' })` emits `{"source":"server","source":"client",…}` — a duplicate key. Every parser in the chain happens to take the last occurrence, so it would appear to work while resting on undefined behaviour. Instead: `moduleLogger()` binds `{ source: 'server', module }`, the client re-emitter binds `{ source: 'client', module }`, and root-logger lines (boot, shutdown, Fastify request logs) carry no `source` at all — Alloy defaults those to `server` with the same `stage.template` fallback pattern already used for `logLevel`. One key, one value, no reliance on parser quirks.
- **Values are `server`/`client`, matching the workspace names** (`server/`, `client/`) rather than backend/frontend, so the label reads the same as the directory the code lives in.
- **`module` becomes a cross-cutting label, which is the real prize.** Ten client features and server modules already share names exactly — `accio`, `edda`, `file-transfer`, `heimdall`, `loki`, `nimbus`, `previews`, `runestone`, `screensaver`, `variant`. If client lines reuse the feature name for `module`, then `{module="accio"}` returns **both halves of that feature** in one query, and `{module="accio", source="client"}` narrows to the browser side. The existing "Errors by module" panel starts covering the frontend for free instead of silently dropping it. Client-only features (`hermes`, `sigil`, `wardens`) and server-only modules (`audit-log`, `clipboard`, `presence`, `qr-tool`, `themes`, `health`) simply appear under one `source`.
- **macOS/Docker split is load-bearing.** Bifrost runs natively (PM2/launchd); the stack runs in Docker. Prometheus must scrape `host.docker.internal:4646`, not `localhost`. **`node_exporter` is deliberately excluded** — in Docker on macOS it measures the Linux VM, not the Mac, producing numbers that look real and mean nothing. All process metrics come from inside Node.
- **OTel is gated off by default (`OTEL_ENABLED=false`).** A dead OTLP endpoint makes the exporter retry and log connection errors into `storage/logs/` — observability tooling degrading the observability record. Flip it on only when the stack is up.
- **⚠️ Silencing the exporter makes Step 4 undiagnosable — bound the noise instead of muting it.** Four distinct failures all present identically as "no traces appear": the `--import` was missed so the SDK patched nothing (**silent by design — no error is raised**), the exporter cannot reach Tempo, Tempo ingests but the datasource/query is wrong, or sampling is misconfigured. Turning diagnostics fully off protects the archive but leaves no way to tell them apart. Two additions fix it: an **`otel: sdk started, endpoint=…, instrumentations=N` line at startup** — whose *absence* is the direct signal for the `--import` trap this plan already flags as the classic gotcha — and **rate-limited exporter-failure logging**: the first failure at `warn`, then at most one per five minutes. That is neither invisible nor a flood.
- **⚠️ `LOG_LEVEL=trace` buys future-proofing, not present-day output — the criteria must not overclaim it.** With zero `log.trace()` calls in the codebase, `trace` will never appear as a Loki label value, because label values only exist for lines that were actually written. Any criterion promising "the dropdown lists all six names" is unsatisfiable. What is verifiable: every level the code *emits* appears with a text name, and a temporary `log.trace()` proves the path end to end.
- **`/metrics` is unauthenticated on the LAN.** Prometheus has no session, so `requireAdmin` would break scraping. This matches the existing LAN trust model; an optional bearer token from `.env` is the escape hatch if that ever changes.
- **Heimdall's Logs section is deleted entirely — viewer *and* runtime level switch.** Grafana is the log UI now, so the tail, the module/level filters, the SSE follow stream, and `core/logtap.ts` all go. The level dropdown goes with them: **`LOG_LEVEL` in `.env` + a restart becomes the single source of truth**, which is a deliberate simplification, not an oversight.
- **This is the plan's biggest contract win.** Both `logTap` **and** `setLogLevel` leave `ModuleDeps` — the module contract loses two fields that only ever had one consumer. Three further things fall out with them: the `moduleLoggers[]` array in `app.ts` exists *solely* so `setLogLevel` can walk the pino children (they don't inherit a level change after creation), the "apply persisted level before child loggers are created" ordering constraint disappears, and the settings-table `logLevel` key must be **dropped from `applySettingsOverlay` and deleted from the DB** — leaving a stale persisted row with no UI to change it would strand the app at whatever level it was last set to, permanently.
- **`routes/observability.ts` no longer observes anything.** After the three log routes go it holds only `/about` and `/changelog`, and its deps shrink from seven fields to `config` alone (`log`, `logTap`, `setLogLevel`, `persistLevel`, `auth` all lose their last caller). Rename it `routes/about.ts` and let this plan take the observability name back.
- **Write every level to disk; filter only in Grafana.** With Heimdall's viewer gone the file is a pure archive feeding Loki, so level should be a *query-time* decision, not a write-time one that silently discards data you can never get back. `LOG_LEVEL` default moves **`info` → `trace`**. This is nearly free today: the codebase has **zero `log.trace` calls and only three `log.debug`** (two SSE connect/disconnect in `core/sse/index.ts`, one Accio title-fetch failure), and `createLogger` already pins every destination at `trace` with the root logger as the single gate — so this is a one-line default change, not a rework. The knob stays in `.env` as the escape hatch if a future dependency turns out to be noisy at trace.
- **`level` (numeric) is replaced by `logLevel` (text).** pino writes `level` as a number, so filtering in Grafana means `{level="50"}`, not `{level="error"}` — unusable as the primary log UI. `formatters.level(label) => ({ logLevel: label })` emits the text key **and drops the numeric one**, since a line carrying both is redundant once nothing reads the number. After Step 0 nothing does: `LogTap`, its `LEVEL_VALUE` map, and the Heimdall level filter — the only numeric consumers in the codebase — are all deleted by this same step. **Verified against the installed pino + `pino.transport()`** (formatters run in the main thread, so the transport worker is unaffected): output is `{"logLevel":"info","time":…,"msg":…}`.
- **Named `logLevel`, not `log-level`, because Loki label names forbid hyphens** (`[a-zA-Z_][a-zA-Z0-9_]*`). camelCase keeps one name across the JSON key and the Loki label — no rename in Alloy, no JMESPath quoting — and matches the existing field style (`responseTime`, `statusCode`).
- **Backward compatibility moves from the file to Alloy — the existing archive is never rewritten.** Old files keep numeric `level`, new files carry text `logLevel`, and a `stage.template` fills `logLevel` from the number when the key is absent. One `logLevel` label therefore spans the **whole** archive, and the numeric label is dropped as redundant. This is the same guarantee as keeping both keys, paid for once at ingest instead of on every line forever.
- **Three dashboard panels query `level=~"40|50|60"` today** (Errors+warnings/min, Errors by module, Recent warnings & errors) and **must** migrate to `logLevel=~"warn|error|fatal"` in this plan — they return nothing otherwise. Cheap to do and more readable, but it is a hard dependency of dropping the numeric label, not a nice-to-have.
- **`pino-pretty` must be told the new key, in both places that use it.** Verified: with the numeric key gone, default pino-pretty renders `[16:31:50.540] (40093): hello` with `logLevel: "info"` dangling as an ordinary property — no level name, no colour. Passing `levelKey: 'logLevel'` restores `[16:31:50.540] INFO (40093): hello`. That means the transport target in `createLogger` (dev stdout) **and** the root `logs` script (`tail -f … | pino-pretty --levelKey logLevel`). Miss the second and the designated no-Docker fallback silently degrades.
- **Fastify's default request logging stays.** Halving volume via `disableRequestLogging: true` was tempting, but it kills *both* auto-logs — including the `"request completed"` line carrying `responseTime`, which every latency panel in this plan depends on. Re-emitting it from a custom `onResponse` hook means owning a format Fastify currently maintains, for a disk saving that `LOG_RETENTION_FILES` already solves. Not worth the risk to the plan's core signal. Step 3's histogram gets its templated `route` label from its own `onResponse` hook, which needs none of this.
- **Trace-level logging forces the retention question.** `rollOptions` sets daily rotation and a 20 MB size cap but **no `limit`**, so rotated files accumulate forever (6 MB across five files today). More volume makes that a real disk-growth path on an appliance meant to run unattended. Add an explicit file-count limit, env-driven as `LOG_RETENTION_FILES` — Loki holds the searchable history, so the local files only need to cover the window before Alloy catches up.
- **Accepted trade-off:** with the viewer gone there is no in-app log view when Docker is down, and changing log level needs a restart. `npm run logs` and `jq` on `storage/logs/*.log` cover reading from the terminal; the snapshot means the numbers that matter are captured regardless of level.
- **Module name `metrics`** — kebab-case, doubles as commit scope and capability name.

## API contracts

| Method & path | Purpose |
| --- | --- |
| `GET /metrics` | Prometheus text exposition (Step 3). Unauthenticated on LAN; both profiles |
| `POST /api/client-logs` | Batched browser errors → pino with `source:"client"` (Step 1). Rate-limited + size-capped |
| `GET /api/client-logs/config` | Public; ships `CLIENT_LOG_LEVEL` to the static bundle (the `/api/loki/config` pattern) |
| ~~`GET /api/heimdall/logs`~~ | **Deleted** — Grafana/Loki replaces it |
| ~~`GET /api/heimdall/logs/stream`~~ | **Deleted** — SSE log follow |
| ~~`PATCH /api/heimdall/logs/level`~~ | **Deleted** — `LOG_LEVEL` in `.env` + restart is the only control |

Log-line contract for the snapshot (`module: "metrics"`, `msg: "snapshot"`):

| Field | Meaning |
| --- | --- |
| `cpuPct` | Process CPU % over the interval (`process.cpuUsage()` delta) |
| `rssMb`, `heapUsedMb` | Resident set / used heap |
| `loopLagP50Ms`, `loopLagP99Ms` | `monitorEventLoopDelay()` percentiles, reset each interval |
| `uploadsDelta` | Uploads since last snapshot |
| `sseClients` | Currently connected SSE clients |
| `diskMb` | Total bytes across watched folders. **Sampled on the slow cycle only** (`METRICS_DISK_INTERVAL_SEC`, default 1800); intervening snapshots carry the last value, and it is `null` before the first slow tick |
| `uptimeSec` | `process.uptime()` |

`uploadsDelta` is always `0` under the cloud profile — `file-transfer` is local-only, so no upload events exist to count. Expected, not a bug.

## Tasks

### Step 0 — Remove the Heimdall Logs section; Grafana becomes the only log UI

- [ ] Delete `LogsSection` from `client/src/features/heimdall/sections.tsx` + its entry in the section registry; drop `fetchLogs`, `setLogLevel`, `LOGS_STREAM_URL`, `LogEntry`, `LogsResponse`, `LogLevel`, `LOG_LEVELS` from `api.ts`
- [ ] Delete all three log routes from `routes/observability.ts`, plus `sessionStreamLive`, `LEVEL_VALUE`, `HEARTBEAT_MS`, and both JSON schemas. Rename the file `routes/about.ts`; its deps collapse to `config`
- [ ] Delete `server/src/core/logtap.ts` + tests; drop the tap stream from `createLogger` (the `pino.multistream` branch goes — the transport is the only sink again)
- [ ] Drop **`logTap` and `setLogLevel`** from `ModuleDeps`, `app.ts`, and `heimdall/module.ts`; delete the `moduleLoggers[]` array and the persisted-level ordering comment
- [ ] Remove `logLevel` from `applySettingsOverlay` + a migration deleting the stale settings row, so `LOG_LEVEL` in `.env` is authoritative
- [ ] Prune `observability.int.test.ts` → `about.int.test.ts`; drop `manage-settings` coverage for the removed key
- [ ] `LOG_LEVEL` default `info` → `trace` in `core/config` + `.env.example`, with a comment saying why (archive feeds Loki; filter at query time)
- [ ] Add `LOG_RETENTION_FILES` (default ~30) → pino-roll's file-count `limit` in `rollOptions`; confirm the option shape against the installed pino-roll version
- [ ] `core/logger`: `formatters.level(label) => ({ logLevel: label })` — numeric `level` dropped from new lines
- [ ] `levelKey: 'logLevel'` on the pino-pretty transport target **and** in the root `logs` npm script
- [ ] **Fix `npm run logs`, which is already broken:** it tails `storage/logs/app.log`, but pino-roll's symlink is `current.log` and no `app.log` exists. Point it at `current.log`. This command is the designated no-Docker fallback, so it has to actually work
- [ ] `observability/alloy/config.alloy`: promote `logLevel`; `stage.template` fills it from numeric `level` when absent (pre-change files); drop the numeric label; rewrite the "level is numeric" comment
- [ ] Migrate the three numeric-level panels to `logLevel=~"warn|error|fatal"` / `"error|fatal"` — **required**, they break otherwise
- [ ] Dashboard: `logLevel` + `module` template variables, wired into "Recent warnings & errors" so it becomes a general filterable log explorer

### Step 1 — Logging coverage: fill the server gaps, give the client a voice

Audited at plan time: **36 log calls server-wide** (19 info / 9 warn / 5 error / 3 debug / **0 fatal**) against **34 catch sites, ~22 logging nothing**, and **zero client-side logging of any kind**.

- [ ] `process.on('uncaughtException')` + `('unhandledRejection')` → `logger.fatal` then flush and exit. Today a crashing process leaves no trace — the exact case the snapshot exists to explain
- [ ] `app.ts:203`: config failure writes to `stderr` + `process.exit(1)`, bypassing the logger, so the commonest startup failure never reaches Loki. Emit a `fatal` line (flushed) before exiting
- [ ] Log the shutdown reason (signal vs error) on the existing shutdown path
- [ ] Work the silent-catch list; add `warn`/`error` where the swallow hides a real failure — `upload-audit-recorder` (reconcile skips rows), `fs-stats-reader` (the disk walk behind Heimdall stats *and* the new `diskMb`), `get-download-stream`, `manage-settings`, `db-accio-repository`. **Leave the deliberate fallbacks silent** (`build-info`, `core/copy`, `core/theme`, `core/deviceId`) and comment why, so the next audit doesn't re-litigate them
- [ ] `source` as a **child** binding (not `base` — see the duplicate-key trap): `moduleLogger()` binds `{ source: 'server', module }`; the client re-emitter binds `{ source: 'client', module }`
- [ ] Alloy: promote `source` as a label; `stage.template` defaults it to `server` when absent, covering root-logger and Fastify request lines
- [ ] Client lines carry `module` = the feature name, so the ten shared names line up with their server counterparts and `{module="accio"}` spans both sides
- [ ] Client `ErrorBoundary` around `<App />` in `main.tsx` — a render throw currently white-screens with nothing recorded
- [ ] Client `window.onerror` + `unhandledrejection` handlers
- [ ] `client/vite.config.ts`: `build.sourcemap: true` — without it every reported stack is a minified hash and the feature is half-useless
- [ ] `client/src/core/log.ts`: batched, debounced `POST /api/client-logs`, dropping on failure (never a crash loop); **`warn`+ only**, floor settable via `CLIENT_LOG_LEVEL`
- [ ] Carry `route`, `deviceId`, and UA on client lines — "which device, which page" is the first question every time
- [ ] New `client-logs` server module — **scaffold via the `new-module` skill**; registered in **both profiles** (browser errors happen in cloud too). Rate-limited and size-capped (it is an unauthenticated write path), re-emitting through pino with `source:"client"` and the device id so browser errors land in the same archive
- [ ] `GET /api/client-logs/config` (public) shipping `CLIENT_LOG_LEVEL`; `CLIENT_LOG_LEVEL=warn` in `.env.example` + `core/config`; client fetches once on boot and falls back to `warn` if it fails
- [ ] Replace the blind `.catch(() => {})` sites in `client/src/core/` with reports through the new logger
- [ ] Dashboard: `source` + `module` template variables (both multi-select, both defaulting to All) wired into every log panel, so one pane splits into backend/frontend on demand; point "Errors by module" at both sources and add a stacked errors-by-source panel
- [ ] **Make this a standing convention, not a one-off cleanup.** `.agent/rules/coding.md` → "Errors & logging": every plan ships the critical logs for the code it adds — each new failure path gets a `warn`/`error`/`fatal` line where it is handled, and a deliberately silent `catch` carries a comment saying why silence is correct. Replace "No `console.log` outside scripts" with the positive rule now that a client path exists: client code logs through `core/log.ts`, never bare `console.*`
- [ ] `.agent/plans/README.md` → rules of engagement: a plan is not done until its failure paths are logged
- [ ] Add the logging line to `.claude/skills/new-module/SKILL.md` so scaffolded modules start with it

**16a wrap-up** — must land in the 16a PR, not deferred to 16b:

- [ ] `.agent/memory/decisions.md`: numeric `level` → `logLevel` (and why the archive is not rewritten), Heimdall Logs removed viewer + level switch, client logging introduced with `source`/`module` as cross-cutting labels, `LOG_LEVEL` default → `trace`
- [ ] Run the **`context-sync`** skill: `architecture.md`'s module table gains `client-logs`, the `core` list loses `logtap`, `project-structure.md` reflects the new client `core/log.ts`
- [ ] Update `.agent/memory/progress.md` in the 16a PR (`git.md` step 7)
- [ ] `verify` green before the PR

### Step 2 — Metrics snapshot (no containers, no dependencies)

- [ ] `server/src/modules/metrics/` — **scaffold via the `new-module` skill**; registered in **both** profiles
- [ ] Emit through a child logger **pinned at `trace`** (`log.child(bindings, { level: 'trace' })`) so raising `LOG_LEVEL` cannot silently kill the metrics record; `METRICS_ENABLED` is the only off-switch
- [ ] Sampler: `process.cpuUsage()` delta → `cpuPct`; `process.memoryUsage()`; `monitorEventLoopDelay({ resolution: 20 })` percentiles then `.reset()`; `sse.clientCount` (already public — no new API needed)
- [ ] Deltas via `EventBus` subscription (upload events) — a counter reset to 0 each snapshot, **never** cumulative. No cross-module imports; `sse` and `bus` come from `ModuleDeps`
- [ ] Lift the recursive disk walk out of `heimdall/services/fs-stats-reader.ts` into `core/` and repoint **both** Heimdall and metrics at it — modules cannot import each other, and one walker beats two
- [ ] Sample `diskMb` on its own slow timer (`METRICS_DISK_INTERVAL_SEC`, default 1800), carrying the last value between ticks and `null` before the first — **never** per snapshot, or the sync walk becomes a 60s lag spike the sampler then records
- [ ] Both timers `.unref()`d so they never hold the process open; wired into the existing shutdown path
- [ ] Config: `METRICS_ENABLED=true`, `METRICS_SNAPSHOT_INTERVAL_SEC=60`, `METRICS_DISK_INTERVAL_SEC=1800` in `.env.example` + `core/config`
- [ ] Grafana: **Runtime** row on `observability/grafana/dashboards/bifrost.json` — loop lag p99, CPU %, RSS, uploads/day. No Alloy change needed (JSON is parsed at query time, so nothing becomes an ingestion label)
- [ ] Add the latency panels the existing `responseTime` already supports: `quantile_over_time(0.95, {job="bifrost"} | json | unwrap responseTime [5m])`

### Step 3 — Prometheus (`prom-client` + one container)

- [ ] `prom-client` in `server`; `collectDefaultMetrics()` + `GET /metrics` on the `metrics` module
- [ ] `bifrost_http_request_duration_seconds{route,method,status}` histogram via a Fastify `onResponse` hook
- [ ] Gauges fed from the same sampler as Step 2 — one source of truth, two exposition formats
- [ ] Prometheus service in `docker-compose.observability.yml` + `observability/prometheus/prometheus.yml` scraping `host.docker.internal:4646`
- [ ] Provision the Prometheus datasource; add a PromQL row to the dashboard

### Step 4 — Tempo + OpenTelemetry

- [ ] `@opentelemetry/sdk-node`, `auto-instrumentations-node`, `exporter-trace-otlp-http`; `server/src/otel.ts`
- [ ] **Load before the app**: `node --import ./dist/otel.js dist/bootstrap.js` — ESM hoists imports, so initialising inside `bootstrap.ts` silently instruments nothing. Update `ecosystem.config.cjs`, the root `start` script, and `Dockerfile`
- [ ] `OTEL_ENABLED=false` default + `OTEL_EXPORTER_OTLP_ENDPOINT`; short timeout, small queue
- [ ] **Startup line `otel: sdk started, endpoint=…, instrumentations=N`** — its absence is how you detect the `--import` trap, which raises no error of its own
- [ ] **Rate-limited exporter-failure logging**: first failure at `warn`, then ≤1 per 5 minutes. Not silent (undiagnosable), not unbounded (destroys the archive)
- [ ] Tempo service + `observability/tempo/tempo.yml`; datasource with the Loki→Tempo trace-ID correlation
- [ ] Emit `trace_id` into the pino line so a log jumps to its trace

### Wrap-up (16b)

- [ ] Grafana alert rules: error rate > N/min, loop lag p99 > 100ms
- [ ] `docs/observability.md` — what is durable vs on-demand, and why
- [ ] `.agent/memory/decisions.md`: the snapshot-as-record decision, deltas-not-counters, the `node_exporter`-on-macOS exclusion, the slow-cycle `diskMb` sampling, and snapshots being level-independent
- [ ] Run **`context-sync`** again for the `metrics` module + the new observability services
- [ ] Update `.agent/memory/progress.md` in the 16b PR (`git.md` step 7)
- [ ] Archive this file to `.agent/plans/completed/` as part of the 16b PR

## Acceptance criteria

Criteria 8–17 gate **16a**; 1–7 gate **16b**.

1. With Docker **never started**, Bifrost runs for a day and `storage/logs/current.log` contains one `module:"metrics"` snapshot per interval with every contracted field populated and plausible.
1a. **Snapshots survive a raised log level.** With `LOG_LEVEL=error`, ordinary `info` lines stop but snapshots keep landing; only `METRICS_ENABLED=false` stops them.
1b. **The sampler does not cause lag.** Over an hour of idle running, `loopLagP99Ms` shows no recurring spike on the snapshot interval — proving `diskMb` is on the slow cycle and the sync walk is not running every 60s. Forcing `METRICS_DISK_INTERVAL_SEC` low reproduces the spike, confirming the test can detect it.
2. Starting the stack after ≥2 days off, Grafana's Runtime row shows the **entire gap backfilled** — the metrics history is as complete as the log history.
3. A deliberate synchronous block (a large `readdirSync`, or a `while` spin) shows as a `loopLagP99Ms` spike in Grafana at the right timestamp.
4. `uploadsDelta` summed over 24h in LogQL equals the upload count Heimdall reports, **including across a Bifrost restart**.
5. `METRICS_ENABLED=false` stops the snapshots with no other behaviour change; the timer never blocks shutdown.
6. With `OTEL_ENABLED=true` and Tempo **down**, the app starts, serves normally, and logs the failure **once** at `warn` then at most once per five minutes — neither silent nor flooding. (Note: a mute implementation would pass "does not flood" trivially, which is why the positive half is part of the criterion.)
6a. **Step 4 actually works — the positive case.** With Tempo up, one request produces a trace containing **both an HTTP span and a DB span**, and the `trace_id` on the matching Loki log line jumps to that trace in Grafana. Without this, Step 4 can ship entirely non-functional and still pass every other criterion.
6b. **The `--import` trap is detectable.** Booting with the flag produces the `otel: sdk started …` line; booting without it does not — so "no traces" can always be told apart from "never instrumented".
7. Prometheus scrapes `/metrics` from Docker; stopping it for an hour leaves a visible gap that does **not** corrupt the snapshot record — proving which path is the source of truth.
8. Heimdall has no Logs section; all three `/api/heimdall/logs*` routes 404; `ModuleDeps` no longer carries `logTap` or `setLogLevel` and every module still compiles.
9. A DB that previously held a persisted `logLevel` row upgrades cleanly and honours `.env` afterwards (verified on both an upgraded and a fresh DB, per the `db-migration` skill).
10. New lines carry `"logLevel":"info"` and **no `level` key at all**. At the new default an SSE connect writes a `debug` line, queryable as `{job="bifrost", logLevel="debug"}` — text, not `20`. Grafana's dropdown lists **every level the code actually emits** (`debug`/`info`/`warn`/`error`, plus `fatal` once Step 1's handlers fire) — *not* all six, since `trace` cannot appear as a label value while no `log.trace()` call exists.
10a. **The trace path is proven end to end, not just at the formatter.** A temporary `log.trace()` line reaches disk and is queryable as `{logLevel="trace"}`; removing it again leaves the default intact. This is what makes `LOG_LEVEL=trace` more than a config change.
11. **Old and new files filter identically.** A `logLevel="error"` query spans log files written before and after this plan, returning matches from both — proving the Alloy fallback covers the pre-change archive and nothing was orphaned.
12. `npm run logs` **actually tails a file that exists** (the pre-existing `app.log` path bug is fixed) and renders `INFO`/`WARN`/`ERROR` with colour on new lines; dev-mode stdout does the same — the no-Docker fallback is intact, not silently degraded.
13. Log volume at trace over a normal day stays within the rotation budget, and `LOG_RETENTION_FILES` bounds `storage/logs/` — verified by forcing rotation rather than waiting for it.
14. A thrown `uncaughtException` and a rejected promise each produce a `fatal` line **on disk** before the process exits; a deliberately broken `.env` does too, instead of only reaching `stderr`.
15. A forced React render error shows the error boundary's fallback UI (not a white screen) and appears in Grafana as `{source="client", logLevel="error"}` — with a stack naming a **real source file and line**, not a minified hash, proving sourcemaps are wired. A browser `unhandledrejection` does the same.
15a. The error is triggered **from a phone on the LAN** and lands in the archive with that device's id and route — the case server-side logging can never reach.
15b. Client `debug`/`info` calls send nothing over the wire at the default level; lowering `CLIENT_LOG_LEVEL` via `GET /api/client-logs/config` starts them flowing **without a rebuild**, and the client still logs at `warn`+ when that config request fails.
16. `source` cleanly splits the two: `{source="server"}` and `{source="client"}` each return only their own lines and together account for **every** line in the range (nothing unlabelled — the Alloy default covers boot and request lines). The dashboard variable switches between them without editing a query.
16a. **No line carries a duplicate `source` key** — grep the raw file to prove the child-binding fix held, since the failure mode is silent and only shows up as a mislabelled panel.
16b. `{module="accio"}` returns client *and* server lines in one result; adding `source="client"` narrows it to the browser side. "Errors by module" counts both halves.
17. Flooding `POST /api/client-logs` is rate-limited and oversized payloads rejected — a misbehaving tab cannot fill `storage/logs/`; the client keeps working when the endpoint refuses it.
18. `.agent` docs match reality after each PR (`context-sync` run, `architecture.md` module table current), and both PRs' decisions are in `decisions.md` before merge — 16a's are not deferred to 16b.

## Tests

- [ ] Unit: CPU-percent maths across an interval, delta counters reset per snapshot (property: sum of deltas = total events), snapshot serialisation shape
- [ ] Unit: sampler with an injected clock — no real timers in tests; `diskMb` recomputes only on the slow cycle and carries its previous value otherwise
- [ ] Unit: the trace-pinned child still emits when the root logger sits at `error`
- [ ] Unit: the shared `core` disk walker returns the same totals Heimdall reported before the lift (guards the refactor)
- [ ] Integration: `/metrics` exposition parses; the `onResponse` histogram records the right route label; `METRICS_ENABLED=false` registers no timer
- [ ] Kill test: `SIGTERM` mid-interval exits cleanly with no dangling handle
- [ ] Regression: the deleted Heimdall routes 404; settings overlay ignores a legacy `logLevel` row; `verify` (lint, typecheck, tests, build) green
- [ ] Unit: `LOG_LEVEL` default is `trace`; `LOG_RETENTION_FILES` reaches `rollOptions` as the file-count limit
- [ ] Unit: the level formatter emits `logLevel` with the right label at all six levels and **no `level` key**
- [ ] Manual: an old rotated file and a new one, both in Loki, return matches for the same `logLevel` query
- [ ] Integration: `/api/client-logs` accepts a batch and re-emits with `source:"client"`; rejects oversized bodies; rate limit trips; `/config` returns the env-seeded level
- [ ] Client unit: the error boundary renders its fallback and reports once (not per re-render); the batcher drops rather than retries when the endpoint fails
- [ ] Manual: kill the process with an uncaught throw and confirm the `fatal` line reached disk before exit
- [ ] Unit: exporter-failure logging is rate-limited — N failures in a minute produce one line, not N
- [ ] Live-verify: stack up, snapshot lines land in Loki, panels render, the `logLevel` dropdown filters by name across every emitted level, and a temporary `log.trace()` appears end to end
- [ ] Live-verify (Step 4): a request yields an HTTP + DB span in Tempo, and the log line's `trace_id` jumps to it
