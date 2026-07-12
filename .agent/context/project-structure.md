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
│   ├── ARCHITECTURE.md        # public mirror of .agent/context/architecture.md
│   ├── THEME-SPEC.md          # rules + JSON schema for user-made themes
│   └── assets/                # demo.png, demo.mp4 for README
├── server/
│   ├── drizzle/               # generated migrations
│   └── src/
│       ├── app.ts             # composition root: reads DEPLOY_PROFILE manifest, registers modules
│       ├── core/              # shared kernel — NEVER imports from modules/
│       │   ├── config/  db/  logger/  bus/  sse/  auth/  mdns/  http/
│       └── modules/
│           └── <feature>/     # file-transfer, previews, clipboard, themes,
│               ├── module.ts  #   heimdall, qr-tool, presence, audit-log
│               ├── routes/
│               ├── usecases/
│               ├── services/  # concrete repo/service implementations
│               └── schema.ts  # Drizzle tables owned by this module
├── client/
│   └── src/
│       ├── app/               # shell, router, capabilities-driven nav
│       ├── core/              # api client, sse client, theme engine, design tokens
│       └── features/          # mirrors server modules; route-level code splitting
├── themes/                    # built-in + user-added theme JSON files
└── storage/                   # gitignored (.gitkeep committed) — survives restarts
    ├── uploads/   downloads/   tmp/   data/ (app.db)   logs/
```

Naming: modules kebab-case; files kebab-case; classes PascalCase with role suffix (`UploadFilesUseCase`, `FileStorageRepository`); events dot-namespaced `<module>.<event>` (`file.uploaded`, `download.added`, `clipboard.updated`).
