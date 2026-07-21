---
name: db-migration
description: Change the Bifrost database schema safely — Drizzle schema edit + generated migration as one unit, verified against both an upgraded and a fresh DB. Use for any change to server/src/core/db/schema.ts (new table, column, or index).
---

# DB Migration — schema change ritual

Hard rule: **the schema edit and its migration are one change, landed together.** Code that references a column whose migration doesn't exist yet 500s at runtime — this actually happened (`char_name` was in the schema before migration `0003` existed and `/api/presence` broke under `npm run dev`).

1. Edit `server/src/core/db/schema.ts` — all tables live in this one file (drizzle.config reads only it). Every table gets a doc comment naming the owning module and its purpose, matching the existing style.
2. Generate: `npm run db:generate -w server -- --name <slug>` → `server/drizzle/NNNN_<slug>.sql`. Review the generated SQL before accepting it — drizzle-kit can propose destructive table rebuilds for SQLite column changes.
3. Never edit a migration that has reached `develop`, and never hand-edit `server/drizzle/meta/` — a follow-up schema change is a new migration. Migrations apply idempotently at boot (`runMigrations` in `core/db`, tracked in `__drizzle_migrations`).
4. Backfill for existing rows: either in the migration SQL itself, or set-once-on-write in the usecase (the `coalesce` pattern from `char_name`) — say in the PR which one and why.
5. Verify both DB paths, then run the `verify` skill (its restart smoke is mandatory for schema changes):
   - **Upgrade path**: built server against the existing `storage/data/app.db` → `/api/health` 200 → `PRAGMA integrity_check` returns `ok`.
   - **Fresh path**: `STORAGE_ROOT=<scratch dir> npm start` → health 200 — proves the migration chain bootstraps from zero, not just from the previous state.
6. If tables were added/renamed, update the data section of `.agent/context/architecture.md` (context-sync diffs docs against Drizzle schemas, so stale docs will surface later as drift).
