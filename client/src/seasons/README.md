# Seasons — plug-in decorations

A season is a folder here that adds decorations to the shell for a while
(winter's snowfall, string lights and snowy footer), then goes. Themes and
relics are not seasons: they stay.

## How it plugs in

- The shell has three **slots**, `<DecorSlot slot="sky" | "header" | "footer" />`
  (`core/decor/`). It never names a decoration.
- A season exports a manifest (`index.ts`: ids, slots, Heimdall labels, a
  `load()` for its components) and a component map (`components.ts`), which
  loads as one chunk once the browser is idle.
- `app/season.ts` is the plug: `export const SEASON = WINTER;`. Only `app/` may
  import a season (lint), and a season may import only `core/` and itself.
- A theme turns a decoration on with the token `--decor-<id>` (a 0–1 level)
  and styles it with any other `--decor-*` tokens the season documents. The
  schema accepts the whole `--decor-*` namespace, so no season edits it.
- Heimdall → Sky Relics lists a switch for every `switchable` decoration of
  the installed season, stored per device (`bifrost.decor.off`).

## Remove a season

1. `app/season.ts`: delete the season's import (`import { WINTER } from
   '../seasons/winter';`) and set `export const SEASON: Season | null = null;`
   (or import the next season and set it instead).
2. Delete its folder, e.g. `seasons/winter/`, and its journey,
   `e2e/browser/season-winter.spec.ts`.
3. Optionally drop its `--decor-*` tokens from the themes that set them
   (`assets/themes/yule.json`); left in, they are simply unused.

Nothing else changes: the slots render empty and Heimdall shows no switches.
Typecheck, lint and the build then confirm nothing else named the season.

## Add a season

1. `seasons/<name>/`: the components, each with its own stylesheet; `components.ts`
   mapping ids to components; `index.ts` exporting the `Season` manifest.
2. Point `app/season.ts` at it.
3. Turn its decorations on in a theme: `"--decor-<id>": "1"`, plus its styling tokens.
4. A journey in `e2e/browser/season-<name>.spec.ts`.

## Rules a decoration keeps

- Decoration only: `aria-hidden`, `pointer-events: none`, and no layout change
  (absolutely placed; the footer slot's spare room is the 48 px above it and
  the footer's own band). Editors sized to the window must keep their size.
- Animate only `transform`, `translate` or `opacity`; a short loop is a Web
  Animation (`element.animate`, with an `id`), never a CSS animation, and CSS
  keyframes hold no `var()` (`.agents/rules/coding.md`, Frontend). Measure the
  main thread with the decoration against a theme without it.
- Respect `prefers-reduced-motion` in its Web Animations.
- Colours come from theme tokens, never literals.
