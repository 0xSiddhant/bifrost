# Project Structure

```
bifrost/
├── CLAUDE.md                  # entry point for AI agents → points to .agent/
├── README.md
├── .agent/                    # plans, context, rules, memory (this folder)
├── .github/workflows/ci.yml   # lint + typecheck + test + build on PRs
├── .env / .env.example
├── package.json               # npm workspaces: server, client
├── docs/
│   ├── ARCHITECTURE.md        # pointer → .agent/context/architecture.md (no duplication)
│   ├── DESIGN.md              # design system, tokens, sky/relics
│   ├── THEME-SPEC.md          # rules + JSON schema for user-made themes
│   └── assets/                # screenshots for README
├── server/
│   ├── drizzle/               # generated migrations
│   └── src/
│       ├── app.ts             # composition root: reads DEPLOY_PROFILE manifest, registers modules
│       ├── core/              # shared kernel — NEVER imports from modules/
│       │   ├── config/  db/  logger/  bus/  sse/  auth/  mdns/  http/
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
│       ├── app/               # shell, router, capabilities-driven nav
│       ├── assets/            # self-hosted fonts + relic line-art (shared, norse, potter, greek, ghibli)
│       ├── core/              # api/sse clients, theme engine, device registry, tokens,
│       │                      #   + shared JSON stack: json/ (parse/format/diff), ui/JsonEditor,
│       │                      #   ui/TreeView, textNormalize, runestone client, relicNames name-bank
│       └── features/          # mirrors server modules; route-level code splitting
│                              #   lore-named where the page is lore-named: muninn→clipboard,
│                              #   wardens→presence, sigil→qr-tool (server ids unchanged);
│                              #   runestone + variant added in PLAN-07/08
├── scripts/                   # setup.ts (folders/env/migrations), backup.ts
├── themes/                    # built-in (aurora, daybreak, ghibli-dusk, olympus) + user-added theme JSON files
└── storage/                   # gitignored (.gitkeep committed) — survives restarts
    ├── uploads/   downloads/   tmp/   data/ (app.db)   logs/
```

Naming: modules kebab-case; files kebab-case; classes PascalCase with role suffix (`UploadFilesUseCase`, `FileStorageRepository`); events dot-namespaced `<module>.<event>` (`file.uploaded`, `download.added`, `clipboard.updated`).
