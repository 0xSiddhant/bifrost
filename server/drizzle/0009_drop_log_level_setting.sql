-- PLAN-16a: Heimdall's runtime log-level switch is gone, so `LOG_LEVEL` in
-- .env (+ a restart) is the single source of truth. Leaving the persisted row
-- behind would be worse than useless: the settings overlay no longer reads the
-- key, so a DB that still carried it would silently disagree with .env for
-- anyone inspecting it, and any future overlay on the same key would resurrect
-- a level nobody chose. Data-only migration — no schema change.
DELETE FROM `settings` WHERE `key` = 'log.level';
