-- PLAN-42: a Runestone is strict JSON or JSONC (comments and trailing commas).
-- Additive, and the default backfills every existing row as `json`, which is
-- what each of them was validated as when it was saved.
ALTER TABLE `runestones` ADD `format` text DEFAULT 'json' NOT NULL;