import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
