# Bifrost Theme Spec

A theme is one JSON file in `themes/`. Drop a valid file there (or `POST /api/themes`) and it appears in every open client's theme switcher within ~2 seconds — no rebuild, no reload. An invalid file is skipped with a logged reason; the app never crashes over a theme.

The JSON Schema itself lives in `server/src/modules/themes/theme-schema.ts`; this document is its prose mirror.

## File shape

```json
{
  "id": "midnight",
  "name": "Midnight",
  "mode": "dark",
  "tokens": { "--bg": "#0a0a12", "…": "…" }
}
```

| Field | Rules |
|---|---|
| `id` | `a-z`, `0-9`, `-` only; 2–32 chars; unique; becomes the filename (`<id>.json`) and the `data-theme` attribute |
| `name` | 1–48 chars, shown in the switcher |
| `mode` | `dark` or `light` — drives `color-scheme`, the first-visit OS match, and the derived defaults |
| `tokens` | Flat map of CSS custom properties (below). Unknown keys are rejected |

## Required tokens — the 14 color roles

Every theme must define these. Values: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, or `transparent`.

| Token | Role |
|---|---|
| `--bg` | page background |
| `--surface` / `--surface-2` | cards / inset panels |
| `--text` / `--text-muted` | primary / secondary text |
| `--border` | hairlines, input borders |
| `--accent` / `--accent-2` | primary interactive / secondary partner (gradients) |
| `--ok` / `--danger` / `--warn` | status colors |
| `--accent-soft` / `--danger-soft` | tinted fills (use low-alpha rgba) |
| `--scrim` | modal backdrop (translucent) |

**A minimal theme is exactly these 14 tokens plus the metadata** — everything else below is derived from them when omitted.

## Optional groups (derived when omitted)

- **Atmosphere** — `--bridge`, `--accent-grad`, `--sky`, `--stars`, `--stars-alpha`, `--glow-teal`, `--glow-violet`, `--glow-amber`, `--glow-soft`, `--tone-teal(-soft)`, `--tone-violet(-soft)`, `--tone-amber(-soft)`, `--header-veil`, `--card-sheen`, `--relic-alpha`, `--relic-muted`, `--shadow-1/2`. Defaults: gradients and glows built from your `--accent`/`--accent-2`/`--ok`; stars on for dark mode, off for light.
- **Syntax** — `--syn-key/string/number/bool/null/punct` (JSON/code highlighting, Runestone PLAN-07 + Differ PLAN-08). Defaults: accent / ok / accent-2 / warn / muted / muted.
- **Diff** — `--diff-add/remove/change` plus `--diff-add/remove/change-soft` (compare-pane highlighting, Variant PLAN-08; the `-soft` variants are the line backgrounds, so keep them low-alpha). Defaults: ok / danger / accent, softs at ~0.16 alpha (dark) or ~0.12 (light).
- **QR** — `--qr-module-a/b`, `--qr-bg`. Modules must stay dark-on-light for scanners; defaults are per-mode deep teal→violet on near-white.
- **Fonts** — `--font-display/body/mono`. **Self-hosted families only** (`'Space Grotesk'`, `'Inter'`, `'JetBrains Mono'` first in the stack) — the LAN may have no internet, so any other family would silently fall back anyway.
- **Type/spacing/shape/motion** — `--text-*`, `--space-*`, `--radius-*`, `--dur-*`, `--ease`. Rarely worth overriding; omitted values fall back to the stylesheet.

## Value guard rails

Free-form CSS tokens (gradients, shadows) accept most CSS but **reject `url()`, `@`, `;`, `{}`, `<>`** — a theme must never trigger a network fetch or smuggle markup. Colors are pattern-checked strictly.

## Contrast lint (warn, never block)

On load, `--text` is checked against `--bg` and `--surface`. Ratios below **4.5:1** (WCAG AA body text) log a warning and are surfaced in the API (`warnings`), but the theme still loads — it's your hub.

## Starter theme (copy, edit, drop into `themes/`)

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "mode": "dark",
  "tokens": {
    "--bg": "#0a0a12",
    "--surface": "#12121f",
    "--surface-2": "#1a1a2c",
    "--text": "#ececf5",
    "--text-muted": "#8a8fa5",
    "--border": "#26263c",
    "--accent": "#5eead4",
    "--accent-2": "#a78bfa",
    "--ok": "#4ade80",
    "--danger": "#f87171",
    "--warn": "#fbbf24",
    "--accent-soft": "rgba(94, 234, 212, 0.12)",
    "--danger-soft": "rgba(248, 113, 113, 0.12)",
    "--scrim": "rgba(0, 0, 0, 0.7)"
  }
}
```

## How themes are picked (resolution order)

1. The visitor's own switcher choice (cached per device).
2. The server default (`themes.default` in settings — Heimdall-set, PLAN-05).
3. The visitor's `prefers-color-scheme`, matched by `mode` (dark → Aurora, light → Daybreak out of the box).

## Adding / removing

- **Filesystem:** save `<id>.json` into `themes/` — the watcher validates and broadcasts it live. Delete the file to remove it.
- **API:** `POST /api/themes` (422 lists every schema violation with its exact path) and `DELETE /api/themes/:id`. Built-ins (`aurora`, `daybreak`, `ghibli-dusk`, `olympus`) refuse deletion/overwrite. Both endpoints require a Heimdall admin session (`requireAdmin`).

## Enable / disable (Heimdall)

An admin can hide a theme from the public switcher without deleting it. Disabled ids live in DB settings (`themes.disabled`) and are filtered from both `GET /api/themes` and the live `theme.updated` broadcast, so clients fall back automatically if their active theme is disabled. Heimdall uses `GET /api/themes/manage` (all themes + `enabled` flag) and `PATCH /api/themes/:id {enabled}`; disabling the last enabled theme is refused (409 `LAST_THEME`).

## Troubleshooting

Theme not showing up? Check the server log for `invalid theme file skipped` — it lists every schema issue with its JSON path. Duplicate `id`s are skipped with a `duplicate theme id` warning; the first-loaded file wins.
