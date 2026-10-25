-- PLAN-35: themes are client code, so the theme switcher's enable/disable
-- (Heimdall's Themes section and PATCH /api/themes/:id) is gone with the
-- server themes module. Its one persisted row, the comma-separated disabled
-- ids, has no reader any more; left behind it would be an orphan that any
-- future feature reusing the key would silently inherit. The household
-- default (`themes.default`) stays: Heimdall still sets it. Data-only
-- migration — no schema change.
DELETE FROM `settings` WHERE `key` = 'themes.disabled';
