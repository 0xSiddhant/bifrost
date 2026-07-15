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
