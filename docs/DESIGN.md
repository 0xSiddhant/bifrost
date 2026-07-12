# Bifrost Design System

The substrate every feature builds on, and the contract the theme engine
(PLAN-04) parametrizes. Rule zero: **components consume tokens only** — a hex
value outside `client/src/core/tokens.css` is a bug (CI-greppable).

## Fonts — "Asgard console" (all self-hosted woff2, OFL)

| Role | Face | Why |
|---|---|---|
| Display / headings | **Space Grotesk** 500·700 | Geometric, slightly retro-futuristic — the product's voice |
| Body / UI | **Inter** 400·500·700 | Disappears into legibility at any size |
| Data (filenames, sizes, timestamps) | **JetBrains Mono** 400·700 | A file hub renders filenames like a dev tool renders code |

No CDN: the LAN may have no internet. Files live in `client/src/assets/fonts`,
declared in `core/fonts.css` with `font-display: swap` and system fallbacks.

## Themes

- **Aurora** (default, dark) — near-black blue-slate, aurora accents
  (teal `--accent`, violet `--accent-2`, green `--ok`) used sparingly.
- **Daybreak** (light) — warm paper background, same hues desaturated.

Switching = one attribute: `<html data-theme="daybreak">`. Nothing else moves.

## Token reference (`core/tokens.css`)

- **Color roles**: `--bg` · `--surface` · `--surface-2` · `--text` ·
  `--text-muted` · `--border` · `--accent` · `--accent-2` · `--ok` ·
  `--danger` · `--warn` · softs (`--accent-soft`, `--danger-soft`) ·
  `--scrim` · `--bridge` (the rainbow gradient)
- **Type**: `--font-display/body/mono`, sizes `--text-xs…--text-2xl`
- **Space**: `--space-1…12` (0.25rem base scale)
- **Shape/depth**: `--radius-sm/md/lg/full`, `--shadow-1/2`
- **Motion**: `--dur-1` (150ms) · `--dur-2` (200ms) · `--ease`

## The bridge gradient

`--bridge` is the identity mark. It appears in the shell's animated top strip,
progress fills, the wordmark, hero accents, and primary-action gradients.
**Don't** spread it further — scarcity is what keeps it special.

## Atmosphere — the sky and its relics

Every page sits under `.sky`: layered aurora glows (`--sky`), a slow drifting
aurora ribbon, and a faint starfield (dark theme only, via `--stars-alpha`).

**Relics** are the fun layer: 6–9 random line-art artifacts scattered through
the sky, re-shuffled on every route change and reload. Three collections live
in `client/src/assets/relics/`:

| Collection | Count | Flavor |
|---|---|---|
| Norse artifacts (`norse.tsx`) | 20 | Mjölnir, valknut, Yggdrasil, Fenrir, runes… |
| Wizarding world (`potter.tsx`) | 21 | snitch, hallows, floating candle, platform 9¾… |
| Olympus (`greek.tsx`) | 14 | trident, lyre, laurel, labyrinth, Ω Δ Ψ… |

Heimdall → **Sky relics** lets the owner enable/disable collections per
device (default: all). It's a client-side visual preference stored like the
theme choice; server-backed settings arrive in PLAN-05.

Rules that keep them tasteful:

- opacity is `--relic-alpha` (≈7–9%) — visible when you look, invisible when
  you don't; positions bias toward page margins, away from running text
- **collision-free**: placements are rejection-sampled with a circle test
  (+24px breathing room); a relic that can't find open sky is dropped
- one relic type never repeats on a page; three tones (muted/teal/violet)
- gentle 10–19s vertical drift, frozen by `prefers-reduced-motion`
- `aria-hidden`, `pointer-events: none` — decoration only, never content

**Ambient motion exception:** the 150–200ms rule governs *interaction*
feedback. The sky layer (aurora drift, bridge flow, relic float) is the one
sanctioned slow-motion zone — owner-approved 2026-07-13.

## Do / Don't

- **Do** render filenames, sizes, byte counts, and timestamps in `--font-mono`.
- **Do** use `--accent-soft` for selected/hover fills, full `--accent` only for
  primary actions and active states.
- **Don't** hardcode any color, size, radius, or duration in a component.
- **Don't** add motion beyond 150–200ms ease; `prefers-reduced-motion`
  disables all of it (already handled globally in `base.css`).
- **Don't** put Heimdall in any nav — it opens by gesture/shortcut only.

## Layout language

Card-based, generous whitespace, `max-width: 62rem` container. Desktop nav in
the header; ≤640px it becomes bottom tabs (thumb-reach) with safe-area insets.
Home is two portal cards: Send / Receive — the two things every visitor came
to do.
