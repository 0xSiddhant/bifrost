---
name: theme
description: Create or edit a Bifrost theme (a JSON file in client/src/assets/themes/) so it loads valid, reads calm, and gives every card its own colour. Use whenever the owner asks for a new theme, a palette change, or a fix to an existing theme's colours.
---

# Theme — author a Bifrost theme

A theme is one JSON file in `client/src/assets/themes/<id>.json`, bundled into
the client at build time (PLAN-35): both builds ship every file there, and a
theme reaches a browser only through a rebuild. **Read `docs/THEME-SPEC.md`
first** — it is the prose mirror of the JSON schema
(`client/src/core/theme/schema.ts`), the single source of truth for token names
and value formats.

## Shape

`{ "id", "name", "mode": "dark"|"light", "tokens": { … } }`. `id` is
`a-z0-9-`, 2–32 chars, must equal the file name, and becomes the `data-theme`
attribute.

## The 14 required color roles (a theme is these + metadata)

`--bg` · `--surface` · `--surface-2` · `--text` · `--text-muted` · `--border` ·
`--accent` · `--accent-2` · `--ok` · `--danger` · `--warn` · `--accent-soft` ·
`--danger-soft` · `--scrim`. Everything else is optional and derived from these
when omitted (`client/src/core/theme/resolve.ts`). Copy a built-in
(`client/src/assets/themes/aurora.json`, `olympus.json`) as the starting shape — they define the
full optional set (atmosphere, syntax, diff, qr, **card palette**, **screensaver**).

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
`.agents/rules/coding.md` → Frontend. Every theme should define its own 10 hues so the
hub stays on-brand:

- Ten hues that are **mutually distinguishable** as soft corner tints — a
  rainbow for a multi-hue theme, ten *distinct shades* for a two-colour house
  theme (warm reds/oranges/golds, or cool greens/silvers/teals).
- Base colour only; the tint + hover glow are mixed in CSS via `color-mix`.
- A theme that omits them inherits the stylesheet default set (`core/tokens.css`).
- Cards are coloured by **position** (`cardToneClass(index + 1)`), so slot 1 is
  the first card on each page — order your palette so early slots look good first.

## Screensaver palette (`--screen-*`) — Nótt, the idle overlay

The idle particle screensaver reads seven optional colours; omit them and it
derives on-brand from your accents/veil, or set them for a house-specific idle sky:

- `--screen-veil` — the full-screen backdrop. **Keep it dark and near-opaque**
  (calm bar applies double here — it fills the whole screen). Light themes get a
  soft parchment veil with **dark** motes instead (a dark theme's pale stars
  vanish on light).
- `--screen-particle` — the drifting stars; `--screen-particle-2` — the brighter
  near-layer "suns" (usually `--accent-2`).
- `--screen-line` / `--screen-ripple` — constellation lines + the click ripple
  (usually `--accent`; a house may use its secondary for the ripple pop).
- `--screen-glow` — the sun-glow halo; `--screen-quote` — quote text (defaults to
  `--text`, so usually leave unset).

Mirror the theme's `--stars`/accents so the sky feels like the same world. Same
rebuild rule as below.

## QR + fonts (easy to get wrong)

- `--qr-module-a/b` must stay **dark-on-light** for scanners regardless of mode;
  `--qr-bg` near-white. Don't theme these to light-on-dark.
- Fonts: self-hosted families only (`'Space Grotesk'`/`'Inter'`/`'JetBrains Mono'`
  first in the stack) — the LAN may be offline.

## Validate

The client test is the validator (there is no server-side check any more):
`npx vitest run src/core/theme` from `client/`. For every bundled file it
checks the schema (unknown token keys are rejected, `additionalProperties:
false`), that the `id` equals the file name, and that `--text` clears **4.5:1**
against `--bg` and `--surface` — a red test, not a warning. A **new** theme also
goes into the file list the first test pins, so nothing ships or vanishes by
accident.

## Ship

- Any theme change, values included, needs a client rebuild (`npm run build`,
  and `./bifrost build --standalone` for the standalone site). Nothing hot-reloads.
- Built-in theme files can be edited directly; note in the PR that you changed
  a shipped built-in's appearance.
- Prove it with the `live-verify` skill (screenshot the hub in the theme) before
  handing off.
- Per project rule, **leave the work uncommitted until the owner tests it** and
  says to commit. If you introduced a new convention, update `docs/THEME-SPEC.md`
  / `docs/DESIGN.md` and log it in `.agents/memory/decisions.md`.
