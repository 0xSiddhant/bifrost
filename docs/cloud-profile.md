# Cloud profile — the internet-deployment checklist

Bifrost is a **LAN appliance**. Nothing here is deployed to the internet today,
and `DEPLOY_PROFILE=cloud` is a forward-looking seam, not a finished target
(see PLAN-99). This is the checklist future-you follows the day that changes —
what flips, and where the seams already are.

> The architecture was built so this is a checklist, not a rewrite: repository
> interfaces, a profile manifest, and a core auth service already exist.

## 1. Module manifest — what loads

`server/src/app.ts` `MANIFEST` already splits the profiles:

- **cloud** loads only internet-safe modules: `qr-tool`, `themes`, `heimdall`,
  `runestone`, `variant` (+ `health`).
- **local-only, excluded from cloud:** `file-transfer`, `previews`, `clipboard`,
  `presence`, `audit-log` — these assume a trusted LAN, Finder-native folders,
  and device presence, and must not be exposed as-is.

Action: decide per module whether it graduates to cloud with real
authorization, or stays local-only. The nav/pages already follow
`/api/capabilities`, so the client adapts with no separate build.

## 2. SQLite → Postgres

The swap is mechanical because usecases depend on **repository interfaces**, not
Drizzle. Swap points:

- `core/db` — replace `better-sqlite3` + `drizzle-orm/better-sqlite3` with
  `pg` + `drizzle-orm/node-postgres`; connection pool instead of a file handle.
- `core/db/schema.ts` — port column types to the pg dialect; regenerate
  migrations for Postgres.
- Each module's concrete repo (`services/…Repository`) — the only files that
  touch Drizzle; the interfaces and usecases are untouched.
- Restart-safety assumptions change: WAL/checkpoint logic (`checkpointAndClose`,
  the resilience suite) is SQLite-specific — Postgres has its own durability
  story.

Postgres itself is explicitly **out of scope** here (PLAN-99).

## 3. Real authentication

Today auth is a **single shared admin PIN** (Heimdall) — right for one
household, wrong for the internet.

- Replace the single PIN with real per-user accounts (OAuth/OIDC or
  email+password with proper hashing).
- Per-user data ownership and authorization checks on every route (runestones,
  themes, etc. are currently world-readable/writable within the LAN).
- The `core/auth` service + `app.requireAdmin` decorator are the insertion
  point; sessions already use `@fastify/secure-session` with a revocable epoch.

## 4. HTTPS

- Terminate TLS at a reverse proxy (Caddy/nginx/Cloud LB); Bifrost stays plain
  HTTP behind it.
- Mark the session cookie `Secure` + `SameSite`; add HSTS.
- The LAN-only assumptions that skip HTTPS (the async Clipboard API fallback,
  QR of a bare `http://` URL) no longer apply.

## 5. Rate limits & abuse protection

- A per-IP upload rate limit already exists (`UPLOAD_RATE_LIMIT_PER_MIN`);
  add **global** request rate limiting (`@fastify/rate-limit`).
- Enforce body-size caps and per-account quotas (upload size, runestone count).
- CORS: the runestone public data endpoint sends `Access-Control-Allow-Origin: *`
  — reconsider for authenticated cloud data.

## 6. Networking / discovery

- mDNS is already **off** in the cloud profile (no `bifrost.local`); rely on a
  real DNS name.
- Bind behind the proxy; don't expose the Node port directly.

## 7. Secrets & config

- `HEIMDALL_SESSION_SECRET` becomes mandatory (no random-at-boot — that would
  reset sessions on every deploy).
- Move secrets to the platform's secret manager, not `.env` on disk.
- Backups: `--include-env` is even more sensitive; store archives encrypted and
  off-box.

---

None of the above is built. When one internet feature is actually scheduled,
promote it into a numbered plan and work this list top-down.
