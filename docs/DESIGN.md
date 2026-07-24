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

Four themes ship built in; users add more as JSON — see
[THEME-SPEC.md](THEME-SPEC.md) for the schema and resolver.

- **Aurora** (default, dark) — near-black blue-slate, aurora accents
  (teal `--accent`, violet `--accent-2`, green `--ok`) used sparingly.
- **Daybreak** (light) — warm paper background, same hues desaturated.
- **Ghibli Dusk** (dark) — Studio-Ghibli twilight: twilight-blue base,
  lantern-gold accent, dusk-teal / meadow-green, horizon-glow sky.
- **Olympus** (dark) — midnight-Aegean blue, gilded-gold accent, Aegean-cyan,
  laurel-green, terracotta danger, a gold summit glow in `--sky`.

Switching = one attribute: `<html data-theme="daybreak">`. Nothing else moves.
A theme need only author ~14 colors — the resolver derives the rest, including
the `--diff-add/remove/change` group Variant (PLAN-08) paints diffs with.

## Token reference (`core/tokens.css`)

- **Color roles**: `--bg` · `--surface` · `--surface-2` · `--text` ·
  `--text-muted` · `--border` · `--accent` · `--accent-2` · `--ok` ·
  `--danger` · `--warn` · softs (`--accent-soft`, `--danger-soft`) ·
  `--scrim` · `--bridge` (the rainbow gradient)
- **Atmosphere tones** (eyebrows, code highlights, join band, sky relics):
  `--tone-teal` · `--tone-violet` · `--tone-amber` + `-soft` variants, and matching
  `--glow-teal/violet/amber`. Derived from the theme's accents when omitted.
- **Card palette** (the per-card colour, one per card): `--card-1` … `--card-10`.
  A single base colour per slot; the corner tint and hover glow are mixed from it.
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
the sky, re-shuffled on every route change and reload. Four collections live
in `client/src/assets/relics/` (shared primitives in `shared.tsx`, each
collection registered in `index.ts`):

| Collection | Count | Flavor |
|---|---|---|
| Norse artifacts (`norse.tsx`) | 20 | Mjölnir, valknut, Yggdrasil, Fenrir, runes… |
| Wizarding world (`potter.tsx`) | 21 | snitch, hallows, floating candle, platform 9¾… |
| Olympus (`greek.tsx`) | 20 | trident, lyre, laurel, labyrinth, owl, Ω Δ Ψ… |
| Ghibli world (`ghibli.tsx`) | 19 | soot sprites, forest spirit, 森 風 火 kanji… |

Heimdall → **Sky relics** lets the owner enable/disable collections per
device (default: all). It's a client-side visual preference (localStorage via
`core/relicPrefs.ts`), independent of the server's DB-backed settings.

> Not to be confused with two same-named-but-unrelated things: `core/relicNames.ts`
> (the runestone *title* bank, e.g. "Gleaming Gungnir", mirroring `server/src/core/relics`)
> and `assets/relics/` here (background *line art*).

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

## Cards & tones

**One card component — `Portal`** (`core/ui/Portal.tsx`, class `.portal`) — is
used on every hub: the Midgard transfer doors, the Ollivanders tools, the Diagon
Alley stalls. A portal is a doorway to another dimension of the app: a tone-lit
corner, an icon chip, a title, a description, and a **footer tagline naming where
it leads** (Send → `midgard → asgard`, Runestone → `carve the runes`). It renders
as a `<Link>` normally, or a dimmed non-navigating `<div>` with a "Coming soon"
badge when `soon`. The grid is `.portals` (one class, everywhere).

Each portal is **lit by one hue of the card palette**: a soft radial gradient in a
corner, a tone-matched icon chip, a tone border + glow on hover — all mixed from a
single base colour via `color-mix`. The colour comes from a **10-slot palette**
(`--card-1` … `--card-10`); the class `.card-tone-N` sets `--ct`.

(The wide **Join Bifrost** onboarding band on Midgard is *not* a portal — it stays
its own `JoinBifrostCard`. And Loki's tool page keeps its own emerald accent
`--tone-loki`, but its hub portal is an ordinary palette card like the rest.)

**Colour follows position, per page.** Each hub/portal grid is built from an
ordered list and rendered with `cardToneClass(index + 1)` (`core/ui/cardTone.ts`):
the first visible card is `--card-1`, the second `--card-2`, … wrapping back to
`--card-1` after the last slot. Every page starts its own sequence from 1, so no
card hardcodes a colour — **reorder the list and the colours reorder with it**, and
a page can hold any number of cards. (This is why the same colour can appear once
per page — e.g. Send and Runestone are both slot 1 — which is fine across
different pages.) Every card, Loki included, is an ordinary palette card.

Each theme defines its own 10 hues (`themes/*.json`), so the palette stays
on-brand — a warm house theme gets ten warm shades, not a rainbow. A theme that
omits the slots inherits the stylesheet default set. Reach for `--accent-soft`
for generic hover/selected fills; use the card palette when a card wants its own
identity in a grid of siblings.

## Layout language

Card-based, generous whitespace, `max-width: 62rem` container **by default** —
but the two-pane / editor tools (Variant PLAN-08, Runestone) **break out** to
`min(105rem, 100vw − gutters)` at ≥1024px and fill the viewport height, because
a document editor earns the width.

**Navigation is three category hub tabs** — **Midgard** (transfer: Send /
Receive / Hermes + the Join-Bifrost QR), **Ollivanders** (dev tools: Runestone /
Variant / Edda), **Diagon Alley** (utilities: the QR maker + coming-soon
tools). Each tool keeps its own route and appears as a card on its hub; a tab
lights active on any of its tools' sub-pages. Desktop nav sits in the header;
≤640px it becomes bottom tabs (thumb-reach, safe-area insets) whose labels wrap
to two lines then ellipsis. Heimdall is never a tab — gesture/shortcut only.

Home leads with the three transfer portals, then a wide horizontal **Join
Bifrost** band (QR beside its address details) for onboarding a new device.
