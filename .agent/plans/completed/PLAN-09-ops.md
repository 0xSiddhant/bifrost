# PLAN-09 — Ops (run-for-real, backup, Docker, optional observability)

> Renumbered from PLAN-07 when Runestone (07) and JSON Differ (08) were inserted.

## Goal

Bifrost runs as a household appliance: starts on boot, restarts on crash, backs up in one command, has an optional Grafana view of its logs, and carries a Docker story for a future Linux host — while the primary run mode stays native macOS.

## Scope

**In:** PM2 setup (+ launchd docs), backup/restore, hardening of the PLAN-00 Dockerfile/compose for the Linux target, optional Grafana+Loki+Alloy compose stack, restart-resilience test suite, **release automation (post-main-merge workflow)**, cloud-profile readiness notes.
**Out:** actually deploying the cloud profile (future work; see PLAN-99), Postgres implementation.

## Decisions & reasoning

- **Native macOS + PM2 is the production mode.** Docker on macOS breaks three core behaviors (mDNS multicast can't cross the VM, FSEvents degrade to polling on bind mounts, Finder-native folders are the point). PM2 gives crash-restart, `pm2 startup` for boot, and log handling; a `launchd` plist is documented as the no-dependency alternative.
- **Docker deliverable targets Linux** (`--network host` exists there): multi-stage Dockerfile (build client+server → slim runtime), compose file with a `./storage` bind volume. Purpose: (a) the natural Raspberry Pi / home-server migration, (b) executable documentation of the runtime env. CI builds the image to keep it honest but nothing runs in it on the Mac.
- **Observability stays detachable:** `docker-compose.observability.yml` runs Grafana + Loki + Alloy, with Alloy tailing `storage/logs/*.log` from the host. Because logs are files first, the stack can be down for weeks and ingest the backlog when started. Ship one starter dashboard JSON (requests, errors by module, upload throughput, watcher events). This satisfies the Grafana goal without making 3 containers load-bearing for a LAN app.
- **Backups are trivial by design** — but state is NOT only `storage/`: user-added themes live in `themes/` at the repo root, and `.env` carries the PIN/secrets/limits. `npm run backup` = SQLite `VACUUM INTO` a snapshot (safe under WAL, no downtime) + zip of `storage/` **and `themes/`** → `BACKUP_DIR`, timestamped, keep-last-N. `.env` is **excluded by default** (secrets don't belong in an archive that may leave the machine); `--include-env` flag opts in, and the restore doc reminds you to recreate `.env` either way. `npm run restore <file>` documented.
- **Backup runs safely against a live server; only restore refuses.** `VACUUM INTO` is online-safe under WAL, and PLAN-10's "Backup now" button will trigger it from _inside_ the running server — so a live-server refusal on backup would be self-defeating. `restore.ts` alone refuses to run against a live server unless `--force`. Structure both as **importable functions with thin CLI wrappers** (`server/src/core/…` or `scripts/lib/`), so PLAN-10's endpoint calls the backup function in-process instead of shelling out.
- **Release automation (post-main-merge job).** v1.0.0 was cut manually at the 00–06 release point; this plan automates every release after it. On push to `main`, a `release.yml` workflow: analyzes conventional commits since the last tag → computes the semver bump (`feat:`→minor, `fix:`→patch, `!`/`BREAKING CHANGE`→major) → bumps package.json versions + regenerates `CHANGELOG.md` via **changelogen** (the same file Heimdall's About section renders — PLAN-10) → commits `chore(release): vX.Y.Z`, tags, pushes → creates a GitHub Release with the changelog section as notes → attaches a production build tarball as a rollback artifact. Three mechanical guards: (1) branch protection bypass for the bot via fine-grained PAT (solo repo — less ceremony than an auto-PR); (2) loop guard — the workflow skips when the head commit is `chore(release):`; (3) back-merge `main → develop` (`--ff-only`) as the final step so develop carries the bump and the next PR doesn't conflict on package.json. Deliberately excluded: GHCR image publishing (no consumer — the Mac runs native PM2; add it the day a Linux host exists), auto-deploy (nothing to deploy to), npm publish (not a library).

## Task checklist

- [ ] `ecosystem.config.cjs` (PM2): prod env, max-memory restart, SIGINT kill timeout aligned with graceful-shutdown budget; docs: `pm2 start/startup/save`, log locations
- [ ] `docs/launchd.md` with a ready plist
- [ ] `scripts/backup.ts` (VACUUM INTO + zip of storage/ + themes/ + rotation; live-safe; importable function + CLI wrapper for PLAN-10 reuse) and `scripts/restore.ts` (refuses against a live server unless `--force`)
- [ ] Harden the PLAN-00 `Dockerfile` + `docker-compose.yml` against the now-complete app (healthcheck, tini/init, storage permissions, image size pass) + `docs/docker-linux.md` honestly stating macOS limitations; first real runtime verification on a Linux box/VM (mDNS + chokidar under host network)
- [ ] `docker-compose.observability.yml` + Alloy config + Loki config + `grafana/dashboards/bifrost.json` provisioned; `docs/observability.md` (start/stop, it's optional)
- [ ] Restart-resilience suite (scripted): 50× rapid stop/start; SIGKILL (not just SIGINT) mid-upload, mid-clipboard-write, mid-migration → assert clean recovery, WAL integrity (`PRAGMA integrity_check`), tmp swept
- [ ] `docs/cloud-profile.md`: what flips for internet deployment — module manifest, Postgres repo swap points, real auth requirement, HTTPS, rate limits — the checklist future-you follows
- [ ] Release automation: `release.yml` (push-to-main trigger, changelogen config, semver from commits, tag + GitHub Release + build tarball artifact), protection-bypass token setup documented, `chore(release)` loop guard, `main → develop` back-merge step; `docs/releasing.md` (how it works, how to force a version, how to hotfix)
- [ ] CI additions: docker build job; backup script smoke test

## Acceptance criteria

1. `pm2 start ecosystem.config.cjs && pm2 startup && pm2 save` → Mac reboot → Bifrost is reachable without touching a terminal.
2. `npm run backup` produces a restorable archive while the server is running; restore verified on a scratch copy, including a user-added theme file from `themes/`.
3. Resilience suite passes: zero corruption across 50 restarts + SIGKILL scenarios; `integrity_check` returns ok every time.
4. Observability stack up → dashboard shows live data; stack down → app completely unaffected; stack up again → backlog ingested.
5. `docker build` succeeds in CI; compose file boots on a Linux box/VM with mDNS + watcher verified working there.
6. Merging a `feat:` PR into `main` produces — untouched by humans — bumped package versions, an updated CHANGELOG.md, a git tag, a GitHub Release with correct notes, an attached build tarball, and a fast-forwarded `develop`; merging a `chore:`-only PR produces no release.

## Test checklist

- [ ] Scripted resilience suite committed and runnable via `npm run test:resilience`
- [ ] Manual: reboot test, restore drill, Grafana query walkthrough
