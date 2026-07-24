---
name: theme
description: Create or edit a Bifrost theme (a JSON file in themes/) so it loads valid, reads calm, and gives every card its own colour. Use whenever the owner asks for a new theme, a palette change, or a fix to an existing theme's colours.
---

# Theme — author a Bifrost theme

A theme is one JSON file in `themes/<id>.json`. The running server watches the
folder: a valid file appears in every open client's switcher within ~2s, an
invalid one is skipped with a logged reason. **Read `docs/THEME-SPEC.md` first** —
it is the prose mirror of the JSON schema (`server/src/modules/themes/theme-schema.ts`),
the single source of truth for token names and value formats.

## Shape

`{ "id", "name", "mode": "dark"|"light", "tokens": { … } }`. `id` is
`a-z0-9-`, 2–32 chars, and becomes the filename + `data-theme` attribute.

## The 14 required color roles (a theme is these + metadata)

`--bg` · `--surface` · `--surface-2` · `--text` · `--text-muted` · `--border` ·
`--accent` · `--accent-2` · `--ok` · `--danger` · `--warn` · `--accent-soft` ·
`--danger-soft` · `--scrim`. Everything else is optional and derived from these
when omitted (`server/src/modules/themes/resolve.ts`). Copy a built-in
(`themes/aurora.json`, `olympus.json`) as the starting shape — they define the
full optional set (atmosphere, syntax, diff, qr, **card palette**).

## Dark themes must read CALM, not glaring (owner's bar)

The recurring failure mode is a dark theme that *emits light*. Guard against it:

- **Don't saturate the base with the theme's hero colour.** An all-red base looks
  like blood, an all-green base like sludge. Keep `--bg`/`--surface`/`--surface-2`
  a genuinely dark near-black in the same lightness range as aurora/olympus/
  slytherin; let the identity colour live in the *accents*.
- **Warm accents read hotter than cool ones** — deepen and slightly desaturate
  them (burnished gold, not neon gold).
- **Pull back the atmosphere**: keep `--sky` radial alphas low (~0.08–0.16),
  `--stars` ~0.4–0.55, `--glow-*` modest. Reference the "calm" built-ins.
- Preserve identity while distinguishing (a two-colour house theme is still that
  house — just not a single flat wash).

## Card palette (`--card-1` … `--card-10`)

Cards get their colour from a 10-slot palette, **not** the atmospheric `--tone-*`
(those stay for eyebrows/code highlights/join band). See
[[project-card-tone-palette]]. Every theme should define its own 10 hues so the
hub stays on-brand:

- Ten hues that are **mutually distinguishable** as soft corner tints — a
  rainbow for a multi-hue theme, ten *distinct shades* for a two-colour house
  theme (warm reds/oranges/golds, or cool greens/silvers/teals).
- Base colour only; the tint + hover glow are mixed in CSS via `color-mix`.
- A theme that omits them inherits the stylesheet default set (`core/tokens.css`).
- Cards are coloured by **position** (`cardToneClass(index + 1)`), so slot 1 is
  the first card on each page — order your palette so early slots look good first.

## QR + fonts (easy to get wrong)

- `--qr-module-a/b` must stay **dark-on-light** for scanners regardless of mode;
  `--qr-bg` near-white. Don't theme these to light-on-dark.
- Fonts: self-hosted families only (`'Space Grotesk'`/`'Inter'`/`'JetBrains Mono'`
  first in the stack) — the LAN may be offline.

## Validate

1. `node -e "JSON.parse(require('fs').readFileSync('themes/<id>.json','utf8'))"` — parses.
2. Every token key must be in the schema (`ALL_TOKEN_KEYS`); unknown keys are
   rejected (`additionalProperties: false`). Run the themes tests if you touched
   the schema: `npx vitest run src/modules/themes` (from `server/`).
3. Contrast is a warn, not a block — but check `--text` vs `--bg`/`--surface`
   clears ~4.5:1.

## Ship

- **Editing the theme schema or `tokens.css`/card CSS needs a server restart +
  client rebuild** to take effect; editing only a theme JSON's *values*
  hot-reloads live (the watcher). If a JSON edit adds a token the running server's
  schema doesn't know yet, it will be **rejected** until restart.
- Built-in theme files (`aurora`, `daybreak`, `ghibli-dusk`, `olympus`) can be
  edited directly on disk (the API's overwrite-refusal only blocks POST/DELETE);
  note in the PR that you changed a shipped built-in's appearance.
- Prove it with the `live-verify` skill (screenshot the hub in the theme) before
  handing off.
- Per project rule, **leave the work uncommitted until the owner tests it** and
  says to commit. If you introduced a new convention, update `docs/THEME-SPEC.md`
  / `docs/DESIGN.md` and log it in `.agent/memory/decisions.md`.
