# PLAN-42 — Yule: a winter and Christmas world (light default theme, snowfall, string lights, 40 sky relics, winter quotes)

## Goal

Winter is coming, and the owner asked for a winter and Christmas world to replace Halloween as the default. It is light, not dark: snow white and the blue of frozen water, with Christmas ornaments, falling snow and a few touches from Disney's *Frozen*, used sparingly. "Use your creativity as much as possible."

A "world" here means the Halloween shape (#110): a theme, a relic collection and its own atmosphere. This one adds two effects no theme could draw before, each a generic theme opt-in rather than Yule-only CSS:

- **The theme, Yule** (`yule`, light). Frost-white surfaces, glacier-blue accent, holly-red accent-2, evergreen `--ok` and ornament-gold `--warn`. Its sky paints a pale aurora, a winter-sun halo and a snowdrift glow. On a light theme the starfield becomes **frost glints**. The bridge runs from glacier blue to holly red and gold, and the idle screensaver gets an icy veil with snow motes and ornament-red "suns". It becomes the built-in default for every first visit.
- **Snowfall.** Three depth layers of flakes fall behind every page, on the compositor. A theme turns it on with tokens, and a per-device **Snowfall** switch in Heimdall turns it off.
- **String lights.** A strand of Christmas bulbs hangs below the header at the top of every page and twinkles, then scrolls away under the header. The bulbs take the theme's own blue, red, green and gold, and a theme turns the strand on with one token.
- **The Yule relic collection.** 40 original line drawings: ornaments, Christmas things, winter things, a handful of *Frozen* nods, and two glyphs.
- **Winter quotes.** A seventh world in the screensaver's quote bank, "Yuletide": *A Christmas Carol*, Norse winter lore, Andersen's *The Snow Queen* (the fairy tale *Frozen* came from), Shelley and two short *Frozen* lines.

The name is the owner's choice (2026-11-21, from four offered). Yule is the Norse midwinter feast that became Christmas, so it covers both halves of the ask and sits in Bifrost's Norse lore.

## Gate

PLAN-41 merged. Single PR, on `feat/plan-42-yule` into `develop`. The plan itself landed on `develop` on its own before implementation (the PLAN-40 precedent); the PR archives it to `completed/`.

**⛔ Look-approval checkpoint (the Halloween flow, owner's choice 2026-11-21).** The first implementation step is a preview round, and no code is committed until the owner approves it:

- Drafts live in the scratchpad.
- They are shown as screenshots of the real built hub, with the draft tokens, the snow and lights prototypes, and a contact sheet of every relic injected at runtime.
- The round repeats until the owner approves the look.

## Verified against the codebase, not assumed

- **A theme is one JSON file** (`client/src/assets/themes/<id>.json`, bundled by `core/theme/bundled.ts`'s eager `import.meta.glob`). Halloween needed no CSS of its own: every effect it has (moon, mist, candy-corn bridge, lit-pumpkin buttons) is a value of an existing atmosphere token. `themes.test.ts` pins the exact file list ("the eight built-ins") and checks each file against the schema and the contrast floor.
- **The schema rejects unknown tokens** (`additionalProperties: false` in `core/theme/schema.ts`), so new tokens are schema changes. `ATMOSPHERE_COLOR_TOKENS` takes colours in the `COLOR_PATTERN` grammar. `ATMOSPHERE_CSS_TOKENS` takes free CSS values with no `url(`, `@` or `;`. `--stars-alpha` and `--relic-alpha` are the existing precedent for a plain number in the second group.
- **The engine applies tokens as inline custom properties on `:root`.** `apply()` also sets `data-theme` and `color-scheme`, clears the previous theme's keys, and notifies subscribers (`themeEngine.subscribe`, used by the screensaver, the switcher and Heimdall). The resolved token maps are in `BUNDLED_THEMES`. The engine keeps the active id but not its tokens.
- **The default is one constant**, `BUILT_IN_DEFAULT_THEME` (`core/theme/builtInDefault.ts`, `'halloween'`). It is read by `resolveThemeChoice` (visitor choice → household default → built-in → colour scheme → first) and by `seoBuild.ts`'s `firstVisitTheme`/`firstPaintStyle`. When both schemes land on one theme, the first-paint style is one rule.
  - `e2e/standalone/standalone.spec.ts` pins `halloween` for both schemes.
  - `core/theme/index.test.ts` uses `halloween` only as a fixture id passed in explicitly, so it needs no change.
- **A light theme gets no stars by default** (`--stars-alpha: 0` in `tokens.css`'s light block and in `resolve.ts`'s light defaults). The starfield is `.sky::after`: five 1–1.5 px radial-gradient dots tiled at five sizes, coloured `--stars`. It does not move.
- **`.sky`** is `position: fixed; inset: 0; z-index: -1` inside `.shell` (`isolation: isolate`), so anything inside it paints behind every card and panel.
  - `::before` is the aurora ribbon (`--bridge` at 7%, blurred, `aurora-drift`) and `::after` the starfield.
  - `SkyRelics` (`core/ui/SkyRelics.tsx`) renders inside it. It is a `lazy()` + `withChunkTimeout` + `ChunkBoundary` wrapper that requests `RelicScatter.tsx`'s chunk once the browser is idle (`requestIdleCallback`, 2 s timeout, 200 ms `setTimeout` fallback), and logs one `warn` if the chunk fails (PLAN-41).
- **The header** is `.shell-header`: `position: sticky; top: 0; z-index: 10`, a blurred `--header-veil` and a 1 px `--border` bottom.
  - Its height is 62 px at every width (`--header-h: 3.875rem`).
  - The 3 px `.bridge-strip` sits above it, in `.shell` (`position: relative`), and scrolls away.
  - **Two bars park directly under the sticky header at ≥768 px**, at `top: var(--header-h)` and `z-index: 6`: Accio's `.shelf-filters` and Portkey's `.pk-search`. Anything hanging from the sticky header would dangle over them while scrolling.
  - The Guide panel (`z-index: 41`) and the notification stack (`80`) sit above anything at the header's level.
  - `.shell-main`'s top padding is 32 px, or 24 px at ≤640 px, so every page leaves at least 24 px of empty space under the header when scrolled to the top. The "connection lost" `.offline-banner`, when shown, sits in that space.
- **Decorative loops are compositor-only.** `e2e/browser/shell.spec.ts` lists every named CSS animation on `/`: exactly `aurora-drift`, `bridge-flow` and `relic-float` today. It fails any keyframe property other than `transform`, `translate` or `opacity`.
  - `base.css`'s `prefers-reduced-motion: reduce` rule shortens every animation to 0.01 ms with one iteration, so a reduced-motion device sees the sky stand still.
- **First-load budgets** (`client/bundleBudget.ts`): 133 KB total and 10.1 KB of CSS (9.14 KB measured at PLAN-41). Global CSS is inlined into every HTML file, and a lazy chunk's own stylesheet loads with it (PLAN-41). The theme JSONs ride in the entry chunk: Halloween added one, and so will Yule.
- **Primary buttons** are `background: var(--accent-grad); color: var(--bg)`. The wordmark and `.hero-accent` are `--bridge` clipped to text. On a light theme, every stop of both gradients therefore has to read against a near-white page. Nothing tests that today: `themes.test.ts` checks the text tokens only.
- **Relic tones**: `.relic--muted` uses `--relic-muted`, `.relic--teal` uses `--accent-text` and `.relic--violet` uses `--accent-2`, at `--relic-alpha`.
- **Relic collections** are `assets/relics/collections.ts` (the names, loaded with the shell) plus `assets/relics/index.ts` (labels and drawings, in the lazy chunk). `collections.test.ts` holds the two lists equal.
  - Drawings are 24×24 line art through `shared.tsx`'s `base()` (stroke 1.1, round caps), or `glyphRelic(text, fontSize)`.
  - Already taken elsewhere: owl (Wizarding, Olympus), floating candle (Wizarding), paper lantern (Ghibli), laurel wreath (Olympus), antlered patronus (Wizarding).
- **Relic prefs** (`core/relicPrefs.ts`) are `localStorage['bifrost.relics']`, a JSON array, with no key meaning "all".
  - A saved array is filtered against `ALL_COLLECTIONS`, so a collection added later starts **unticked** on a device that saved a choice (the Halloween rollout's owner-manual note).
  - Changes fire `bifrost:relics-changed`, which re-seeds the sky in the same tab.
  - Its `localStorage` reads are not wrapped in `try`, unlike `core/theme`'s.
- **Heimdall's Sky Relics card** (`features/heimdall/sections.tsx`, `RelicsSection`) exists in both builds (standalone keeps Settings, Sky Relics, Loki, Screensaver, About). It renders one check row per collection with a "N relics" badge. Its search manifest has one control, `relics`. `search.test.ts` and `sections.build.test.ts` cover the manifest.
- **Quotes** (`assets/quotes.ts`): 42 quotes over six `QuoteWorld`s, each with a `WORLD_LABELS` entry that Nótt prints under the attribution (`.nott__world`). `quotes.test.ts` checks that every world has a quote ("covers all six worlds"). The pick is uniform over the whole bank, whatever the theme.
- **Screensaver colours** are read from `--screen-*` at draw time (`readColors()` in `Screensaver.tsx`), with fallbacks. A light theme's veil must be light: `accentTextBackdrops` includes the veil, and one `--accent-text` must read on it and on the light surfaces alike.
- **Red as accent-2 has a precedent.** Gryffindor pairs a scarlet `--accent-2` (`#c03a2b`) with a lighter coral `--danger` (`#db6350`).
- **The draft palette's text contrast**, computed with the WCAG formula from the hex values below (the real check is `themes.test.ts` in the preview round):
  - `--text` 14.9:1 on `--bg`, 15.9:1 on `--surface`, 13.8:1 on `--surface-2`;
  - `--text-muted` 5.7 / 6.1 / 5.3;
  - `--accent` 4.9 / 5.3 / 4.6, with `--accent-text` derived from it where `--accent-soft` backdrops need more.

## Scope

**In:**
- `assets/themes/yule.json` (light), and `BUILT_IN_DEFAULT_THEME = 'yule'`.
- Snowfall:
  - three new theme tokens: `--snow`, `--snow-rim`, `--snow-alpha`;
  - a `Snowfall` layer in `.sky`;
  - the per-device switch in Heimdall's Sky Relics card, in both builds.
- String lights: one new theme token, `--lights-alpha`, and a `StringLights` strand hung below the header.
- `assets/relics/yule.tsx`: 40 relics, registered as the `yule` collection, after `halloween`.
- A `yule` quote world, labelled "Yuletide", with 8 quotes.
- A small engine addition: the active theme's resolved tokens, readable and subscribable, so the snow and the lights know whether to draw.
- Tests and the e2e journeys that pin the default or the home page's animations.
- Docs and skills: `THEME-SPEC.md`, `DESIGN.md`, `performance.md`, README, `architecture.md`, `project-structure.md`, `coding.md` (the localStorage allowlist), and the `theme`, `live-verify` and `new-plan` skills' Halloween and "eight themes" lines.

**Out:**
- **Changing the screensaver's motion** (flakes that fall instead of drift). Offered and not picked (2026-11-21); Nótt gets Yule's colours only.
- **Changing how a saved relic choice treats a new collection.** A device that saved a choice before this ships keeps exactly that choice, so Yule starts unticked there, as Halloween did. Reading old saves as "all known collections" would also wake the relics on a device that unticked everything for a clear sky, which the card promises to keep clear. The owner ticks Yule on such devices (owner-manual).
- **Turning Halloween off by default.** The owner chose "everything stays on" (2026-11-21).
- **Removing or changing the Halloween theme or collection.** Both stay selectable.
- **A date-based default** (Halloween in October, Yule in December). The constant is one line to change, and automating it is its own decision.
- **A dark "Yule night" companion theme.**
- **Snow that settles on cards, or reacts to the cursor.** That would mean layout reads or per-frame paint on every page, against the PLAN-40 rule.
- **Seasonal quote filtering.** The bank stays one uniform pool.
- **Sound.**

## Decisions & reasoning

### A world, the Halloween way, and the look approved from screenshots first

Ghibli Dusk with its collection, then Halloween with its own, set the shape: theme, relics, atmosphere, shipped together. Halloween also set the process this plan's gate repeats. The owner approved rendered previews of the real app before any code was written, over two rounds, and the second round ("more relics, more creative") changed the result a lot. A palette and 40 drawings are judged by eye, so the eye goes first. The preview round shows:

- Midgard, Ollivanders, Diagon Alley, Runestone, Heimdall's Sky Relics card and the Nótt screensaver, at 1280 and 390 px;
- one Midgard capture scrolled, to show the lights passing under the header;
- a contact sheet of the 40 relics at full size, and again at sky opacity in both tones;
- the snow at rest, as a still frame, plus a short sequence of frames to show the motion.

### Frost white and frozen water; Christmas lives in the accents

The skill's calm bar is written for dark themes, but its first rule carries over: don't flood the base with the hero colour. An all-blue base reads as a hospital, not a winter morning. The base stays near-white with only a breath of ice in it. Blue is the accent, the frozen water, and Christmas comes in through the second accent, the status colours and the card palette. Draft values (the preview round fixes the final ones):

| Role | Draft | Meaning |
|---|---|---|
| `--bg` | `#f3f8fc` | frost white |
| `--surface` | `#ffffff` | fresh snow |
| `--surface-2` | `#e6f0f8` | packed ice |
| `--text` | `#112338` | midnight fjord |
| `--text-muted` | `#4f6478` | slate ice |
| `--border` | `#cfdeeb` | frost line |
| `--accent` | `#1b6fb5` | glacier / frozen water |
| `--accent-2` | `#b3263a` | holly berry, ornament red |
| `--ok` | `#1d7d52` | evergreen |
| `--danger` | `#cf4a2f` | vermilion, kept apart from holly red |
| `--warn` | `#a8690e` | ornament gold |

- **Holly red is decoration and danger is a warning, so they must not be the same red.** `--accent-2` is a deep cool crimson, and `--danger` a warmer vermilion with its own `--danger-soft`. That is Gryffindor's split, scarlet against coral.
- **Every stop of `--accent-grad` and of `--bridge` has to read on a near-white page**, since one is a button label's background and the other is clipped to text (the wordmark, the hero accent). Nothing tests this, so the preview round measures it:
  - `--accent-grad` runs deep glacier → glacier (`#155a96` → `#1b6fb5`), so its `--bg`-coloured label stays at or above 4.5:1 across the whole button. Daybreak's lighter teal does not, and isn't changed here.
  - `--bridge` keeps to mid-to-deep tones (glacier, an aurora teal, evergreen, holly, a deepened gold), with no pale ice stop that would vanish from the wordmark.
- **Atmosphere, all as token values, as Halloween did it:**
  - **`--sky`**:
    - a pale aurora curtain across the top: teal and violet radials at 8–12%. This is the one *Frozen* scene the sky borrows, northern lights over a fjord, and it is also what the Bifröst is;
    - a winter-sun halo, top right: a soft disc and a faint ring around it, the 22° halo that ice crystals really draw around a winter sun;
    - a cold blue wash at the top that fades out by mid-page, which is what makes white flakes visible on a white page;
    - a soft snowdrift glow along the bottom.
  - **`--stars`** become **frost glints**: a glacier blue at about 35%, with `--stars-alpha: 1`. A light theme's starfield is off by default because pale stars vanish on light, but blue glints on frost white read as ice crystals, for no code at all.
  - **`--card-sheen`**: a frosted band along the top of each card.
  - **`--header-veil`**: frosted white.
  - **`--relic-alpha`** about 0.11. Line art on white needs a little more than Daybreak's 0.09; the preview round decides.
  - **`--screen-*`**: an icy veil (frost white at 96%, which the accent-text check needs light), glacier-blue snow motes, ornament-red "suns", glacier constellation lines, a holly-red ripple and a gold glow.
- **Card palette**, ten Christmas-and-ice hues in order so the first cards look right first: glacier blue, holly red, evergreen, ornament gold, aurora violet, icy teal, cranberry, frost blue, pine moss, gingerbread copper.
- **Syntax and diff**: key in glacier, string in evergreen, number in aurora violet, bool in holly, null and punctuation muted. The diff takes ok, danger and warn.
- **QR**: deep glacier → deep pine on white, dark on light as the skill requires.

### *Frozen*, in a few nods only

The owner asked for "only a few parts" of *Frozen*, and Bifrost ships original art: no characters, no character names in the UI, no song lyrics. The nods are:

- the aurora over a fjord, in the sky;
- six-fold snowflakes as a motif;
- an ice palace of crystal spires;
- a reindeer carrying a carrot;
- a snowman with twig arms: three snowballs, a top hat, a scarf, a carrot nose; generic, not the film's;
- a crocus flower, the flower on the film's kingdom crest;
- two short spoken lines in the quote bank (below).

Everything else is winter and Christmas in general.

### Snowfall is a theme opt-in, not Yule's own CSS

Themes are data. A rule like `[data-theme='yule'] .snow` would be the first theme-specific stylesheet in the codebase and would make the next snowy theme a code change. Snow is described by three new tokens instead:

- **`--snow`** (colour): the flake's core.
- **`--snow-rim`** (colour): a soft rim, so a white flake still shows against a white page. A dark theme would leave it `transparent`.
- **`--snow-alpha`** (CSS number, 0–1): the layer's opacity. **Omitted means 0, and 0 means no snow element at all.**

They join the schema's colour and CSS groups. `resolve.ts` derives `--snow-alpha: 0` when it is omitted (and `--snow`/`--snow-rim` as white and transparent), so the eight existing themes resolve as today plus these tokens at their off values. `THEME-SPEC.md` documents the three.

**Not rendered, rather than rendered at opacity 0.** An opacity-0 layer would still run its animations, on every page, in every theme. `Snowfall` mounts its layers only when the active theme's resolved `--snow-alpha` is above 0 and the device's Snowfall switch is on. It reads the resolved tokens from the engine rather than `getComputedStyle`, which is deterministic and unit-testable. A value that is not a number reads as off; the schema guarantees the format, so that is validation control flow and is not logged.

**The engine addition.** The engine already holds each resolved theme and notifies on every apply. It gains `getActiveTokens()`, the map it last applied (and for a cached id this build no longer bundles, the cached map, which has no snow token, so no snow). The `Snowfall` and `StringLights` components subscribe with `useSyncExternalStore`, the `core/notify` pattern. Switching to or from Yule in the switcher then starts or stops the snow at once.

### Snow is CSS on the compositor, not a canvas

A canvas snowfall (Nótt's approach) costs a `requestAnimationFrame` loop on every page for as long as a tab is open, painting every frame. CSS layers moved by `transform` are painted once and only composited after that, and the PLAN-40 rule and the shell journey already require exactly that for anything decorative and long-running.

- **Three depth layers** (far, mid, near). Each is a block one tile taller than the viewport (`inset: calc(-1 * var(--tile)) 0 0`), tiled with a handful of radial-gradient flakes per tile:
  - far: about 1.5 px flakes, 260 px tile, about 28 s per tile;
  - mid: about 2.5 px, 320 px tile, about 20 s per tile;
  - near: about 3.5 px, 380 px tile, about 14 s per tile.

  The flakes are `--snow` at the centre and `--snow-rim` at the edge. Tile widths differ per layer, so the repeat is not visible, the starfield's trick.
- **Fall**: `snow-fall` animates `transform` from 0 to `translateY(var(--tile))`, linear and infinite. The pattern repeats every tile, so the loop is seamless at any viewport height, the `bridge-flow` reasoning applied vertically.
- **Sway**: `snow-sway` moves each layer's wrapper by a few pixels left and right with `translate`, alternating and out of step per layer, so the flakes drift rather than fall in straight lines. The two compose, as `relic-float`'s `translate` does with each relic's `rotate()`.
- **In front of the relics, behind everything else.** The layers come after the relics inside `.sky`, so flakes pass in front of the faint line art and behind every card.
- **Phones (≤640 px) drop the far layer** (`display: none` under that query). Each layer is a full-viewport texture: about 12 MB at a 390 px phone's 3× density. Three, plus the blurred aurora ribbon, is a real share of an older iPhone's GPU memory, and the far layer's 1.5 px flakes are the least visible there. Live-verify records the layer memory for the PR. The preview round shows the phone with two layers, and if the owner wants the denser look there, all three stay, with a `decisions.md` row and criterion 4 changed to match.
- **Reduced motion**: `base.css`'s rule already stops every animation, so the flakes stand still: a snowy sky, not a falling one. No extra code.
- **No layout shift**: `.sky` is fixed and the layers are absolutely positioned inside it.

### Snow and lights ride the relic chunk, after idle

PLAN-41 moved decoration out of the first load and wrote a budget to keep it out. The snow and the lights are decoration too, so they load in the chunk `SkyRelics` already requests at idle, each with the stylesheet it imports (`core/ui/snowfall.css`, `core/ui/string-lights.css`), the PLAN-41 rule for styles. The first-load CSS figure doesn't move, and the first-load JavaScript grows only by the theme JSON (about 1 KB gzipped, which the PR measures).

- **One chunk, two mount points.**
  - Today the chunk's entry is `RelicScatter.tsx` itself (`relicScatterChunk.load = () => import('./RelicScatter')`). A new entry module, `core/ui/skyDecor.ts`, re-exports `RelicScatter`, `Snowfall` and `StringLights`, and the chunk object becomes `skyDecorChunk`, loading it. `SkyRelics.test.tsx` fails it through that object.
  - `SkyRelics` renders the first two inside `.sky`.
  - A new `HeaderLights`, in the same module as `SkyRelics` and sharing its `whenIdle` and chunk object, renders `StringLights`. `App.tsx` mounts it right after `.shell-header`.
  - Both `lazy()` wrappers resolve the same import, so the chunk is fetched once.
- **Failure costs decoration only.** Each mount point has its own `ChunkBoundary`, with the existing `warn` naming which one failed, so a chunk that can't load leaves an empty sky and a bare header.
- **They appear a moment after the first paint**, like the relics. Being absolutely positioned, they shift nothing.
- **Not warmed for offline mode**, for the reason PLAN-41 gave: the chunk loads at boot, long before anyone can arm offline mode.

### String lights hang below the header, in the theme's own colours

A strand of bulbs hanging from the header is the most "Christmas" thing a web page can do, and the header is the one place every page shares.

- **Placement: below the header, in the page, so it scrolls away.** `.string-lights` is absolutely positioned in `.shell` at the header's bottom edge (`top:` the bridge strip's 3 px plus `--header-h`). It spans the width, is about 16 px tall, is `pointer-events: none` and `aria-hidden`, and sits at `z-index: 1`, under the header's 10.
  - At the top of a page it hangs in the 24–32 px of empty space every page leaves under the header, like lights from an eave.
  - As the page scrolls it scrolls up under the header, so it never sits over text you're reading.
- **⚠️ Why not hang it from the sticky header itself.** That was the first idea. Accio's filter bar and Portkey's search park directly under the sticky header at ≥768 px, so a strand that sticks with the header would dangle over their controls whenever those pages are scrolled, and over whatever text passes underneath. Scrolling away avoids every overlap and adds no rule to any page.
  - The preview round shows a scrolled capture.
  - If the owner wants the lights always visible, the strand moves *inside* the sticky header instead, along its top edge in the 12 px top padding above the wordmark and nav. That overlaps nothing either, and it is the same component with a different `top` and parent.
- **The "connection lost" banner hides it.** That banner appears in the same space under the header. `.shell:has(.offline-banner) .string-lights { display: none }` keeps the strand off it; `:has()` works in every browser the app supports.
- **It never changes the header's 62 px**, or anything that parks below it by `--header-h`.
- **Drawing**:
  - the wire is a scalloped line, a tiled elliptical radial-gradient arc in `--text-muted` mixed toward transparent;
  - each bulb is a small C7-style oval with a cap and a soft glow, drawn with radial gradients;
  - there are four bulb layers, one per colour, each with every fourth bulb, offset along the wire.
- **The colours are the theme's own roles**: `--accent`, `--accent-2`, `--ok` and `--warn`, which in Yule are ice blue, holly red, evergreen and gold. So the only new token is **`--lights-alpha`**, on the snow's terms: omitted means 0, and 0 means not rendered. A later theme that turns lights on gets bulbs in its own palette.
- **Twinkle**: `lights-twinkle` animates each colour layer's `opacity` between full and about 40%, alternating, with a different duration and delay per layer, so the strand chases and shimmers on the compositor.

### Yule becomes the default the way Halloween did

`BUILT_IN_DEFAULT_THEME` becomes `'yule'`. The 2026-10-29 rule is unchanged: every first visit, in either colour scheme, behind a visitor's own pick and the household default. So:

- **Dark-scheme devices land on a light theme on first visit.** That is the rule Halloween already applied the other way round (light devices landed on a dark theme), and it's what "default" meant then.
- **Returning visitors who never picked a theme move to Yule.** Their cache replays Halloween for a moment (until the household default answers on the hub, or at once on the standalone site), then Yule applies without a fade. This happens once, after the deploy. Anyone who picked Halloween keeps it.
- **⚠️ The household default still wins.** If Heimdall → Settings → Default theme on the hub is set to Halloween, every device without its own pick stays on Halloween. The owner checks it (owner-manual).
- **The standalone site's no-JS first paint** follows the constant through `firstPaintStyle`: one rule, `color-scheme: light`.

### The Yule relics: 40 drawings, all collections still on

The same stroke language as the other five collections (24×24, stroke 1.1, round caps), original drawings, nothing already taken by another collection:

- **Ornaments and decorations (14):** round bauble with a swirl band, teardrop finial ornament, star tree-topper, decorated Christmas tree, wreath with a bow, holly sprig, mistletoe, poinsettia, jingle bells on a ribbon, a C7 light bulb, candy cane, gift box with a bow, stocking, snow globe.
- **Christmas (10):** Santa hat, sleigh, reindeer with a carrot, gingerbread man, nutcracker, angel, cocoa mug with marshmallows, Yule log cake, knitted sweater, a pair of mittens.
- **Winter and frozen (14):** three distinct snowflakes (six-fold star, branched dendrite, hexagonal plate), the snowman, icicles, the ice palace, ice skate, sled, igloo, pine cone, snowy pine, penguin, aurora over mountains, crocus.
- **Glyphs (2):** `JÓL` (Old Norse and Icelandic for Yule) and `NOËL`. Both are Latin script, which the self-hosted Space Grotesk and Inter cover. A rune glyph would fall back to whatever system font the device has.

The owner chose to keep every collection on by default (2026-11-21), so a device with no saved choice draws from all six, Yule included. With 40 of about 155 drawings, roughly a quarter of each page's relics are Yule's. The count per page stays 10–14. The card shows "Yule · 40 relics". Devices that saved a choice keep it (Scope, Out).

### A per-device Snowfall switch, in the Sky Relics card

Snow is the most visible motion Bifrost has ever drawn, and someone reading a long document may not want it. Reduced motion already stills it, and the switch hides it on one device. It sits in the Sky Relics card because that card already holds this device's sky.

- **Storage**: `core/relicPrefs.ts` gains `getSnowfallEnabled()`/`setSnowfallEnabled(on)` under `localStorage['bifrost.snowfall']` (`'off'`, or absent for on). It fires the same `bifrost:relics-changed` event, so an open tab updates at once, as the relics do.
  - Reads and writes go through the `try`/`catch` pattern `core/theme` uses. A blocked store reads as on: a designed fallback, a silent `catch` with its comment.
  - The relic reads are wrapped the same way while there.
- **The coding rule's allowlist** ("relic-collection prefs") becomes "sky prefs (relic collections, snowfall)", logged in `decisions.md`. It is the same class: one device's visual preference, nothing to sync.
- **UI**: a "Snowfall" check row under the collections, with the caption "Falls in a theme that has snow (Yule). Off keeps this device's sky still." It gets its own search manifest entry (`snowfall`; keywords snow, winter, yule, motion), and the section's blurb becomes "The artifacts and the snow in the background sky." The card exists in both builds, so the switch does too.
- **The lights have no switch.** The owner asked for one for snow only. They are a 16 px strand, and reduced motion stills them.

### Winter quotes: a seventh world, "Yuletide"

`QuoteWorld` gains `'yule'`, with `WORLD_LABELS.yule = 'Yuletide'` and 8 quotes. The pick stays uniform over the bank, so these come up as often as any world's, in any theme, the bank's existing rule. Candidates (exact wording and attribution are checked against a source text before they ship; a line that can't be verified is dropped, not paraphrased):

1. "I will honour Christmas in my heart, and try to keep it all the year." (Ebenezer Scrooge, *A Christmas Carol*)
2. "God bless Us, Every One!" (Tiny Tim, *A Christmas Carol*)
3. "Mankind was my business." (Jacob Marley, *A Christmas Carol*)
4. "Fire is best among the sons of men, and the sight of the sun." (*Hávamál*)
5. A line from Andersen's *The Snow Queen*, the "white bees" (the grandmother's name for snowflakes), wording from a public-domain translation
6. "If Winter comes, can Spring be far behind?" (Percy Bysshe Shelley, *Ode to the West Wind*)
7. "Some people are worth melting for." (Olaf, *Frozen*)
8. "Only an act of true love can thaw a frozen heart." (*Frozen*)

The two *Frozen* lines are short spoken lines, in the bank that already quotes the MCU and Studio Ghibli; no lyrics. The *Frozen* attributions are the bank's existing practice (speaker, then the world label underneath), and nothing in the app's chrome names the film.

## API contracts

None. Every change is client-side: a theme file, tokens, components, relic art, quotes and a device-local preference. No route is added, changed or removed, `server/openapi.json` is unchanged, and the household default is still the existing `GET /api/v1/heimdall/access` field.

## Task checklist

**Preview round (⛔ before any commit)**
- [ ] `npm install`, `npm audit` at 0 (fixed first if not, per the rule), on `feat/plan-42-yule` from an up-to-date `develop`
- [ ] Draft `yule.json`, the snow and lights prototypes, and the 40 relics in the scratchpad. The built hub is screenshotted with them injected at runtime: the pages, widths and states listed under "A world, the Halloween way", plus the relic contact sheet
- [ ] The draft passes `themes.test.ts`'s schema and contrast checks (run against a copy), and the `--accent-grad`/`--bridge` stops are measured against `--bg`
- [ ] The owner approves the look; any change goes round again

**Theme**
- [ ] `client/src/assets/themes/yule.json`, the approved values
- [ ] `core/theme/builtInDefault.ts`: `'yule'`, with the comment's history updated
- [ ] `core/theme/schema.ts`: `--snow` and `--snow-rim` in `ATMOSPHERE_COLOR_TOKENS`, `--snow-alpha` and `--lights-alpha` in `ATMOSPHERE_CSS_TOKENS`
- [ ] `core/theme/resolve.ts`: omitted `--snow-alpha`/`--lights-alpha` resolve to `0`, and `--snow` to white, `--snow-rim` to `transparent`
- [ ] `core/theme/index.ts`: `getActiveTokens()` (the applied map), notified on every apply

**Sky**
- [ ] `core/ui/Snowfall.tsx` and `core/ui/snowfall.css`:
  - three layers, `snow-fall` (`transform`) and `snow-sway` (`translate`);
  - the far layer dropped at ≤640 px;
  - mounted only when `--snow-alpha` > 0 and the switch is on;
  - subscribed to the engine and to the prefs event.
- [ ] `core/ui/StringLights.tsx` and `core/ui/string-lights.css`:
  - the wire and four bulb layers in `--accent`, `--accent-2`, `--ok` and `--warn`, with `lights-twinkle` (`opacity`);
  - absolute in `.shell` at the header's bottom edge, `z-index: 1`, hidden while `.offline-banner` shows;
  - mounted only when `--lights-alpha` > 0.
- [ ] `core/ui/skyDecor.ts`, the chunk entry, re-exporting `RelicScatter`, `Snowfall` and `StringLights`. `relicScatterChunk` becomes `skyDecorChunk`. `SkyRelics` renders the first two in `.sky`. `HeaderLights` (same module, the same `whenIdle` and chunk object) renders the third, and `App.tsx` mounts it right after `.shell-header`. Each mount point has its own `ChunkBoundary` and `warn`. Comments that count the drawings (115) are updated.
- [ ] `core/relicPrefs.ts`: `getSnowfallEnabled`/`setSnowfallEnabled` (`bifrost.snowfall`), and storage access in `try`/`catch` with the designed-fallback comment

**Relics**
- [ ] `client/src/assets/relics/yule.tsx`: the 40 approved drawings, `YULE_RELICS`
- [ ] `collections.ts` (`'yule'` in the type and in `ALL_COLLECTIONS`, after `halloween`) and `index.ts` (`yule: { label: 'Yule', relics: YULE_RELICS }`)

**Heimdall**
- [ ] `RelicsSection`: the Snowfall row and caption; the section blurb; the `snowfall` manifest entry with its keywords

**Quotes**
- [ ] `assets/quotes.ts`: `'yule'` world, `WORLD_LABELS.yule = 'Yuletide'`, the verified quotes; header comment lists the world

**Tests that pin the old default or the home page**
- [ ] `core/theme/themes.test.ts`: nine built-ins, `yule.json` in the list
- [ ] `assets/quotes.test.ts`: seven worlds
- [ ] `e2e/standalone/standalone.spec.ts`: first paint is `yule` in both schemes
- [ ] `e2e/browser/shell.spec.ts`: it waits for `.snowfall` and `.string-lights` as well as `.relic` (two mount points can resolve on different frames), and the animation names on `/` gain `lights-twinkle`, `snow-fall` and `snow-sway`, still compositor-only

**Docs**
- [ ] `docs/THEME-SPEC.md`:
  - the four tokens in the Atmosphere group, with their defaults and the "0 means not rendered" rule;
  - a note on snow on a light theme (`--snow-rim`) and on what the lights take from the core roles;
  - the built-in default renamed.
- [ ] `docs/DESIGN.md`:
  - nine themes, Yule first as the default and Halloween as a plain entry;
  - the relic table gains Yule (40);
  - the atmosphere section gains snowfall, frost glints and the string lights;
  - the ambient-motion exception names them.
- [ ] `docs/performance.md`: the built-in default's name, and this plan's numbers
- [ ] `README.md`: the theme list
- [ ] `.agents/context/architecture.md` (the sky paragraph: one idle chunk, `skyDecor.ts`, with relics, snow and lights at two mount points; 155 drawings) and `project-structure.md` (`yule` in the relic list, the new `core/ui` files)
- [ ] `.agents/rules/coding.md`: the localStorage allowlist wording
- [ ] `.claude/skills/theme/SKILL.md` (the snow and lights tokens), `live-verify/SKILL.md` ("all nine themes"), `new-plan/SKILL.md` (the default's name)
- [ ] `decisions.md`, `progress.md`; this file archived to `completed/` and its row ticked in `plans/README.md` in the PR

## Acceptance criteria

1. **The look is the approved one.** The PR's screenshots match the owner-approved preview round, and any difference is named in the PR.
2. **The theme is valid and readable.**
   - `yule.json` passes the schema and the contrast lint: `--text`, `--text-muted` and `--accent-text` on every backdrop it checks, the screensaver veil included.
   - axe-core's `color-contrast` reports 0 violations for Yule on six pages at 1280 and 390 px.
   - Every stop of `--accent-grad` keeps a `--bg`-coloured label at 4.5:1 or more.
3. **Yule is the default.**
   - A first visit with no stored choice and no household default lands on Yule, in either colour scheme, in both builds.
   - The standalone site's no-JS first paint is Yule's `--bg` in both schemes.
   - A visitor's own pick and the household default still win.
   - All nine themes remain in the switcher.
4. **Snow falls only where asked.**
   - On Yule, every page shows falling snow behind all content and in front of the relics.
   - In any other theme, or with the switch off, no snowfall element exists in the DOM.
   - The switch applies at once in the tab that changed it.
   - Reduced motion shows still snow.
   - Phones at ≤640 px render two layers.
5. **Lights hang only where asked.**
   - On Yule, every page shows the strand under the header at the top of the page, in the four role colours, twinkling.
   - Scrolled, it passes under the header and overlaps no content, including Accio's and Portkey's sticky bars.
   - The header stays 62 px, nothing on the page moves, and the strand takes no pointer events and is hidden from assistive tech.
   - It is hidden while the "connection lost" banner shows.
   - In any other theme no strand exists.
6. **Compositor only.** The shell journey's animation check on `/` passes with the three new animations listed. Each animates only `transform`, `translate` or `opacity`.
7. **Relics.**
   - Heimdall's Sky Relics card lists "Yule" with "40 relics".
   - A device with no saved choice draws from all six collections.
   - A Yule-only sky renders its art.
   - A page still shows 10–14 relics.
8. **The switch.** Heimdall's Sky Relics card has the Snowfall switch in both builds, findable through Heimdall's search. It is persisted per device and defaults to on.
9. **Quotes.** Nótt can show the 8 (or fewer, if any failed verification) Yuletide quotes, labelled "Yuletide".
10. **First load.**
    - No relic, snow or lights code or CSS is in either build's first load.
    - The first-load CSS figure is unchanged.
    - The JavaScript total grows by about the theme JSON only, and the PR gives the before and after figures.
    - Lighthouse on the standalone `/` and the hub's `/` (the `docs/performance.md` protocol, median of three) shows FCP and LCP no worse than before at the 0.1 s step, and CLS 0. A regression is named in the PR with its cause.
11. **Nothing else changes.** `npm test` and the full `npm run test:e2e` pass. `server/openapi.json` is unchanged, and the eight existing themes resolve to the same tokens, apart from the four new ones at their off defaults.
12. **Docs.** THEME-SPEC, DESIGN, README, performance, the context files, the coding rule and the three skills say what shipped.

## Test checklist

**Unit**
- [ ] `themes.test.ts`:
  - nine built-ins, the default bundled;
  - Yule's schema and contrast;
  - the four new tokens accepted;
  - a `--snow-alpha` carrying `url(` rejected (the existing guard, one case).
- [ ] `resolve`: a theme omitting the four tokens resolves them off, and every existing theme's resolved map is otherwise unchanged
- [ ] Engine: `getActiveTokens()` follows `setTheme`, notifies subscribers, and returns the cached map for an id this build doesn't bundle
- [ ] `relicPrefs`:
  - snowfall defaults on, `set(false)` persists and fires the event, `set(true)` clears it;
  - a throwing store reads as on (and as all collections).
- [ ] `Snowfall`:
  - nothing without `--snow-alpha`, three layers on Yule;
  - unmounts on a theme switch and when the switch is turned off.
- [ ] `StringLights`: nothing without `--lights-alpha`, the strand on Yule
- [ ] `SkyRelics.test.tsx`: a rejected chunk leaves the shell rendered, with an empty sky and header and one `warn` per mount point
- [ ] `collections.test.ts` (unchanged, now covering `yule`); `quotes.test.ts` (seven worlds)
- [ ] Heimdall `search.test.ts`: "snow" finds the Snowfall control

**End-to-end**
- [ ] `shell.spec.ts`: the animation check on `/` with the new names, after all three decorations are attached
- [ ] `standalone.spec.ts`: Yule first paint in both schemes
- [ ] The standalone Heimdall journey (no PIN there): turning Snowfall off removes `.snowfall`, and turning it on brings it back

**Live-verify** (the `live-verify` skill, on the built hub and the standalone build)
- [ ] Fresh light- and dark-scheme profiles land on "Theme: Yule"; snow and lights present; screenshots at 1280 and 390
- [ ] Another theme picked: no snow and no strand in the DOM; Yule picked again: both return without a reload
- [ ] `prefers-reduced-motion: reduce`: snow present and still
- [ ] A Yule-only sky; Heimdall's card shows Yule · 40 and the Snowfall row
- [ ] axe-core `color-contrast`: 0 for Yule on six pages at both widths, and every other theme on `/`
- [ ] Chrome's layer view: the snow layers' memory on a 390 px 3× viewport, for the far-layer decision
- [ ] Lighthouse before and after per `docs/performance.md`

**Manual (owner)**
- [ ] A look on a real iPhone and iPad: snow smoothness, the strand under the header at the notch, and scrolling past it
- [ ] Heimdall → Settings → Default theme on the hub is not pinning Halloween
- [ ] Tick Yule under Sky Relics on any device that saved a relic choice before
