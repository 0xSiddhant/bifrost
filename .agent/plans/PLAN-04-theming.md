# PLAN-04 — Theming Engine (JSON themes)

## Goal

Themes become data: a validated JSON file fully describes a theme; users switch themes dynamically from the UI; new themes can be added/deleted (delete/add UI lands with Heimdall in PLAN-05 — the engine, API, and validation land here). A written spec (`docs/THEME-SPEC.md`) defines the rules for creating a theme.

## Scope

**In:** `themes` module (both profiles), theme JSON schema + ajv validation, loader, switcher UI, persistence of choice, `prefers-color-scheme` default, THEME-SPEC.md.
**Out:** Heimdall add/delete UI (PLAN-05 calls the APIs shipped here), theme marketplace fantasies.

## Decisions & reasoning

- **A theme JSON is a flat map onto the PLAN-01 token contract** — same keys as `tokens.css`. Applying a theme = setting CSS custom properties on `:root` (or `data-theme` attr for built-ins). No component ever changes.
- **Schema is the contract:** JSON Schema (draft 2020-12) validated with **ajv** on every load and on every future upload. Required: `name`, `id`, `mode` (`dark|light`), full color role set; optional: fonts (must reference self-hosted families only), radii, spacing overrides. Colors validated as hex/rgb(a); contrast lint (warn if `--text` vs `--bg` < 4.5:1) — warn, don't block, but Heimdall shows the warning.
- **Storage:** theme files live in `themes/*.json` (built-ins committed: `aurora.json`, `daybreak.json`); user-added themes also written there (filesystem is the source of truth; DB `settings` stores only the active-theme id + per-visitor choice stays client-side with server default).
- **Loading:** server reads + validates all theme files at boot and on a chokidar watch of `themes/` (reuses core watcher patterns) → invalid file is skipped with a logged, structured error, never crashes boot. `GET /api/themes` serves the validated set; client applies without reload.
- **Default resolution:** visitor preference (local) → server default (settings) → `prefers-color-scheme` match among built-ins.

## API contracts

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/themes` | List validated themes | `[{ id, name, mode, preview: {bg, accent} }]` |
| `GET /api/themes/:id` | Full theme JSON | 404 if invalid/missing |
| `POST /api/themes` | Add theme (Heimdall-auth later; ships behind auth flag) | body = theme JSON; 422 with ajv error list |
| `DELETE /api/themes/:id` | Remove (built-ins refuse) | Heimdall-only |

## Task checklist

- [ ] `theme.schema.json` + ajv service + friendly error formatting
- [ ] Rewrite PLAN-01 built-ins as `themes/aurora.json`, `themes/daybreak.json` — proves the engine subsumes the hand-made themes
- [ ] Loader + `themes/` watcher + SSE `theme.updated` event (open clients see edits live — great dev loop)
- [ ] Client theme engine: fetch, apply to `:root`, persist choice, FOUC guard (inline script sets last theme before hydration)
- [ ] Theme switcher UI in shell (name + mode + color-dot preview)
- [ ] `docs/THEME-SPEC.md`: every key, allowed values, contrast guidance, a copy-paste starter theme, "how to add" walkthrough
- [ ] Contrast warn util

## Acceptance criteria

1. Switching themes updates the entire UI instantly, no reload, on all pages.
2. Dropping a hand-written valid JSON into `themes/` makes it appear in the switcher within ~2s; an invalid one is rejected with a logged reason and the app keeps running.
3. Built-in themes cannot be deleted via API; POST with a missing color role returns the exact ajv path in the 422 body.
4. First visit with OS dark mode lands on Aurora; light mode lands on Daybreak.

## Test checklist

- [ ] Unit: schema valid/invalid corpus, contrast util, default resolution order
- [ ] Integration: POST invalid → 422 shape; watcher pickup; delete built-in → 403
- [ ] Manual: theme switch on phone during an active upload (tokens only — progress bar keeps working)
