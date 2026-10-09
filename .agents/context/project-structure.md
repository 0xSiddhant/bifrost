# Project Structure

```
bifrost/
├── CLAUDE.md                  # entry point for AI agents → points to .agents/
├── bifrost                    # `./bifrost`: the repo's task runner (sh shim → scripts/bifrost/main.ts via tsx);
│                              #   NOT the `bifrost` LAN client, which is cli/
├── README.md
├── .agents/                    # plans, context, rules, memory (this folder)
├── .github/workflows/         # ci.yml (lint/typecheck/test/build + e2e + docker build + backup smoke)
│                              #   release.yml (semver → tag → GitHub Release, on push to main)
├── .env / .env.example
├── load-results/              # gitignored: `npm run test:load` result files (PLAN-34), never committed
├── package.json               # npm workspaces: server, client, cli, e2e, web
├── ecosystem.config.cjs       # PM2 apps bifrost-api + bifrost-web (+ bifrost-mdns), picked by BIFROST_RUN
│                              #   and MDNS_ADVERTISER (PLAN-36, PLAN-39)
├── docker/                    # one image per process (PLAN-39): api.Dockerfile (server, native toolchain),
│                              #   web.Dockerfile (web host + both clients, no apt), standalone.Dockerfile
│                              #   (nginx-unprivileged), nginx-standalone.conf (the standalone site's rules)
├── .dockerignore
├── compose/                   # one compose file per piece: api.yml, web.yml, web.bridge.yml (Mac override),
│                              #   observability.yml (profiled), standalone.yml (cloud machine)
├── docker-compose.yml         # includes api + web + observability: `docker compose up` is the hub
├── observability/             # loki/ alloy/ prometheus/ tempo/ grafana/ configs,
│                              #   dashboard JSON + provisioned datasources & alert rules
├── docs/
│   ├── ARCHITECTURE.md        # pointer → .agents/context/architecture.md (no duplication)
│   ├── DESIGN.md              # design system, tokens, sky/relics
│   ├── THEME-SPEC.md          # rules + JSON schema for the bundled themes
│   ├── standalone.md          # the standalone site: what it has, Docker, build args (PLAN-35)
│   ├── pm2.md · launchd.md    # run as a service on macOS
│   ├── docker-linux.md        # Docker on a Linux host: the images, the compose combinations
│   ├── docker-mac.md          # the web host in Docker beside the native API, and the Mac spike (PLAN-39)
│   ├── observability.md       # the optional Grafana stack
│   ├── cloud-profile.md       # internet-deployment checklist
│   ├── releasing.md           # automated release flow
│   ├── offline-mode.md        # warm-load for the pure-client pages (PLAN-22)
│   ├── testing.md             # every kind of test, how to run and replay each (PLAN-32)
│   └── assets/                # screenshots for README
├── server/
│   ├── drizzle/               # generated migrations
│   ├── openapi.json           # GENERATED API description (PLAN-32, `npm run api:spec`); committed,
│   │                          #   and `openapi.test.ts` fails while it is stale
│   └── src/
│       ├── app.ts             # composition root: reads DEPLOY_PROFILE manifest, registers modules
│       ├── openapi-spec.ts    # builds the spec from the app itself (local profile, scratch storage)
│       ├── api-coverage.test.ts  # every route described: tags/summary/operationId/responses/security
│       ├── testing/app.ts     # testConfig/createTestApp: the one way a server test builds an app
│       │                      #   (required keys, temp storage, contract guard `strict`)
│       ├── bootstrap.ts       # production entry (always starts; PM2/launchd/Docker/npm start use it)
│       ├── otel.ts            # OpenTelemetry SDK — loaded via `node --import`, BEFORE the app
│       │                      #   (ESM hoists, so starting it from app code instruments nothing)
│       ├── core/              # shared kernel — NEVER imports from modules/
│       │   ├── config/  db/  logger/  bus/  sse/  auth/  http/  backup/
│       │   ├── net.ts         #   lanIPv4Addresses() (the responder itself moved to web/, PLAN-36)
│       │   ├── web-host-check.ts  # full mode: error if nothing answers PORT/healthz after 10 s
│       │   │                  #   http/: schemas.ts (shared response pieces), contract.ts (the
│       │   │                  #   response contract guard), openapi.ts (swagger + routeCatalog)
│       │   ├── disk-usage.ts  #   the one recursive storage walk (Heimdall + metrics)
│       │   ├── paging.ts      #   PLAN-31: page-size clamp, keyset cursor codec, envelopes
│       │   │                  #   (+ their response schemas, PLAN-32)
│       │   └── relics/        #   runestone name-bank (relicTitle/uniqueRelicTitle)
│       └── modules/
│           └── <feature>/     # health, file-transfer, previews, clipboard,
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
│       ├── app/               # shell, router, feature-gated CATEGORY nav (3 hub tabs);
│       │                      #   pages/: Midgard (home hub) + Ollivanders / Diagon Alley category hubs
│       │                      #   + PensievePage (PLAN-21) — a shell ACROSS features, so it lives
│       │                      #     here rather than in features/; its logic is in core/library/
│       │                      #   offlineWarmLoad.ts (PLAN-22 — the id → import() loader map; it
│       │                      #     lives here, not core/, because only the composition root may
│       │                      #     reach across features)
│       ├── assets/            # self-hosted fonts + relic line-art (shared, norse, potter, greek, ghibli)
│       │                      #   + themes/*.json (bundled at build time, PLAN-35)
│       ├── core/              # features.ts (what each build ships, PLAN-35), bridge.ts + ui/BridgeClosed
│       │                      #   (the "Bifröst is closed" sheet), settings/ (SettingsStore: hub API or
│       │                      #   bifrost.local.* localStorage, rules.ts + rules.cases.json),
│       │                      #   api/sse clients (hub-only stubs in standalone), log.ts (batched
│       │                      #   browser→server logger; a no-op sink standalone),
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
│       │                      #     + since PLAN-31 the paging algebra (paging.ts) and the page walk
│       │                      #     (pager.ts, LibraryPager) behind the Pensieve; a 4th kind is one entry —
│       │                      #     PLAN-19's groot proved it and PLAN-23's atlas proved it again,
│       │                      #     one array element and no page change),
│       │                      #   offlineMode.ts (PLAN-22 — warm-load policy client + status shape),
│       │                      #   useCursorList.ts + ui/LoadMore.tsx (PLAN-31 — Accio/Portkey infinite
│       │                      #     scroll), ui/Pager.tsx + useMediaQuery.ts (the Pensieve's pager),
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
│                              #   saga (slideshow — parseSlides/loadSource/SlideView/SlideFooter/
│                              #     NotesPanel/ShortcutsOverlay/Dropzone/fullscreen/useSlideScale/
│                              #     useSlideshowNav + own saga.css) in PLAN-28; loadPdfSlides.ts
│                              #     (pdfjs-dist legacy build, page-per-slide, bounded canvas) in
│                              #     PLAN-29 — a slide is a tagged union from loadSource.ts onward;
│                              #   toolbox (registry + lib/ pure utils + tools/ bodies in ONE lazy
│                              #     chunk + own toolbox.css) in PLAN-18 — no route of its own,
│                              #     the cards expand inside /diagon-alley/:toolId
├── cli/                       # THIRD workspace (PLAN-27): the `bifrost` command, installed
│   ├── README.md              #   globally from a GitHub Release tarball. The first
│   │                          #   workspace-level README in the repo — deliberately, since
│   │                          #   `npm install -g` moves this one out of the monorepo
│   ├── man/bifrost.1.md       #   hand-written; compiled to the gitignored bifrost.1 by
│   │                          #   scripts/gen-man.ts in cli's prebuild (gen-build-info's pattern)
│   └── src/
│       ├── index.ts           #   commander program; self-starts only when it IS the entry
│       │                      #     (realpath'd — `npm install -g` puts a SYMLINK on PATH)
│       ├── core/              #   one flat file per capability, mirroring client/src/core/:
│       │                      #     client (the only HTTP + the whole error table), discover,
│       │                      #     config, output (+ CliError/EXIT), files, clipboard,
│       │                      #     documents, browser, portkey, presence, nimbus, selfUpdate
│       ├── commands/          #   thin: parse args, call core/, print. No usecase tier —
│       │                      #     there is no rule here the server does not already enforce
│       └── test/              #   liveServer (spawns a REAL server per int suite) + runCli
├── web/                       # FIFTH workspace (PLAN-36): the web host on PORT. Lint-banned from
│   │                          #   importing server/client/cli/e2e source; reads the shared .env itself
│   └── src/
│       ├── bootstrap.ts       #   production entry (PM2/launchd/compose/npm start)
│       ├── main.ts            #   mode → client dir, listen on WEB_HOST:PORT, mDNS decision, shutdown
│       ├── host.ts            #   buildWebHost: static + SPA fallback + the proxy (hub), or the
│       │                      #     nginx-rule static site (standalone); 502 HUB_UNAVAILABLE, /healthz
│       ├── standalone-rules.ts  # the nginx-standalone.conf rules, parity-tested
│       ├── config.ts  logger.ts  # its own zod view of .env; app-web.N.log, source: "web"
│       ├── mdns.ts            #   the Bonjour responder (moved from server/src/core/mdns, PLAN-36)
│       ├── advertiser.ts      #   an advertiser-only process: `bifrost-mdns` (advertise.ts) and `npm run dev`
│       │                      #     (mdns-dev.ts), each with its own decision (PLAN-39)
│       ├── processes.ts       #   the processes a run needs (BIFROST_RUN, MDNS_ADVERTISER), for npm start
│       └── supervise.ts       #   runs a mode's processes as one for `npm start` (scripts/start.ts)
├── e2e/                       # FOURTH workspace (PLAN-32a): sees only the BUILT system, from
│   │                          #   outside — lint-banned from importing server/client/cli src
│   ├── playwright.config.ts   #   UI only: chromium-desktop, chromium-mobile, webkit-mobile, cloud
│   ├── vitest.config.ts       #   unit tests of the support code (`npm test`)
│   ├── vitest.e2e.config.ts   #   the installed-CLI suite (`cli/**/*.e2e.ts`)
│   ├── vitest.api.config.ts   #   the black-box API suite (`api/**/*.e2e.ts`, PLAN-33)
│   ├── api/                   #   boot, transport, contract, fuzz/, security, modes (PLAN-36); support/ (spec reader,
│   │                          #   recording fetch client, seeding, SSE, zip); coverage-report.ts
│   ├── support/               #   server.ts (both production entries, the web host in front; scratch
│   │                          #   storage, blanked .env),
│   │                          #   fixtures.ts + guards.ts (no-silent-errors), api.ts, ui.ts,
│   │                          #   journey.ts (routes() tags + App.tsx route scan), cli-install.ts,
│   │                          #   pty.ts, sink.ts, pdf.ts, files.ts, guard-fixture.ts,
│   │                          #   static-server.ts + standalone-fixtures.ts (PLAN-35)
│   ├── browser/               #   journeys 1–18, cross-surface, bridge-closed, routes.spec.ts, guard.spec.ts
│   ├── standalone/            #   the standalone site, from a static server with the nginx rules (PLAN-35)
│   ├── cli/                   #   the packed, temp-prefix-installed CLI (Vitest)
│   ├── perf/                  #   the load harness, `npm run test:load` (PLAN-34): run.ts, options.ts,
│   │                          #   seed.ts, scenarios.ts (autocannon), metrics.ts (/metrics, web host RSS), report.ts,
│   │                          #   profiles/{load,stress,spike,soak,fanout}.ts; never in CI
├── tools/micromatch-shim/     # stands in for micromatch (no `braces`): the 3 functions eslint-plugin-boundaries
│                              #   uses, copied verbatim; wired by package.json devDependency + override
├── scripts/                   # bifrost/ (`./bifrost`: commands.ts is the one task table — runs, help, man,
│                              #   list --json; main.ts executes it; commands.test.ts fails on a named script
│                              #   or file that does not exist), setup, backup, restore, resilience,
│                              #   gen-build-info, gen-man, gen-openapi (api:spec), cli-sync (pack + npm install -g,
│                              #   skipped under CI) + start.ts (`npm start`), start-pm2.sh, start-launchd.sh,
│                              #   observability.sh, check-standalone.ts (the standalone bundle reaches
│                              #   no server), standalone-smoke.sh (the image, in CI)
└── storage/                   # gitignored (.gitkeep committed) — survives restarts
    ├── uploads/   downloads/   tmp/   data/ (app.db)   logs/
```

Naming: modules kebab-case; files kebab-case; classes PascalCase with role suffix (`UploadFilesUseCase`, `FileStorageRepository`); events dot-namespaced `<module>.<event>` (`file.uploaded`, `download.added`, `clipboard.updated`).
