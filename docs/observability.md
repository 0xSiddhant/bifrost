# Observability (optional Grafana view of the logs)

Bifrost logs structured pino JSON to `storage/logs/` — rotated `app.N.log` files
with a `current.log` symlink on the active one. That alone is the
source of truth (`npm run logs` pretty-prints it). This stack is a **nice-to-
have** Grafana view on top; it is never load-bearing.

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
uploads, watcher events, errors-by-module, request throughput, and a live
warning/error log panel).

## How it fits together

```
storage/logs/*.log  ──tail──▶  Alloy  ──push──▶  Loki  ◀──query──  Grafana
   (pino JSON)                (parses level+module)   (stores)      (dashboard)
```

- **Alloy** (`observability/alloy/config.alloy`) tails `storage/logs/*.log`
  (bind-mounted read-only), parses each pino line, and promotes `level`
  (30=info … 50=error, 60=fatal) and `module` to Loki labels.
- **Loki** (`observability/loki/config.yml`) stores on a local filesystem
  volume; `reject_old_samples: false` is what lets it accept the backlog.
- **Grafana** provisions the Loki datasource and the dashboard from
  `observability/grafana/`.

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
