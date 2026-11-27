# Tech Stack

Chosen tools and why. Do not swap one without a line in `memory/decisions.md`. Versions are in the `package.json` files.

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 (≥ 22.23.4), 24 or 26 per `engines`; TypeScript strict | Owner's experience; typed contracts. The floor is a brotli CVE fix |
| HTTP | Fastify 5 | Plugin encapsulation maps to modules; schemas; streaming; pino-native |
| Web host | Fastify + `@fastify/static` + `@fastify/http-proxy` (`web/`) | One runtime and toolchain on the Mac instead of nginx; proxy chosen by a spike |
| Frontend | React 19 + Vite, `features/` folders, route-level code splitting | Theming, admin forms, live lists |
| Styling | Plain CSS + custom properties, no Tailwind | Themes are JSON → CSS variables, switchable at runtime |
| Database | better-sqlite3 + Drizzle, WAL | Embedded, restart-tolerant, typed migrations; repository interfaces keep Postgres possible |
| Uploads | `@fastify/multipart` (busboy) | Streams to disk, flat memory |
| File watching | chokidar, `awaitWriteFinish`, `depth: 1` | FSEvents on macOS; the depth enforces one folder level |
| Live updates | Server-Sent Events | One-way; browser reconnects; far less than WebSockets |
| mDNS | bonjour-service, in the web host | `bifrost.local` keeps resolving while the API restarts |
| Config | dotenv + zod at boot | Fail fast; `.env` for defaults and secrets, DB `settings` for runtime values |
| Logging | pino → JSON files, pino-roll; pino-pretty in dev | Structured; the observability stack tails the files |
| Admin sessions | `@fastify/secure-session` + session epoch in DB | No session store; an epoch bump revokes all |
| Device labels | ua-parser-js | "iPhone · Safari" labels in presence |
| Theme validation | ajv, client test only | Themes are bundled client files; the schema is the contract (`THEME-SPEC.md`) |
| Code editors | CodeMirror 6 (+ `merge`, `search`), jsonc-parser, `@shopify/lang-jsonc` | Lint, fold, find; JSONC with comment-safe edits |
| YAML | `yaml` v2 (client only) | Keeps comments (`js-yaml` drops them); multi-document; source offsets |
| XML | the browser's `DOMParser`; no plist library | One parser, comment- and byte-preserving edits |
| Markdown | marked + highlight.js + DOMPurify; Mermaid lazy | One pure renderer for every surface |
| Unified diff | `diff` (jsdiff) | Real `.patch` files with hunks and headers |
| Zip streaming | `archiver` | Streams a folder zip into the response, no buffer |
| Brotli | Node's built-in `zlib`, server side | Browsers' `CompressionStream` has no Brotli |
| Build compression | `zlib` in a Vite plugin; `preCompressed` / nginx `gzip_static` | Quality 11 is too slow per request |
| PDF rendering | `pdfjs-dist` `legacy/` build, lazy | Older iPads; scanned PDFs need `wasmUrl` |
| CLI | `commander`, `open`, `marked-man`; uploads on `node:http` | `fetch` + `FormData` buffers the whole file |
| Lint/format | ESLint 9 + eslint-plugin-boundaries + Prettier | The plugin enforces module isolation |
| Commits | commitlint + husky, Conventional Commits | Scopes are module names |
| Unit tests | Vitest (+ `fastify.inject`) | One tool front and back |
| End-to-end | Playwright (UI journeys only) in `e2e/` | Chromium desktop + mobile, WebKit mobile, standalone |
| API description | `@fastify/swagger` → committed `server/openapi.json` (3.1) | Generated from route schemas, cannot drift |
| API docs | `@fastify/swagger-ui` on the API server; Redocly lint | Bundled assets, offline |
| Fuzzing | `fast-check` in `e2e/` | Requests from the spec's schemas, shrinking |
| Load testing | `autocannon` in `e2e/` | Programmatic, HdrHistogram; on demand only |
| Process manager (macOS) | PM2 or launchd | Native keeps mDNS and FSEvents |
| Docker | one Dockerfile per image (`docker/`), compose per piece (`compose/`) | Linux hosts, the standalone site, the web host on a Mac |
| Standalone site | nginx-unprivileged | A static site needs nothing else; read-only, non-root |
| Observability (optional) | Grafana, Loki, Alloy, Prometheus, Tempo | Files-first, detachable, backfills |
| Tracing | OpenTelemetry → OTLP, off by default | Only when the launcher turns it on |
| Backup | `VACUUM INTO` + `zip` | Online-safe under WAL |
| Releases | GitHub Actions `release.yml` + changelogen | Semver from commits, tag, Release, back-merge |

PWA: a static manifest and icons in `client/public/`; no Service Worker (the hub is plain http). Deferred: Postgres for the cloud profile.
