# PLAN-34 — Load, stress & soak testing

## Goal

Nothing measures how the server behaves under load. There is no throughput number, no latency figure, no idea where it breaks, and no evidence it does not leak over hours. The only performance promise the architecture makes ("flat memory at 2 GB" uploads) is now asserted once by PLAN-33, at a single size. This plan adds an on-demand harness, `npm run test:load`, that drives the **built** server on scratch storage with five kinds of workload:

- **load:** steady, realistic traffic → a baseline;
- **stress:** ramping until it breaks → the knee;
- **spike:** a sudden burst → recovery;
- **soak:** hours of mixed traffic → leaks and drift;
- **fan-out:** many SSE listeners and large streams → memory per connection and stream throughput.

It reads the server's own `/metrics` while it runs and writes a result file that a later run can be compared against. It is deliberately **not** a CI gate. The literal name is the name.

## Gate

PLAN-33 merged. Single PR, no parts. **Merge condition:** if the PR changes any product code (a one-line `perf(...)` fix), it must pass `npm test`, the full `npm run test:e2e` (Playwright UI, Vitest CLI and API suites), and `npm run test:api-diff -- --base develop` on seeded data with **zero** differences (the owner's real data was validated once at PLAN-32c and is not used again), since a performance fix must never change a response. A PR that changes only harness code still runs `npm test` and `test:e2e`.

## Verified against the codebase, not assumed

- **Reusable pieces from PLAN-32a/33:** the `e2e/` workspace's `support/server.ts` (spawns the production entry from `dist` on a free port with `mkdtemp` storage and env overrides, and stops it cleanly), its API-only seeding, its local title sink, the HTTP/cookie helpers from `e2e/api/support/`, and the lint rule that `e2e/**` imports no product source. The load harness is the same kind of code: an outside client of the built server.
- **What the server reports about itself:** `modules/metrics/registry.ts` calls prom-client's `collectDefaultMetrics({ prefix: 'bifrost_' })`, so `/metrics` serves:
  - resident memory, heap used and total;
  - event-loop lag (mean and percentiles);
  - GC duration;
  - active handles;
  - open file descriptors (Linux only);
  - the `http_request_duration_seconds` histogram, labelled by route **template**.

  `/metrics` is unauthenticated (deliberate, for Prometheus) and on when `METRICS_ENABLED=true`, the default.
- **Logging is on the hot path by default:** `LOG_LEVEL` defaults to `trace` and Fastify logs every request start and end to the pino file transport (a worker thread). Measured as-configured, that is part of the real cost.
- **Rate limits** would turn a load test into a 429 test: upload (60/min), Brotli (30/min) and client-logs (60/min) per IP, all `.env` keys. The Heimdall login throttle is in-process and not configurable, so the harness never loads login. It logs in once per run.
- **Single-flight endpoints:** Nimbus allows one speed test at a time (a second gets 409), so it is excluded from concurrency scenarios as a design property, not a bottleneck.
- **Paged vs legacy lists (PLAN-31):** the legacy array forms return up to 200/500 rows per call and the paged forms 30. Both are real traffic (the CLI and scripts use legacy, the app uses paged), so both are scenarios.
- **Tool:** `autocannon` 8.0.0 is not installed. It is a Node HTTP benchmarking library with a programmatic API, per-request setup hooks (for unique bodies) and HdrHistogram percentiles. It does not speak SSE, so fan-out uses raw `http` connections.
- **Before/after for PLAN-32:** response schemas also speed up JSON serialization (fast-json-stringify). The commit before PLAN-32b (the first schema change; 32a only adds tests) still builds a `dist` from a git worktree, and the API is unchanged across PLAN-32/33 apart from PLAN-33's document `bodyLimit` fix, so the same seeded workload runs against both.

## Scope

**In:**
- `npm run test:load` with the five profiles below, a seeding step, live `/metrics` sampling, a terminal report and a JSON result file.
- Comparison against a previous result file.
- A one-off before/after measurement of PLAN-32's serialization change, recorded in `progress.md`.
- `docs/performance.md`.

**Out:**
- CI gating on numbers. Results from a home server or a shared CI runner are too noisy to fail a build on, and a gate that flaps gets deleted.
- Tuning or fixing anything the harness finds. Findings are recorded and planned separately, unless a change is a one-line, obviously-correct fix (each logged).
- Load against the owner's running instance or real `storage/`, which the harness refuses (see below).
- Browser-side performance (bundle size, rendering).

## Decisions & reasoning

### On demand, never a CI gate; regressions are reported, and only fail on request

Throughput on a LAN Mac mini depends on what else the machine is doing. On a shared CI runner it depends on the neighbours. A threshold tight enough to catch a real 15% regression flaps on noise, and a loose one catches nothing. So:

- the harness exits non-zero only for **correctness** failures under load: any 5xx, any connection error or timeout, or a soak leak past its bound;
- regressions against a baseline are **reported** (a ±% column per metric, flagged past 10%);
- regressions fail the run only with `--strict`.

The owner runs it before a release or after a performance-sensitive change, on the machine Bifrost actually runs on.

### Measured as configured: production entry, production defaults

The server is the PLAN-33 spawn of `bootstrap.js` with `otel.js` preloaded. Every `.env` default is left alone, **including `LOG_LEVEL=trace`**, because that is what the owner runs. ⚠️ The harness **overrides PLAN-32's e2e default of `API_CONTRACT_CHECK=strict`**: strict mode validates every response with ajv, which would make every number meaningless. It runs the production default (`fallback`) unless `--contract off|fallback` says otherwise, and the report states which mode was used. The PLAN-32 before/after comparison is run twice, once with `off` (the serializer's real gain) and once with `fallback` (what production pays until the follow-up flips it off). Only rate limits are lifted (set to 1,000,000/min), since they exist to stop abuse and would otherwise turn every write scenario into a 429 measurement. `--log-level info` is offered as a flag so the cost of trace logging can be measured as a difference rather than guessed, and the report states which level was used.

### Safety: scratch storage only, enforced

The harness takes no `STORAGE_ROOT` and no port from the caller. It always uses PLAN-33's `mkdtemp` root and an OS-assigned port, so it cannot be pointed at `storage/` or at the running instance by mistake. Large-stream scenarios check free disk space in the temp volume first and refuse with a clear message when it is under 3× the planned bytes. Storage is deleted at the end unless `--keep` is given, for post-mortem.

### Seeding is part of the run, through the public API

Before any profile, the harness seeds over HTTP:

- 2,000 documents across the four kinds (realistic sizes, 1–200 KB);
- 1,000 Accio links, **always with a title**, so no title fetch leaves the machine;
- 500 go-links;
- 20 download files plus 2 folders.

Seeding through the API (PLAN-33's rule) keeps the harness a pure outside client. It is timed, and its own throughput is the first number in the report. Lists then page against realistic volumes rather than empty tables.

### Five profiles, each answering one question

| Profile | Question | Shape | Default |
|---|---|---|---|
| `load` | What does normal look like? | Fixed connections per scenario for a fixed time | 20 connections × 20 s per scenario |
| `stress` | Where is the knee? | Connections ramp 10 → 20 → 50 → 100 → 200 … until p99 > 1 s or errors > 1% | Stops at the first breaking step; reports the last good one |
| `spike` | Does it recover? | 10 s idle → 10 s at 10× load → 30 s idle | Reports time until p99 is back within 20% of the pre-spike value |
| `soak` | Does it leak or drift? | Mixed traffic for `--minutes` (default 60) | Samples `/metrics` every 15 s |
| `fanout` | What do connections and streams cost? | SSE listeners and concurrent large streams | 200 SSE listeners; 4 concurrent 1 GB uploads |

**Scenarios inside `load`, `stress` and `spike`:**
- **Read:** `/api/health`, `/api/capabilities`, each document kind's legacy and paged list, a document by slug, a raw document, Accio and Portkey paged lists, `/go/:slug` redirects (not followed).
- **Write:** create, update and delete for a document kind, an Accio link and a go-link. autocannon's per-request setup gives unique bodies and slugs, so writes never collide on 409.
- **Mixed:** 80% reads and 20% writes, weighted across the above.

**`soak`** runs the mixed scenario at half the `load` connection count. It then fits a straight line to resident memory and heap-used samples **after a 10-minute warm-up**, and fails when either grows faster than 1 MB/min. Over an hour that would be 60 MB of unexplained growth, well past noise for this process and well short of a real problem going unnoticed. Event-loop lag p99 and open handles are reported over time. A rising handle count with flat memory is its own kind of leak (sockets or timers).

**`fanout`:**
- **SSE:** opens the listeners as raw `http` requests, then performs writes. It measures delivery latency (write acknowledged → event received on every listener: p50, p99, max), RSS per listener (RSS delta ÷ count), and that every listener got every event.
- **Streams:** runs concurrent uploads of generated bodies, downloads with `Range`, and a folder `/archive`, recording MB/s each and the RSS high-water mark against the flat-memory promise.
- **Brotli:** a compress/decompress round trip at the configured caps.

### What a result is

Each run writes `load-results/<profile>-<ISO timestamp>.json`, gitignored. It holds:

- the git commit, Node version, OS, CPU model and core count;
- the server env overrides and log level;
- per scenario: requests/s, latency p50/p90/p99/max, error and status counts, bytes/s;
- the `/metrics` samples.

The terminal shows the same as a table. `--baseline <file>` adds the ±% column and the flags. Results stay **uncommitted**: they describe one machine on one day, and a committed baseline would be wrong on every other machine. The one exception is the summary of the PLAN-32 before/after run, which goes in `progress.md` as prose with its machine noted.

### The PLAN-32 before/after is a worktree, not a feature

`--server-dist <path>` points the harness at another `dist`. The PLAN-32 comparison is:

1. `git worktree add` the commit before PLAN-32b;
2. build it;
3. run `load` against both builds back-to-back on the same machine;
4. compare.

The flag is general-purpose: any two builds can be compared the same way. Comparing across git history is a documented recipe in `docs/performance.md`, not harness code.

### Where it lives

`e2e/perf/` inside PLAN-32a's workspace, under its `no-restricted-imports` rule, reusing `e2e/support/` and `e2e/api/support/` by import. The entry is `e2e/perf/run.ts`, run through `tsx` by the root script `test:load` (it needs `npm run build` first and says so if `dist` is missing). It is neither a Playwright project nor a Vitest suite: a load run is a measurement, not a pass/fail test suite, and it must never run inside `test:e2e` or CI. `autocannon` is an `e2e` devDependency.

## API contracts

None. The harness is an outside client of existing routes and adds no server code.

## Task checklist

**Harness**
- [x] `e2e/package.json`: `autocannon` (devDependency); `tech-stack.md` row
- [x] `e2e/perf/run.ts`: CLI (`--profile`, `--minutes`, `--connections`, `--baseline`, `--strict`, `--log-level`, `--contract`, `--server-dist`, `--keep`), `dist` presence check, disk-space check, spawn via `e2e/support/server.ts` with rate limits lifted
- [x] `e2e/perf/seed.ts`: the seeding set, over HTTP, timed
- [x] `e2e/perf/metrics.ts`: `/metrics` scraper + parser for the `bifrost_` default metrics and the request histogram; 15 s sampler
- [x] `e2e/perf/scenarios.ts`: read/write/mixed scenario definitions with unique-body setup
- [x] `e2e/perf/profiles/{load,stress,spike,soak,fanout}.ts`
- [x] `e2e/perf/report.ts`: terminal table, JSON result file, baseline diff, leak slope (least squares after warm-up)
- [x] `.gitignore`: `load-results/`; root `npm run test:load`
- [x] `e2e/tsconfig.json` includes `perf/` (the lint rule already covers `e2e/**`)

**Runs**
- [ ] One `load` + `stress` + `spike` run, and one 60-minute `soak`, on the owner's Mac, with results summarised in `progress.md` (numbers, machine, commit) *(Run on the Linux dev container, a 4-core Xeon, and summarised in `progress.md`; the run on the owner's Mac is left to the owner.)*
- [x] The PLAN-32 before/after `load` comparison, summarised in `progress.md`
- [x] Each finding: one-liner fixes are their own `perf(<scope>)` commit with before/after numbers, and pass the merge condition above (zero API-diff differences); anything bigger becomes a decisions.md row and a PLAN-99 row

**Cleanup (the end of the temporary scaffolding PLAN-32 introduced)**
- [x] After the merge-condition run passes, **delete `e2e/api-diff/` and the root `test:api-diff` script**: PLAN-34 is the last change it guards (PLAN-32's "What stays and what is deleted"). Remove its mentions from `docs/testing.md` and the `verify` skill
- [x] Remove the PLAN-32 before/after `git worktree`, every `--keep` storage and every scratch result outside `load-results/`; `git worktree list` shows only the main checkout
- [x] No probe or one-off script committed; the PR description lists everything deleted

**Docs**
- [x] `docs/performance.md`: how to run each profile, what each number means, how to compare two builds (the worktree recipe), why it is not in CI. Linked from `docs/testing.md` and `README.md`
- [x] `verify` skill: a one-line note that `test:load` is on demand, like `test:resilience`
- [x] `architecture.md`, `decisions.md`, `progress.md`; archive this file into `completed/` in the PR

## Acceptance criteria

1. `npm run test:load -- --profile load` seeds a scratch server through the API, runs every read, write and mixed scenario, prints the table, and writes a result file containing the run's machine, commit and settings.
2. The harness cannot be pointed at `storage/` or a caller-chosen port, and refuses large-stream scenarios when temp disk space is short.
3. `stress` reports the last connection count where p99 ≤ 1 s and errors ≤ 1%, and the step that broke it.
4. `spike` reports the recovery time after the burst, and the run fails if any request after recovery errors.
5. `soak` fails when resident memory or heap grows faster than 1 MB/min after warm-up, and passes on the current server for a 60-minute run (or the leak it finds is recorded as a finding).
6. `fanout` delivers every event to all 200 SSE listeners and reports per-listener memory and delivery p99; four concurrent 1 GB uploads complete with the RSS high-water mark reported against the flat-memory promise.
7. Any 5xx, connection error or timeout in any profile exits non-zero; a regression against `--baseline` is flagged but exits zero unless `--strict` is passed.
8. `--server-dist` runs the same workload against another build, and the PLAN-32 before/after comparison (contract `off` and `fallback`) is recorded in `progress.md`. No run ever uses `strict`.
9. No load request reaches the internet: every Accio link is saved with a title, and nothing is sent to an external host.
10. Any product-code change in this PR passes `npm test`, the full `test:e2e`, and the API diff against `develop` with zero differences, on seeded data.
11. After the PR, `e2e/api-diff/` and `test:api-diff` no longer exist, no worktree or scratch storage remains, and the PR lists what was deleted. The permanent suites (`test:e2e`, the contract guard, fuzz, security) are untouched.

## Test checklist

**Unit**
- [x] `perf/metrics.test.ts`: parses a recorded `/metrics` exposition, including histogram buckets
- [x] `perf/report.test.ts`: baseline diff percentages and flagging; leak slope on synthetic series (flat, linear growth, noisy-flat, warm-up spike)
- [x] `perf/run.test.ts`: argument parsing; refusal of `STORAGE_ROOT`/port overrides; the disk-space guard (criterion 2)

**Manual (the deliverable is the harness and its first readings)**
- [ ] `load`, `stress`, `spike` on the owner's machine (criteria 1, 3, 4) *(Run on the Linux dev container, a 4-core Xeon, and summarised in `progress.md`; the run on the owner's Mac is left to the owner.)*
- [x] 60-minute `soak` (criterion 5)
- [x] `fanout` (criterion 6)
- [x] A forced 5xx (a scratch build with a throwing route) exits non-zero (criterion 7)
- [x] PLAN-32 before/after via `--server-dist` (criterion 8)
- [x] With an outbound-connection monitor (`lsof -i` on the server pid during `load`), no external host is contacted (criterion 9)
