# Bifrost Theme Spec

A theme is one JSON file in `client/src/assets/themes/`, bundled into the client at build time (PLAN-35): the switcher lists every file there, and choosing one makes no request. Add or change a file, run the client test, and rebuild; both builds (the hub and the standalone site) ship the same themes.

The JSON Schema lives in `client/src/core/theme/schema.ts` and is enforced by `client/src/core/theme/themes.test.ts`, which validates every bundled file against it and checks its contrast. A theme that fails is a red test, never a broken page. This document is the schema's prose mirror.

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
| `id` | `a-z`, `0-9`, `-` only; 2–32 chars; unique; matches the filename (`<id>.json`) and becomes the `data-theme` attribute |
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
- **Card palette** — `--card-1` … `--card-10`. Ten distinct base hues, one assigned per card across the hub/portal grids (see DESIGN.md). Only the base colour is set here; the corner tint and hover glow are mixed from it in CSS. Defaults: a jewel-tone set (dark) / a deeper saturated set (light). Override any slot to keep a themed hub on-brand — give a two-colour house theme ten *distinguishable* shades of its own palette rather than leaving the default rainbow. Omitted slots inherit the stylesheet default.
- **Screensaver** — `--screen-veil`, `--screen-particle`, `--screen-particle-2`, `--screen-line`, `--screen-ripple`, `--screen-glow`, `--screen-quote`. The idle particle overlay (Nótt): the deep veil behind everything, the drifting stars + the brighter near-layer "suns" (`-2`), the constellation lines, the click ripple, and the sun-glow. The canvas reads these at draw time. Defaults: a deep veil + soft stars, `--accent-2` suns/glow, `--accent` lines/ripple (dark); a light parchment veil with dark motes (light). `--screen-quote` (the quote text) defaults to `--text`. Omitted slots inherit the stylesheet default — override for a house-specific idle sky, and keep the veil dark/calm (it fills the whole screen). Same calm bar as the rest of the theme.
- **Fonts** — `--font-display/body/mono`. **Self-hosted families only** (`'Space Grotesk'`, `'Inter'`, `'JetBrains Mono'` first in the stack) — the LAN may have no internet, so any other family would silently fall back anyway.
- **Type/spacing/shape/motion** — `--text-*`, `--space-*`, `--radius-*`, `--dur-*`, `--ease`. Rarely worth overriding; omitted values fall back to the stylesheet.

## Value guard rails

Free-form CSS tokens (gradients, shadows) accept most CSS but **reject `url()`, `@`, `;`, `{}`, `<>`** — a theme must never trigger a network fetch or smuggle markup. Colors are pattern-checked strictly.

## Contrast (a test, not a warning)

`--text` is checked against `--bg` and `--surface`. A ratio below **4.5:1** (WCAG AA body text) fails the client test, so a theme that ships is one people can read.

## Starter theme (copy, edit, save into `client/src/assets/themes/`)

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
2. The household default (hub build only): Heimdall's "Default theme" (`themes.default` in settings, PLAN-05), which every device reads from `GET /api/v1/heimdall/access` (`defaultThemeId`). The standalone site has no household, so it skips this step.
3. The visitor's `prefers-color-scheme`, matched by `mode` (dark → Aurora, light → Daybreak out of the box).

An unknown id at any step (a deleted theme someone still has chosen, say) simply falls through to the next.

## Adding / removing

Save `<id>.json` into `client/src/assets/themes/`, add its file name to the list the first test in `themes.test.ts` pins (so a file can never ship or vanish by accident), run `npm test -w client`, then rebuild (`npm run build`, and `npm run build:standalone` for the standalone site). Delete the file to remove a theme; a device that had chosen it falls back to the next step above. There is no theme API and no enable/disable switch any more (PLAN-35): what ships is what the files say.

## Troubleshooting

Theme not showing up? Run `npx vitest run src/core/theme -w client` (from `client/`, `npx vitest run src/core/theme`): it names every schema issue with its JSON path, an `id` that does not match its file name (which also keeps ids unique), and any contrast below the floor. Then rebuild: a theme reaches a browser only through a build.
