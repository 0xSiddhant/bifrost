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

## How it fits together

```
storage/logs/app*.log  ──tail──▶  Alloy  ──push──▶  Loki  ◀──query──  Grafana
    (pino JSON)      (labels source+module+logLevel)  (stores)      (dashboard)
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

## Verify (owner)

Acceptance 4: bring the stack up → the dashboard shows live data within a
minute of traffic; stop Bifrost or the stack independently → the other is
unaffected; bring the stack back up → the gap backfills from the log files.
