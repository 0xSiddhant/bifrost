# Performance: the load harness

`npm run test:load` measures the **built** server under load (PLAN-34). It starts the production entry (`node --import server/dist/otel.js server/dist/bootstrap.js`) on scratch storage and an OS-assigned port, seeds it through the API, runs one profile, reads the server's own `/metrics` while it does, then prints a table and writes `load-results/<profile>-<timestamp>.json`.

It is **on demand, never a CI gate** (see [Why it is not in CI](#why-it-is-not-in-ci)). Run it before a release or after a change that could affect speed or memory, on the machine Bifrost actually runs on.

```bash
npm run build                                  # the harness runs dist, not the source
npm run test:load                              # the load profile: every scenario, 20 connections × 20 s
npm run test:load -- --profile stress          # where is the knee?
npm run test:load -- --profile spike           # does it recover from a burst?
npm run test:load -- --profile soak            # 60 minutes: does it leak?
npm run test:load -- --profile fanout          # 200 SSE listeners, 4 × 1 GB streams, a Brotli round trip
```

## Profiles

| Profile  | Question                              | What it does                                                                                                                                       | Default                                     |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `load`   | What does normal look like?           | Every read, write and mixed scenario at a fixed connection count, one after the other                                                              | 20 connections × 20 s per scenario (~9 min) |
| `stress` | Where is the knee?                    | The mixed scenario at 10 → 20 → 50 → 100 → 200 → 500 → 1000 connections, until p99 > 1 s or more than 1% of requests go wrong                      | 20 s per step                               |
| `spike`  | Does it recover?                      | A one-connection probe runs throughout: 10 s alone, 10 s beside the mixed scenario at 10× the load connections, 30 s alone again                   | 200 connections in the burst                |
| `soak`   | Does it leak or drift?                | The mixed scenario at half the load connections; `/metrics` every 15 s; a straight line fitted to memory after a 10-minute warm-up                 | 60 minutes, 10 connections                  |
| `fanout` | What do connections and streams cost? | SSE listeners and 20 saves; concurrent large uploads, each read back as two `Range` halves; a folder archive; a Brotli round trip at the input cap | 200 listeners, 4 × 1 GB uploads             |

**Scenarios** (in `load`, `stress` and `spike`):

- **Read:** `/api/health`, `/api/capabilities`, each document kind's legacy and paged list, a document by slug, a raw document, the Accio and Portkey paged lists, and `/go/:slug` redirects (not followed, and each one counts a hit).
- **Write:** create → update → delete triples for a runestone, an Accio link and a go-link. Every body and slug is unique, so writes never collide on a 409, and each triple leaves the database the size it found it.
- **Mixed:** 80% reads and 20% writes (36 reads drawn across the read scenarios and three write triples per cycle).

**Seeding**, before every profile and through the API only: 2,000 documents across the four kinds (1–200 KB, log-uniform), 1,000 Accio links, 500 go-links, 20 download files and 2 folders. Its own throughput is the first line of the report.

## Flags

| Flag                                                      | Default      | Meaning                                                                                         |
| --------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `--profile <name>`                                        | `load`       | `load`, `stress`, `spike`, `soak` or `fanout`                                                   |
| `--connections <n>`                                       | 20           | Load connections; stress ramps on its own steps, spike uses 10×, soak ½                         |
| `--duration <s>`                                          | 20           | Seconds per scenario (`load`) or per step (`stress`)                                            |
| `--minutes <n>` / `--warmup-minutes <n>`                  | 60 / 10      | Soak length, and the samples before the warm-up ends are not fitted                             |
| `--baseline <file>`                                       | —            | Compare against an earlier result: a ±% column, ⚠ on a move the wrong way past 10%              |
| `--strict`                                                | off          | Exit non-zero when the baseline comparison flags a regression                                   |
| `--log-level <level>`                                     | `trace`      | Override `LOG_LEVEL`, to measure trace logging's cost as a difference instead of guessing it    |
| `--contract <off\|fallback>`                              | `fallback`   | `API_CONTRACT_CHECK`. `strict` is refused: it validates every response with ajv                 |
| `--server-dist <path>`                                    | this build   | Run another build: a checkout (or its `server/dist`) with `server/dist` and `client/dist` built |
| `--keep`                                                  | off          | Keep the scratch storage for a post-mortem; its path is printed                                 |
| `--sse-listeners <n>`, `--uploads <n>`, `--upload-mb <n>` | 200, 4, 1024 | Fan-out sizes, for a smaller machine                                                            |

**Measured as configured.** Every `.env` value stays at its production default, including `LOG_LEVEL=trace`, because that is what the household runs. The only overrides are the three per-IP rate limits (lifted to 1,000,000/min: they exist to stop abuse and would turn every write into a 429 measurement) and the contract mode. The result file lists every override.

**Safety.** The harness takes no storage root and no port: it always uses a fresh `mkdtemp` storage and an OS-assigned port, so it cannot be pointed at `storage/` or at the running instance. `--storage-root`, `--port` and `--url` are refused. The stream scenarios check free space first and refuse below 3× the bytes they will write. Nothing leaves the machine: every Accio link is saved with a title (so nothing is fetched) on a loopback discard port.

## Reading a result

```
scenario                               conns  req/s  p50 ms  p90 ms  p99 ms  max ms    MB/s  bad
read: health                              20   8109     2.0     3.0     7.0    15.0    1.72    0
```

- **req/s**: completed requests per second, averaged over the scenario.
- **p50 / p90 / p99 / max**: latency percentiles in milliseconds, from the client's side: the time a request waited for the server, including queueing behind the other connections.
- **MB/s**: response bytes per second.
- **bad**: 5xx responses, connection errors, timeouts (no answer in 10 s) and responses whose status the scenario does not expect. Any of these fails the run.
- **server metrics**: resident memory, heap used, event-loop lag p99 and open handles, from `/metrics`, first sample → last (and the peak).
- **summary**: each profile's own verdict. `stress` gives the last connection count that held and why the next broke; `spike` the pre-spike p99, the bound it must return under (20% above it, or 5 ms, whichever is larger), how long after the burst a 2 s window of probe requests was back under it, and the probe's p99 for every second of the run (`probeBySecond` in the result file); `soak` the memory growth in MB/min after the warm-up; `fanout` the SSE delivery p50/p99/max (from the moment a save is sent to the moment each listener reads its event), the memory per listener, the stream throughput and the RSS high-water mark.

**Exit codes.** `0` when every request was correct. `1` on any correctness failure: a 5xx, a connection error, a timeout, an unexpected status, a soak leak past 1 MB/min, a spike that never recovers or fails after recovering, or (with `--strict`) a flagged regression. `2` when the arguments are wrong. The breaking step of `stress` is the one exception: its timeouts are how it broke. Its 5xx responses still fail the run.

The client and the server share the machine, so at high connection counts the harness itself competes for CPU. The numbers describe the pair, which is fine for comparing two builds on one machine and wrong for quoting as the server's absolute capacity.

## Comparing two builds

`--baseline` compares a run with an earlier result. `--server-dist` runs the same workload against another build. Together they compare any two commits on one machine:

```bash
git worktree add /tmp/bifrost-before <commit>          # the build to compare against
(cd /tmp/bifrost-before && npm ci && npm run build)

npm run build
npm run test:load -- --server-dist /tmp/bifrost-before  # before
npm run test:load -- --baseline load-results/load-<before timestamp>.json   # after, with the ±% column

git worktree remove --force /tmp/bifrost-before         # git worktree list shows only the main checkout
```

Latencies are whole milliseconds, so a ⚠ on a single-digit p50 (1 → 2 ms reads +100%) is one rounding step, not a regression; judge the req/s and the larger latencies. Run the two back to back, on an otherwise idle machine, and compare like with like: the same `--contract` and `--log-level`. A build from before PLAN-32b ignores `API_CONTRACT_CHECK`, so compare it against both `off` (the serializer's own effect) and `fallback` (what production pays today).

## Why it is not in CI

Throughput on a home server depends on what else the machine is doing, and on a shared CI runner on its neighbours. A threshold tight enough to catch a real 15% regression flaps on that noise, and a loose one catches nothing; a gate that flaps gets deleted. So the harness fails only on **correctness under load**, which is not noisy, and reports regressions for a person to judge. `--strict` turns them into a failure when you want one.

Results are never committed (`load-results/` is gitignored): they describe one machine on one day, and a committed baseline would be wrong on every other machine. Keep your own baseline file between runs.
