# PLAN-07 — Ops (run-for-real, backup, Docker, optional observability)

## Goal

Bifrost runs as a household appliance: starts on boot, restarts on crash, backs up in one command, has an optional Grafana view of its logs, and carries a Docker story for a future Linux host — while the primary run mode stays native macOS.

## Scope

**In:** PM2 setup (+ launchd docs), backup/restore, Dockerfile + compose (Linux-target), optional Grafana+Loki+Alloy compose stack, restart-resilience test suite, cloud-profile readiness notes.
**Out:** actually deploying the cloud profile (future work; see PLAN-99), Postgres implementation.

## Decisions & reasoning

- **Native macOS + PM2 is the production mode.** Docker on macOS breaks three core behaviors (mDNS multicast can't cross the VM, FSEvents degrade to polling on bind mounts, Finder-native folders are the point). PM2 gives crash-restart, `pm2 startup` for boot, and log handling; a `launchd` plist is documented as the no-dependency alternative.
- **Docker deliverable targets Linux** (`--network host` exists there): multi-stage Dockerfile (build client+server → slim runtime), compose file with a `./storage` bind volume. Purpose: (a) the natural Raspberry Pi / home-server migration, (b) executable documentation of the runtime env. CI builds the image to keep it honest but nothing runs in it on the Mac.
- **Observability stays detachable:** `docker-compose.observability.yml` runs Grafana + Loki + Alloy, with Alloy tailing `storage/logs/*.log` from the host. Because logs are files first, the stack can be down for weeks and ingest the backlog when started. Ship one starter dashboard JSON (requests, errors by module, upload throughput, watcher events). This satisfies the Grafana goal without making 3 containers load-bearing for a LAN app.
- **Backups are trivial by design** — all state is `storage/` (uploads, downloads, app.db, logs). `npm run backup` = SQLite `VACUUM INTO` a snapshot (safe under WAL, no downtime) + zip of storage → `BACKUP_DIR`, timestamped, keep-last-N. `npm run restore <file>` documented.

## Task checklist

- [ ] `ecosystem.config.cjs` (PM2): prod env, max-memory restart, SIGINT kill timeout aligned with graceful-shutdown budget; docs: `pm2 start/startup/save`, log locations
- [ ] `docs/launchd.md` with a ready plist
- [ ] `scripts/backup.ts` (VACUUM INTO + zip + rotation) and `scripts/restore.ts`; both refuse to run against a live server unless `--force`
- [ ] `Dockerfile` (multi-stage, node:20-slim, non-root user) + `docker-compose.yml` (host network, `./storage` volume) + `docs/docker-linux.md` honestly stating macOS limitations
- [ ] `docker-compose.observability.yml` + Alloy config + Loki config + `grafana/dashboards/bifrost.json` provisioned; `docs/observability.md` (start/stop, it's optional)
- [ ] Restart-resilience suite (scripted): 50× rapid stop/start; SIGKILL (not just SIGINT) mid-upload, mid-clipboard-write, mid-migration → assert clean recovery, WAL integrity (`PRAGMA integrity_check`), tmp swept
- [ ] `docs/cloud-profile.md`: what flips for internet deployment — module manifest, Postgres repo swap points, real auth requirement, HTTPS, rate limits — the checklist future-you follows
- [ ] CI additions: docker build job; backup script smoke test

## Acceptance criteria

1. `pm2 start ecosystem.config.cjs && pm2 startup && pm2 save` → Mac reboot → Bifrost is reachable without touching a terminal.
2. `npm run backup` produces a restorable archive while the server is running; restore verified on a scratch copy.
3. Resilience suite passes: zero corruption across 50 restarts + SIGKILL scenarios; `integrity_check` returns ok every time.
4. Observability stack up → dashboard shows live data; stack down → app completely unaffected; stack up again → backlog ingested.
5. `docker build` succeeds in CI; compose file boots on a Linux box/VM with mDNS + watcher verified working there.

## Test checklist

- [ ] Scripted resilience suite committed and runnable via `npm run test:resilience`
- [ ] Manual: reboot test, restore drill, Grafana query walkthrough
