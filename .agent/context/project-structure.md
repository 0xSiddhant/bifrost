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
│   ├── offline-mode.md        # warm-load for the pure-client pages (PLAN-22)
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
│           └── <feature>/     # health, file-transfer, previews, clipboard, themes,
│               ├── module.ts  #   heimdall, qr-tool, presence, audit-log, runestone,
│               │              #   variant, edda, groot, atlas, loki, accio, nimbus, portkey,
│               │              #   screensaver, client-logs, metrics, toolbox,
│               │              #   offline-mode
│               ├── routes/
│               ├── usecases/
│               ├── services/  # concrete repo/service implementations
│               └── schema.ts  # Drizzle tables owned by this module
├── client/
│   └── src/
│       ├── app/               # shell, router, capability-gated CATEGORY nav (3 hub tabs);
│       │                      #   pages/: Midgard (home hub) + Ollivanders / Diagon Alley category hubs
│       │                      #   + PensievePage (PLAN-21) — a shell ACROSS features, so it lives
│       │                      #     here rather than in features/; its logic is in core/library/
│       │                      #   offlineWarmLoad.ts (PLAN-22 — the id → import() loader map; it
│       │                      #     lives here, not core/, because only the composition root may
│       │                      #     reach across features)
│       ├── assets/            # self-hosted fonts + relic line-art (shared, norse, potter, greek, ghibli)
│       ├── core/              # api/sse clients, log.ts (batched browser→server logger),
│       │                      #   notify/ (global notification stack: store + host +
│       │                      #   imperative `notify` handle + shouldShowForOrigin, PLAN-17a),
│       │                      #   theme engine, device registry, tokens,
│       │                      #   ui/ (Card + PortalCard tones teal/violet/amber, hub cards, JoinBifrostCard,
│       │                      #   .tone-surface/.tone-chip shared by Portal + the tool card,
│       │                      #   ExpandingGrid + expandingGridMath (in-place tool panel, PLAN-18),
│       │                      #   ErrorBoundary (app-wide crash net), JsonEditor (one `mode`
│       │                      #   prop: json|markdown|javascript|yaml|xml|plain, PLAN-23)
│       │                      #   +replaceRange for table-originated transactions (PLAN-23),
│       │                      #   PlistTable (PLAN-23 — the editable Xcode-shaped Key/Type/Value
│       │                      #     table; it lives here, not in features/atlas, because it is not
│       │                      #     Atlas-shaped, it is plist-shaped),
│       │                      #   useSplitPanel (PLAN-23 — Edda's divider/ratio/breakpoints,
│       │                      #     extracted at its second consumer, as JsonEditor and TreeView
│       │                      #     both were at theirs),
│       │                      #   +in-editor search, TreeView +bulk collapse +alias annotation),
│       │                      #   json/ (parse/format/diff + jsonPatch.ts, PLAN-26's RFC 6902
│       │                      #     mapping over the same diff records, and the replay that proves one),
│       │                      #   markdown/ (renderMarkdown/outline/stats/commands + PLAN-20's
│       │                      #     mermaid.ts + useMermaid.ts — the async diagram pass sits BESIDE
│       │                      #     the pure renderer, and in core so features/previews/ can reach it),
│       │                      #   yaml/ (PLAN-19 — analyze/format/flow⇄block/⇄json + the advisory
│       │                      #     rail; format-named not tool-named, so Variant can share it),
│       │                      #   xml/ (PLAN-23 — analyze/validate/format/minify, plus the
│       │                      #     element-span scanner that gives DOMParser the source offsets it
│       │                      #     reports none of; plist.ts keeps each value's DECLARED type — the
│       │                      #     one thing every plist library throws away — and owns the pure
│       │                      #     edit computations; advisories.ts is three, not padded to Groot's),
│       │                      #   library/ (PLAN-21 — the document-kind registry + allSettled fan-out
│       │                      #     + pure merge/sort/filter behind the Pensieve; a 4th kind is one entry —
│       │                      #     PLAN-19's groot proved it and PLAN-23's atlas proved it again,
│       │                      #     one array element and no page change),
│       │                      #   offlineMode.ts (PLAN-22 — warm-load policy client + status shape),
│       │                      #   chunkError.ts (PLAN-22 — is this a failed dynamic import?
│       │                      #     read by ui/RouteBoundary, the per-route net that keeps a
│       │                      #     cold route with no bridge off the app-wide crash card),
│       │                      #   textNormalize, runestone + edda + groot + atlas + accio clients,
│       │                      #   runestoneSeed + variantSeed (one-shot cross-tool handoffs), relicNames name-bank
│       │                      #   (client-logs has no feature slice — core/log.ts IS its client half)
│       └── features/          # mirrors server modules; route-level code splitting
│                              #   lore-named where the page is lore-named: hermes→clipboard,
│                              #   wardens→presence (server ids unchanged; sigil/ was deleted in
│                              #   PLAN-18 — the QR page became a toolbox tool, module untouched);
│                              #   runestone + variant added in PLAN-07/08; edda in PLAN-11
│                              #     (PLAN-21 deleted BOTH their library pages — runestone/PensievePage
│                              #      and edda/EddaLibraryPage — for the one shell above;
│                              #      PLAN-20 added exportHtml.ts's print twin, print.ts — the hidden
│                              #      srcdoc iframe behind the .pdf button);
│                              #   groot (YAML workspace — editor · tree · advisory rail,
│                              #     reusing the rune-* editor chrome) in PLAN-19;
│                              #   loki in PLAN-12; accio (read-later shelf) in PLAN-13;
│                              #   nimbus (LAN speed test — orchestrator + own nimbus.css) in PLAN-14;
│                              #   portkey (LAN go-links — own portkey.css) in PLAN-15;
│                              #   atlas (XML workspace — the code pane always, the plist table only
│                              #     when the document is one; no multi-document tabs, since
│                              #     XML has exactly one root) in PLAN-23;
│                              #   toolbox (registry + lib/ pure utils + tools/ bodies in ONE lazy
│                              #     chunk + own toolbox.css) in PLAN-18 — no route of its own,
│                              #     the cards expand inside /diagon-alley/:toolId
├── scripts/                   # setup, backup, restore, resilience (test:resilience) +
│                              #   start-pm2.sh, start-launchd.sh, observability.sh
├── themes/                    # built-in (aurora, daybreak, ghibli-dusk, olympus) + user-added theme JSON files
└── storage/                   # gitignored (.gitkeep committed) — survives restarts
    ├── uploads/   downloads/   tmp/   data/ (app.db)   logs/
```

Naming: modules kebab-case; files kebab-case; classes PascalCase with role suffix (`UploadFilesUseCase`, `FileStorageRepository`); events dot-namespaced `<module>.<event>` (`file.uploaded`, `download.added`, `clipboard.updated`).
