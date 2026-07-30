# Observability (the Grafana view of the logs)

Bifrost logs structured pino JSON to `storage/logs/` — rotated `app.N.log` files
with a `current.log` symlink on the active one, kept to `LOG_RETENTION_FILES`
rotations. That alone is the source of truth (`npm run logs` pretty-prints it).
This stack is a Grafana view on top; it is never load-bearing.

Since PLAN-16a it is also **the** log UI: Heimdall's in-app viewer, its filters,
and its runtime level switch are gone. `LOG_LEVEL` in `.env` (default `trace`)
plus a restart is the only control, because with no in-app reader the file is a
pure archive and the level belongs at query time, not write time.

**Files-first, fully detachable.** Alloy tails the log files and records how far
it read, so the stack can be down for weeks and backfill the entire backlog on
the next start. Bifrost neither knows nor cares whether it's running — so it's
safe to leave off and spin up only when you want to look.

## Start / stop

One command (wraps the compose calls below):

```bash
sh scripts/observability.sh          # start + print the Grafana URL
sh scripts/observability.sh logs     # follow the stack's logs
sh scripts/observability.sh down     # stop  (add -v to wipe stored logs)
```

Or drive compose directly:

```bash
docker compose -f docker-compose.observability.yml up -d
open http://localhost:3000        # admin / bifrost  — change the password

docker compose -f docker-compose.observability.yml down      # stop
docker compose -f docker-compose.observability.yml down -v    # + wipe stored logs
```

The **Bifrost** dashboard is auto-provisioned (requests/min, errors + warnings,
uploads, watcher events, errors-by-module, errors-by-source, request throughput,
and a filterable log explorer). Three template variables sit at the top:
**Source** (`server` / `client`), **Module**, and **Level**.

## What is durable, and what is not

This is the distinction the whole setup rests on. Three signals, three very
different guarantees:

| Signal | How it gets there | If the stack is down |
| --- | --- | --- |
| **Logs** (incl. the metrics snapshot) | Bifrost writes files; Alloy **tails** them and remembers its position | Nothing is lost. The whole gap backfills on the next start |
| **Prometheus metrics** | Prometheus **scrapes** `/metrics` | The data never existed. A gap cannot be backfilled, ever |
| **Traces** | The app **pushes** to Tempo | The exporter buffers, retries, then drops |

So the **system of record is the log archive**, and the runtime history inside it
is the `module:"metrics"` snapshot — one line per `METRICS_SNAPSHOT_INTERVAL_SEC`
carrying CPU, memory, event-loop lag percentiles, SSE clients, uploads and disk
use. It survives with zero Docker dependency, which matters because Bifrost runs
far more often than this stack does: "why did it hang at 3am last Tuesday?" can
only be answered by something that was already writing at 3am.

Prometheus and Tempo are **accelerators** for investigating something while the
stack is up. They are not storage you can lean on, and the dashboard is laid out
to say so — the Runtime row reads the log archive, and the Prometheus row is
labelled "live only, gaps do not backfill".

Two details that follow from this:

- **Snapshots are level-independent.** They are log lines, so raising
  `LOG_LEVEL` would otherwise silently stop the record. The metrics module logs
  through a `trace`-pinned child, leaving `METRICS_ENABLED=false` as the one
  intended off-switch.
- **`diskMb` is sampled on its own slow cycle** (`METRICS_DISK_INTERVAL_SEC`).
  The folder walk is synchronous and recursive; running it every snapshot would
  block the event loop every snapshot, and the sampler would then faithfully
  record the lag spike it had just caused.

## Tracing (off by default)

`OTEL_ENABLED=false` ships as the default deliberately: a dead OTLP endpoint
makes the exporter retry and log connection errors into `storage/logs/` —
observability tooling degrading the observability record. Turn it on when the
stack is up.

The SDK is loaded with **`node --import ./server/dist/otel.js`** (npm start, PM2
and Docker all do this). It cannot be initialised from application code: ESM
hoists imports, so the instrumentations would patch nothing — and that failure
raises no error at all. Four different faults present identically as "no traces
appear", so two things tell them apart:

- the boot line **`otel: sdk started, endpoint=…, instrumentations=N`**, whose
  *absence* means the `--import` was missed;
- **rate-limited exporter failures** on stderr — the first one immediately, then
  at most one per five minutes, carrying a count of what it swallowed.

Every log line written inside a span carries `trace_id`, so a line in the log
explorer links straight to its trace, and Tempo links back to the logs.

## How it fits together

```
storage/logs/app*.log ──tail──▶ Alloy ──push──▶ Loki  ◀─┐
   (pino JSON, incl.   (labels source+module+logLevel)   │
    metrics snapshots)                                   ├─query── Grafana
GET /metrics          ◀──scrape── Prometheus  ◀──────────┤        (dashboard,
   (prom-client)                                         │         alerts)
spans ────────────────push──────▶ Tempo       ◀──────────┘
   (OTel, off by default)
```

- **Alloy** (`observability/alloy/config.alloy`) tails `storage/logs/app*.log`
  (bind-mounted read-only), parses each pino line, and promotes `logLevel`,
  `module`, and `source` to Loki labels.
  - The glob is `app*.log`, not `*.log`: `current.log` is a **symlink** onto the
    active file, so a wider glob would ingest every live line twice and double
    every count on the dashboard.
  - `logLevel` is the text level name. Lines written before PLAN-16a carry
    pino's numeric `level` instead, so Alloy fills `logLevel` in from it at
    ingest — one query therefore spans the whole archive, and the old files are
    never rewritten.
  - `source` separates this process from the browsers. Server module lines carry
    it explicitly; boot, shutdown, and request lines have no binding, so Alloy
    defaults those to `server`.
- **Loki** (`observability/loki/config.yml`) stores on a local filesystem
  volume; `reject_old_samples: false` is what lets it accept the backlog.
- **Prometheus** (`observability/prometheus/prometheus.yml`) scrapes
  `host.docker.internal:4646` — **not** `localhost`, because Bifrost runs native
  on macOS while this runs in a container. `node_exporter` is deliberately
  absent: in Docker on macOS it would measure the Linux VM rather than the Mac,
  producing numbers that look real and mean nothing. Every process metric comes
  from inside Node instead.
- **Tempo** (`observability/tempo/tempo.yml`) accepts OTLP/HTTP on 4318 and
  keeps blocks for 48h — recent investigation only, by design.
- **Grafana** provisions the Loki datasource and the dashboard from
  `observability/grafana/`.

## Browser logs

`{source="client"}` is not the server talking about a browser — it is the
browser itself. Bifrost is opened from phones and tablets the owner is not
sitting at, so a React crash or a failed upload there reaches the archive
through nothing else: the failure never touches the server.

The client batches those reports to `POST /api/client-logs`, and the
`client-logs` module re-emits them through the same pino instance — same files,
same rotation, same Alloy, same backfill. Ten feature names exist on both sides
(`accio`, `edda`, `file-transfer`, `heimdall`, `loki`, `nimbus`, `previews`,
`runestone`, `screensaver`, `variant`), so `{module="accio"}` returns **both**
halves of a feature and adding `source="client"` narrows it to the browser.

- The client ships **`warn` and above** — every line crosses the network into an
  unauthenticated endpoint. `CLIENT_LOG_LEVEL` lowers the floor; clients pick it
  up from `GET /api/client-logs/config` without a rebuild, and the server
  enforces the same floor on the way in.
- `CLIENT_LOG_RATE_LIMIT_PER_MIN`, `CLIENT_LOG_MAX_BATCH`, and
  `CLIENT_LOG_MAX_BODY_KB` bound that write path so a misbehaving tab cannot
  fill `storage/logs/`. A refused batch is dropped, never retried.
- Stacks resolve to real files and lines because the client build ships
  sourcemaps (`build.sourcemap: true`), which browsers fetch only when devtools
  is open.

## Notes

- Works regardless of how Bifrost runs — native (PM2/launchd) or in Docker —
  because Alloy tails the log *files*, not the process.
- The dashboard is a **starter**. Some panels (uploads, watcher events) match on
  log message substrings (`file.uploaded`, `download.added`); refine the LogQL
  against your real logs in Grafana and re-export the JSON to
  `observability/grafana/dashboards/bifrost.json` to keep it provisioned.
- Change the Grafana admin password (`GF_SECURITY_ADMIN_PASSWORD`) before
  exposing port 3000 anywhere but localhost.
- Two alert rules ship provisioned (`observability/grafana/provisioning/
  alerting/`): error rate and event-loop lag. Both query **Loki**, not
  Prometheus, so they keep meaning something over an archive that backfills —
  a rule against a scraped series would silently evaluate over holes.
- `/metrics` is unauthenticated on the LAN. Prometheus carries no session, so a
  guard would not secure anything, it would just stop the scrape; the endpoint
  exposes counters and gauges, never content.

## Verify (owner)

Acceptance 4: bring the stack up → the dashboard shows live data within a
minute of traffic; stop Bifrost or the stack independently → the other is
unaffected; bring the stack back up → the gap backfills from the log files.
