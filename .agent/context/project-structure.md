# Project Structure

```
bifrost/
├── CLAUDE.md                  # entry point for AI agents → points to .agent/
├── README.md
├── .agent/                    # plans, context, rules, memory (this folder)
├── .github/workflows/         # ci.yml (lint/typecheck/test/build + docker build + backup smoke)
│                              #   release.yml (semver → tag → GitHub Release, on push to main)
├── .env / .env.example
├── package.json               # npm workspaces: server, client
├── ecosystem.config.cjs       # PM2 process definition (macOS run mode)
├── Dockerfile / .dockerignore # Linux-target image (CI-built; not the macOS run mode)
├── docker-compose.yml         # run on a Linux host (host networking)
├── docker-compose.observability.yml   # optional Grafana + Loki + Alloy stack
├── observability/             # loki/ alloy/ prometheus/ tempo/ grafana/ configs,
│                              #   dashboard JSON + provisioned datasources & alert rules
├── docs/
│   ├── ARCHITECTURE.md        # pointer → .agent/context/architecture.md (no duplication)
│   ├── DESIGN.md              # design system, tokens, sky/relics
│   ├── THEME-SPEC.md          # rules + JSON schema for user-made themes
│   ├── pm2.md · launchd.md    # run as a service on macOS
│   ├── docker-linux.md        # Docker on a Linux host
│   ├── observability.md       # the optional Grafana stack
│   ├── cloud-profile.md       # internet-deployment checklist
│   ├── releasing.md           # automated release flow
│   └── assets/                # screenshots for README
├── server/
│   ├── drizzle/               # generated migrations
│   └── src/
│       ├── app.ts             # composition root: reads DEPLOY_PROFILE manifest, registers modules
│       ├── bootstrap.ts       # production entry (always starts; PM2/launchd/Docker/npm start use it)
│       ├── otel.ts            # OpenTelemetry SDK — loaded via `node --import`, BEFORE the app
│       │                      #   (ESM hoists, so starting it from app code instruments nothing)
│       ├── core/              # shared kernel — NEVER imports from modules/
│       │   ├── config/  db/  logger/  bus/  sse/  auth/  mdns/  http/  backup/
│       │   ├── disk-usage.ts  #   the one recursive storage walk (Heimdall + metrics)
│       │   └── relics/        #   runestone name-bank (relicTitle/uniqueRelicTitle)
│       └── modules/
│           └── <feature>/     # file-transfer, previews, clipboard, themes, heimdall,
│               ├── module.ts  #   qr-tool, presence, audit-log, runestone, variant
│               ├── routes/
│               ├── usecases/
│               ├── services/  # concrete repo/service implementations
│               └── schema.ts  # Drizzle tables owned by this module
├── client/
│   └── src/
│       ├── app/               # shell, router, capability-gated CATEGORY nav (3 hub tabs);
│       │                      #   pages/: Midgard (home hub) + Ollivanders / Diagon Alley category hubs
│       ├── assets/            # self-hosted fonts + relic line-art (shared, norse, potter, greek, ghibli)
│       ├── core/              # api/sse clients, log.ts (batched browser→server logger),
│       │                      #   notify/ (global notification stack: store + host +
│       │                      #   imperative `notify` handle, PLAN-17a),
│       │                      #   theme engine, device registry, tokens,
│       │                      #   ui/ (Card + PortalCard tones teal/violet/amber, hub cards, JoinBifrostCard,
│       │                      #   ErrorBoundary (app-wide crash net), JsonEditor +markdown mode
│       │                      #   +in-editor search, TreeView +bulk collapse),
│       │                      #   json/ (parse/format/diff), markdown/ (renderMarkdown/outline/stats/commands),
│       │                      #   textNormalize, runestone + edda + accio clients, relicNames name-bank
│       │                      #   (client-logs has no feature slice — core/log.ts IS its client half)
│       └── features/          # mirrors server modules; route-level code splitting
│                              #   lore-named where the page is lore-named: hermes→clipboard,
│                              #   wardens→presence, sigil→qr-tool (server ids unchanged);
│                              #   runestone + variant added in PLAN-07/08; edda in PLAN-11;
│                              #   loki in PLAN-12; accio (read-later shelf) in PLAN-13;
│                              #   nimbus (LAN speed test — orchestrator + own nimbus.css) in PLAN-14;
│                              #   portkey (LAN go-links — own portkey.css) in PLAN-15
├── scripts/                   # setup, backup, restore, resilience (test:resilience) +
│                              #   start-pm2.sh, start-launchd.sh, observability.sh
├── themes/                    # built-in (aurora, daybreak, ghibli-dusk, olympus) + user-added theme JSON files
└── storage/                   # gitignored (.gitkeep committed) — survives restarts
    ├── uploads/   downloads/   tmp/   data/ (app.db)   logs/
```

Naming: modules kebab-case; files kebab-case; classes PascalCase with role suffix (`UploadFilesUseCase`, `FileStorageRepository`); events dot-namespaced `<module>.<event>` (`file.uploaded`, `download.added`, `clipboard.updated`).
