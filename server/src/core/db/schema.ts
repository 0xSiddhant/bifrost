import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/**
 * Minimal upload audit trail: Heimdall's metadata view (PLAN-05) reads this.
 * A recorder persists `file.uploaded` events; boot reconciliation seeds rows
 * for files already on disk. Metadata only — never the content. Keyed by the
 * unique stored name so reconciliation is idempotent. Full audit UI is PLAN-06.
 */
export const uploadAudit = sqliteTable('upload_audit', {
  storedName: text('stored_name').primaryKey(),
  originalName: text('original_name').notNull(),
  size: integer('size').notNull(),
  uploadedAt: integer('uploaded_at').notNull(),
  uploaderHint: text('uploader_hint'),
});

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
