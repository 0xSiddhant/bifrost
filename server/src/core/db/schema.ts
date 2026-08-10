import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Runtime-mutable settings overlaid onto the .env config at boot
 * (see core/config applySettingsOverlay). Written by Heimdall (PLAN-05).
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/*
 * `upload_audit` was dropped in PLAN-17b (migration 0010). It duplicated
 * `audit_events` — which already records every `file.uploaded` with its time,
 * uploader hint, name and size — for the sake of one extra column,
 * `stored_name`, which stopped being interesting the moment this plan removed
 * the timestamp prefix and made the stored name the original name. Worse, it
 * drifted: rows survived files deleted outside the app, so Heimdall's "Uploads"
 * listed files that were not there. That listing now reads the directory (it
 * cannot drift), and the dashboard's upload counts come from `audit_events`.
 */

/**
 * Shared LAN clipboard (PLAN-06). One board of text entries; `kind` = 'text' |
 * 'code' with an optional `lang` hint. Capped with oldest-out; `expiresAt` is
 * an optional TTL for sensitive entries. Owned by the `clipboard` module.
 */
export const clipboardEntries = sqliteTable('clipboard_entries', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  kind: text('kind').notNull().default('text'),
  lang: text('lang'),
  deviceId: text('device_id'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at'),
});

/**
 * Known devices (PLAN-06). A stable client-generated `deviceId` maps to a
 * UA-derived `label` ("iPhone · Safari") and an optional claimed `name`.
 * Owned by the `presence` module. Live/connected state is not stored — that
 * comes from the SSE hub.
 */
export const devices = sqliteTable('devices', {
  deviceId: text('device_id').primaryKey(),
  /** User-claimed friendly name (overrides the character alias when set). */
  name: text('name'),
  /** Auto-assigned character alias ("Thor"), unique per device. */
  charName: text('char_name'),
  /** UA-derived label ("iPhone · Safari"); shown alongside the alias in Heimdall. */
  label: text('label'),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
});

/**
 * Saved JSON documents ("runestones", PLAN-07 Part B). Owned by the
 * `runestone` module. `id` is a short random handle that anchors share URLs;
 * `slug` is `<kebab-name>-<id>` and regenerates on rename (stale slugs with a
 * valid id still resolve). `author_device_id` is the PLAN-06 device id —
 * display names resolve client-side, never from presence's tables.
 */
export const runestones = sqliteTable('runestones', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  content: text('content').notNull(),
  authorDeviceId: text('author_device_id'),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  modifiedAt: integer('modified_at').notNull(),
});

/**
 * Saved Markdown documents ("eddas", PLAN-11). Owned by the `edda` module —
 * deliberately a separate table from `runestones` (markdown ≠ JSON semantics).
 * `id` is a short random handle anchoring share URLs; `slug` is `<kebab-name>-<id>`
 * and regenerates on rename (stale slugs with a valid id still resolve).
 * `author_device_id` is the PLAN-06 device id — display names resolve client-side.
 */
export const eddas = sqliteTable('eddas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  content: text('content').notNull(),
  authorDeviceId: text('author_device_id'),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  modifiedAt: integer('modified_at').notNull(),
});

/**
 * Saved YAML documents (PLAN-19). Owned by the `groot` module — a third table
 * rather than a shared one, for the same reason `eddas` is not `runestones`:
 * the formats have different semantics and each module owns its own storage.
 *
 * Named `groot_docs` on the `accio_links` precedent (module name + generic
 * noun): pluralising the tool's name works for "runestones" and "eddas", which
 * are the documents, and not for Groot, which is the tree the documents grow on.
 *
 * Columns mirror `eddas` exactly: `id` is a short random handle anchoring share
 * URLs, `slug` is `<kebab-name>-<id>` and regenerates on rename (stale slugs
 * with a valid id still resolve), `author_device_id` is the PLAN-06 device id
 * and display names resolve client-side. The server stores the text and never
 * parses it — see the module doc comment.
 */
export const grootDocs = sqliteTable('groot_docs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  content: text('content').notNull(),
  authorDeviceId: text('author_device_id'),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  modifiedAt: integer('modified_at').notNull(),
});

/**
 * Read-later shelf ("accio links", PLAN-13). Owned by the `accio` module.
 * `id` is a short random handle (no slug — links are never shared by URL, the
 * shelf is the surface). `url` is the normalized absolute URL; `title` is
 * best-effort and starts null when the client supplied none — the enrichment
 * service patches it in after the row already exists. `tags` is a JSON array of
 * strings (flat, no folders — see the plan). `author_device_id` is the PLAN-06
 * device id; display names resolve client-side.
 */
export const accioLinks = sqliteTable('accio_links', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title'),
  /** JSON-encoded `string[]`; SQLite has no array type and we never query into it. */
  tags: text('tags').notNull().default('[]'),
  authorDeviceId: text('author_device_id'),
  createdAt: integer('created_at').notNull(),
});

/**
 * LAN speed-test history ("nimbus results", PLAN-14). Owned by the `nimbus`
 * module. One row per completed test — direction-agnostic, because a test always
 * measures all three figures in one pass, and a partial (cancelled) test is
 * never saved. `device_id` is the PLAN-06 device id (names resolve client-side),
 * so history groups per device without nimbus reading presence's table. Pruned
 * by the audit retention policy.
 */
export const nimbusResults = sqliteTable('nimbus_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id'),
  /** Megabits per second, as measured by the client's own chunk timings. */
  downMbps: real('down_mbps').notNull(),
  upMbps: real('up_mbps').notNull(),
  /** Median of the ping round trips, milliseconds. */
  latencyMs: real('latency_ms').notNull(),
  /** Payload size the run used, so a 10 MB result is never compared to a 100 MB one blindly. */
  testMb: integer('test_mb').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * LAN go-links ("portkeys", PLAN-15). Owned by the `portkey` module. The `slug`
 * IS the primary key — it's a user-chosen memorable word (`router`, `nas`) and
 * the identity of the link, so it's immutable (rename = delete + recreate). `url`
 * is the normalized absolute http(s) target (any host). `hits` counts redirects,
 * bumped async after the hop so a slow write never delays it; `last_used_at` is
 * the epoch-ms of the most recent hit (null until first used). `author_device_id`
 * is the PLAN-06 device id; display names resolve client-side.
 */
export const portkeys = sqliteTable('portkeys', {
  slug: text('slug').primaryKey(),
  url: text('url').notNull(),
  note: text('note'),
  hits: integer('hits').notNull().default(0),
  authorDeviceId: text('author_device_id'),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
});

/**
 * Activity log (PLAN-06). A pure bus subscriber (`audit-log` module) appends
 * one row per cross-module event; `actor` is a deviceId and/or ip. Pruned by
 * retention. Nothing else imports the module — delete it and Bifrost still runs.
 */
export const auditEvents = sqliteTable('audit_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  event: text('event').notNull(),
  deviceId: text('device_id'),
  ip: text('ip'),
  summary: text('summary'),
});
