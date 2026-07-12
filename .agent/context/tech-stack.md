# Tech Stack (decided — do not swap without a logged decision)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js ≥ 20, TypeScript strict | Owner's existing Node/mDNS/WebSocket experience; typed contracts for themes/config/API |
| HTTP server | Fastify 5 | Plugin encapsulation maps to feature modules; built-in schema validation; first-class streaming; pino-native |
| Frontend | React 19 + Vite, vertical-slice `features/` folders, route-level code splitting | Dynamic theming, admin forms, live lists need components; splitting keeps cloud builds free of local-only UI (was React 18 at planning time — see decision log 2026-07-12) |
| Styling | Plain CSS + CSS custom properties (no Tailwind) | Themes are JSON → CSS variables on `:root`; hot-swappable, framework-agnostic |
| DB | better-sqlite3 + Drizzle ORM, WAL mode | Embedded single file, zero babysitting, restart-tolerant; Drizzle gives typed schema + migrations; repository interfaces keep Postgres swap mechanical for cloud profile |
| Uploads | @fastify/multipart (busboy) | Streams to disk, flat memory at 2 GB; temp-file + atomic rename |
| File watching | chokidar (`awaitWriteFinish` on) | FSEvents-native on macOS; debounces half-copied files; used by VS Code/webpack |
| Live updates | Server-Sent Events (one hub) | One-directional notifications; browser auto-reconnect; ~20 lines vs WS lifecycle management |
| mDNS | bonjour-service | Advertise `bifrost.local`; Android fallback = LAN-IP QR code printed at boot + shown in Heimdall |
| Config | dotenv + zod validation at boot | Fail fast on bad env; `.env` = defaults + secrets, DB `settings` table = runtime-mutable values (admin shortcut, etc.) |
| Logging | pino → JSON file (`storage/logs/`) + pino-roll rotation; pino-pretty in dev | Structured lines per module/request; Grafana+Loki compose stack is an optional add-on (PLAN-07), not load-bearing |
| Theme validation | ajv against a published JSON Schema | Users add themes as JSON; schema is the contract (THEME-SPEC.md) |
| Lint/format | ESLint + eslint-plugin-boundaries + Prettier | Boundaries plugin mechanically enforces module isolation |
| Commits | commitlint + husky, Conventional Commits | Owner's established discipline; scopes = module names |
| Tests | Vitest (+ supertest via fastify.inject) | Fast, TS-native, same tool front+back |
| Process manager | PM2 (prod on the Mac) | Auto-restart, boot startup, log mgmt; launchd documented as alternative |
| Docker | Provided but NOT the run mode on macOS | mDNS multicast + FSEvents + Finder-native folders all break in the macOS Docker VM; Dockerfile exists for a future Linux host (`--network host`) |

Deferred/optional: Postgres (cloud profile), Grafana+Loki+Alloy compose stack, PWA manifest.
