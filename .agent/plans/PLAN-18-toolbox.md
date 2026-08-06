# PLAN-18 — Diagon Alley toolbox (expanding tool cards)

## Goal

Turn Diagon Alley from a row of doors into the utility toolbox itself. Small, pure-client tools stop being separate pages and open **in place**: tapping a card expands a full-width panel below that card's row, the other cards reflow around it, and the page scrolls so the panel is actually readable. Tools that own real state and a server module (Nimbus, Portkey) keep their own page and their card keeps navigating.

This is the scheduled promotion of PLAN-99's **Utility toolbox page** row (plus its **Iris** row). PLAN-99 is reference-only; this file is the spec. **Both rows were deleted from PLAN-99 on 2026-08-04** when this plan was scheduled — see "On completion".

## Gate

After PLAN-17 merged (it is). **Declared exception: two PRs**, the PLAN-07/16/17 precedent.

- `feat/plan-18a-toolbox-shell` — the expanding grid, routing, scroll/a11y, and 4 tools. Merges first.
- `feat/plan-18b-toolbox-tools` — the remaining 9 tools. No new mechanism.

Part B may be stacked on unmerged Part A at the owner's direction (the PLAN-12b/16b/17b precedent).

## Decisions & reasoning

### Layout

- **One expand direction: a full-width panel below the source card's row.** The alternative — small tools expanding sideways into the neighbouring cells — was considered and rejected. At ≤2 columns it degenerates into the same below-panel anyway (so both paths get built and only one gets the benefit); a card in the **last column** has no room to its right and grid would wrap it to a fresh row, so the card physically jumps on click; and sideways expansion shoves the rest of the row around, which is the one motion that reads as broken. A panel below leaves every card exactly where the user last saw it, which is what makes the caret pointing back at the source card legible.
- **Direction is one thing; width use is another.** Each tool declares an **inner layout** so the full-width panel is never a narrow column floating in dead space:
  - `split` — controls column | live-output column (`minmax(18rem, 26rem) 1fr`). This is what "expand to the right" was actually asking for: QR gets its input + size buttons on the left and the code on the right, using the width instead of stacking.
  - `full` — content spans the panel; paired text areas sit side by side at `1fr 1fr`.
  Both collapse to a single stacked column at ≤768px. **A tool may not centre a fixed-width block inside the panel** — that is the "too much extra spacing" failure mode this rule exists to prevent, and it is an acceptance criterion, not a style note.
- **Its own grid and card, not `.portals`/`Portal`.** `.portals` is `minmax(15rem, 1fr)` tuned for portal cards carrying a description and a `go` footer; tool cards are compact (icon + title + one-line hint), so the toolbox grid uses a smaller track and fits more per screen. Keeping it separate also stops the expanding-row behaviour leaking into Midgard and Ollivanders, which do not want it.
- **The gradient and the palette are preserved, and shared rather than copied.** `cardToneClass(index + 1)` + `--ct` + the `--card-1..10` palette are unchanged — colour still follows position per `rules/coding.md` §Frontend. The tone-lit surface recipe (corner radial gradient, `--card-sheen`, tone border/glow on hover, tone-tinted icon chip) is **extracted out of `.portal` into a shared `.tone-surface` base class** in `core/ui/ui.css` that both `.portal` and the new `.tool-card` compose, so the two cannot drift apart. Extracting it must not change how any existing hub renders — a before/after screenshot of Midgard and Ollivanders is part of the test checklist.
- **The open panel inherits the source card's `card-tone-N`**, so its border and gradient are tinted by that card's hue and the expansion visibly belongs to the card that opened it.
- With 15 cards the palette wraps (`cardToneClass` wraps after 10), so cards 11–15 repeat hues 1–5. That is the palette's designed behaviour and is accepted.

### Where the code lives

- **`core/ui/ExpandingGrid`** owns the mechanism (column measurement, row math, panel placement, scroll, focus, caret) and the `.tool-card` presentation. **`features/toolbox/`** owns the tool registry and the tool bodies.
- Reason: `core/ui/` is already where shared page furniture lives (`Portal`, `Card`, `cardTone`), and the Ollivanders hub is the obvious next consumer. A hub page in `app/pages/` *may* legally import from a feature, so this is not a boundary violation today — but it would make `features/toolbox/` a de-facto shared UI library wearing a feature slice's clothes, and the day anything under `features/` needs the pattern it becomes a build failure with no fix but this move.

### Routing

- **Open state lives in the URL: `/diagon-alley/:toolId`.** Back closes the panel, refresh reopens it, and a tool is linkable. `diagon-alley` is already in `RESERVED_ROOTS` and nested segments need no entry (`rules/coding.md` §Routing) — **no reserved-roots change in this plan**.
- Open, switch and close all **push** (`navigate(path)`), so Back retraces the tools the user opened.
- An unknown or unavailable `:toolId` renders the hub with nothing open and **replaces** the URL with `/diagon-alley` — never a 404, never a dead panel.
- **`/sigil` becomes `<Navigate replace to="/diagon-alley/qr" />`** and `features/sigil/SigilPage.tsx` is deleted; its UI becomes the QR tool body, still driving `core/ui/QrCard`. `/sigil` **stays in `RESERVED_ROOTS`** — the redirect is a real route and a `/go/sigil` slug shadowing it would be confusing. The nav `match` array drops `/sigil` and gains nothing (the tool is under `/diagon-alley` now).
- **The `qr-tool` server module is untouched.** It still serves `GET /api/qr/server-url`, which Midgard's Join card depends on. Only the page goes.

### Server side

- **A capability-only `toolbox` module**, both profiles — the `variant` precedent: `register()` is a deliberate no-op, and presence in the manifest is what puts the tools in `/api/capabilities` so the existing `has(stall.module)` filter can gate them. It exists so the future cloud profile can turn the toolbox off without a client change. **No routes, no tables, no events.**

### Environment gating

- The card model carries **`supported?: () => boolean`**, evaluated once on mount; an unsupported tool is not rendered at all, and deep-linking to it falls back to the hub.
- **Its only user today is the SHA-256 tool.** `crypto.subtle` is secure-context-only and Bifrost is served over plain http on the LAN, so it is `undefined` on every device except the host Mac at `localhost` — "works for the developer, broken on the phone". Gating it is strictly better than bundling a JS hash implementation to paper over it.
- **UUID does not need the hook.** `crypto.randomUUID()` is gated the same way, but `crypto.getRandomValues()` is not, so v4/v7 are assembled from raw bytes and work everywhere. `core/deviceId.ts:11` already carries this exact fallback and its comment — this plan does not invent the trap, it just refuses to walk into it twice.

### Tool state

- A tool's inputs **survive close-and-reopen within the session**. A `useToolState(toolId, initial)` hook in `features/toolbox/` backed by a module-level `Map` keeps the value across unmount; a page reload clears it. **Not `localStorage`** — this is scratch input, not a draft worth persisting, and the allowed-localStorage list in `rules/coding.md` is not being widened for it.

### Code splitting

- **One lazy chunk for the whole tool set**, loaded when the first tool opens — not one chunk per tool as PLAN-99's note suggested. Every tool body is a few kB of pure functions, so per-tool chunks would be a dozen requests for less than one round trip's worth of bytes. A tool that ever pulls a dependency over ~20 kB gets its own chunk at that point; none of the thirteen does today (`qrcode` is already in the main graph via `QrCard` on Midgard). Logged as a deliberate deviation from the PLAN-99 note.

### Naming

- **No lore names are invented for the new tools.** Titles stay functional and scannable — "Base64", "JWT", "URL", "Epoch". Existing names stand as they are: "Make a QR", Nimbus, Portkey, and Iris (PLAN-99's own name for the colour toolkit).

### Corrections to PLAN-99's notes

- PLAN-99 says Iris reuses "the theme WCAG util". It cannot: `contrastRatio` lives in `server/src/modules/themes/contrast.ts` — the wrong workspace *and* inside a server module. Iris gets its own client implementation, **unit-tested against the same vectors** as `themes/theme-validation.test.ts` (`#000`/`#fff` → 21:1, `#fff`/`#fff` → 1:1). The duplication is deliberate; introducing a shared workspace package for forty lines of WCAG maths is out of scope.

## Tool registry

`kind: route` cards navigate as they do today. `kind: tool` cards expand.

| Part | Id | Card title | Kind | Inner | Notes |
|---|---|---|---|---|---|
| — | — | Nimbus | route | — | Unchanged, `/nimbus` |
| — | — | Portkey | route | — | Unchanged, `/portkey` |
| A | `qr` | Make a QR | tool | split | Migrated off `/sigil`; drives `core/ui/QrCard` |
| A | `base64` | Base64 | tool | full | Encode/decode, standard + URL-safe. **UTF-8 correct** — bare `btoa` throws on non-ASCII, so it goes through `TextEncoder`/`TextDecoder` |
| A | `uuid` | UUID | tool | split | v4 + v7, count 1–100, uppercase toggle, copy-all. Bytes from `getRandomValues` |
| A | `epoch` | Epoch | tool | split | Unix s/ms ↔ local ↔ UTC ↔ ISO-8601, both ways, live "now" row, relative time |
| B | `url` | URL | tool | full | `encodeURIComponent`/`encodeURI`/decode; parser splitting a URL into scheme/host/port/path + an editable query-param table; HTML-entity encode/decode as a mode |
| B | `bytes` | ASCII / Hex / Binary | tool | full | Text ↔ hex ↔ binary ↔ decimal bytes; number-base convert (dec/hex/oct/bin); byte/char/line/word counts |
| B | `jwt` | JWT | tool | full | Decodes header/payload/signature and renders `exp`/`iat`/`nbf` as local time with an expiry verdict. **States on the panel that it does not verify signatures** — no key material reaches the browser and nobody may read a green panel as "this token is valid" |
| B | `iris` | Iris | tool | split | hex/rgb/hsl/oklch conversion, WCAG contrast checker, palette extraction from a dropped image. *Stretch:* export the palette as a `themes/*.json` starter per THEME-SPEC |
| B | `cidr` | CIDR | tool | split | `192.168.1.0/24` → mask, network, broadcast, first/last host, usable count; IPv4 |
| B | `case` | Case | tool | full | camel / Pascal / snake / kebab / CONSTANT / Title / sentence + slugify |
| B | `secret` | Password | tool | split | Length + charset toggles, `getRandomValues`, entropy estimate |
| B | `cron` | Cron | tool | split | Explains a 5-field expression in words + the next 5 fire times in local tz |
| B | `hash` | SHA-256 | tool | split | `crypto.subtle`; **`supported: () => !!globalThis.crypto?.subtle`** — hidden on plain-http devices |

## Interaction contract

**Column measurement.** The panel is inserted at the end of the source card's row, so the live column count is required: parse `getComputedStyle(grid).gridTemplateColumns` (browsers return the used track list, so its whitespace-separated length is the count; `none`/unparseable → 1) inside a `useLayoutEffect`, and keep it current with a `ResizeObserver` on the grid. Measuring in a layout effect means the first paint already has the panel in the right place — no visible jump.

**Row math** is a pure, unit-tested function:
`panelInsertIndex(openIndex, cols, total) = Math.min(Math.ceil((openIndex + 1) / cols) * cols, total)`
The children render as `[...cards.slice(0, insertAt), panel, ...cards.slice(insertAt)]` with stable keys, and the panel takes `grid-column: 1 / -1`.

**Scroll** is a pure, unit-tested function `scrollPlan({ cardTop, panelTop, panelHeight, viewportH, headerH, bottomNavH, scrollY }) → number | null`, applied in a `useLayoutEffect` plus one `requestAnimationFrame` so the panel already has its final height:

1. Panel fully inside the viewport, allowing for the sticky header (`--header-h`) and the mobile bottom nav (`--bottomnav-h`) → **`null`, do not scroll.**
2. Panel shorter than the available viewport → scroll the minimum that puts its bottom above the bottom inset.
3. Panel taller than the available viewport → scroll so the **source card's top** sits just under the header inset. Aligning on the panel's bottom here would strand the panel's own heading and first control off-screen, which is the bug this branch exists to prevent.

`behavior` is `'smooth'`, or `'auto'` under `prefers-reduced-motion`. Scrolling runs on open and on tool-switch only — **never on resize or on a column re-measure**, which would yank the page while someone is dragging a window.

**Tool switching** is one state transition: clicking B while A is open sets the open id once, so one route push and one scroll pass — not a close followed by an open, which would scroll twice against two different layouts.

**Caret.** The panel draws a triangle on its top edge at `--caret-x`, the source card's horizontal centre relative to the grid, measured and recomputed on resize. If the measurement is unavailable the caret is **hidden** — never drawn at a wrong position.

**Accessibility.** The tool card is a `<button aria-expanded aria-controls>`; the panel is `<section role="region" aria-labelledby>` with a visible close button and `tabIndex={-1}`, focused on open. Escape anywhere inside closes and returns focus to the source card. DOM order is card → rest of row → panel, which matches visual order, so tab order needs no `tabindex` juggling.

**Motion.** The panel enters on opacity + a small `translateY` only. Cards are **not** FLIP-animated as they reflow — explicitly out of scope; the reflow is instant and the panel is what animates. `prefers-reduced-motion` drops the transition entirely.

**Suspense.** The lazy tool chunk shows a short visible skeleton inside the panel, never a blank panel.

## API contracts

None. The `toolbox` module registers no routes; every tool is pure client compute. `GET /api/capabilities` gains `toolbox` in its `modules` list.

## Tasks

### Part A — `feat/plan-18a-toolbox-shell`

- [x] Capability-only `toolbox` server module (`variant` precedent); added to both profile manifests in `app.ts`; capabilities test updated
- [x] Extract `.tone-surface` from `.portal` in `core/ui/ui.css`; `.portal` recomposed on it with **no visual change** to Midgard/Ollivanders
- [x] `core/ui/ExpandingGrid` — `.tool-card` presentation, column measurement + `ResizeObserver`, `panelInsertIndex`, panel placement, caret, tone inheritance
- [x] `scrollPlan` + the layout-effect/rAF application; header + bottom-nav insets read from the existing tokens
- [x] A11y: `aria-expanded`/`aria-controls`/`role="region"`, focus on open, Escape closes and restores focus
- [x] Route `/diagon-alley/:toolId` + unknown-id fallback (replace to `/diagon-alley`); `/sigil` → `<Navigate replace>`; delete `SigilPage.tsx`; drop `/sigil` from the nav match list
- [x] `features/toolbox/` registry (`kind`, `inner`, `supported`, lazy body) + `useToolState`
- [x] Rebuild `DiagonAlleyPage` on the registry: Nimbus/Portkey as `route` cards, the rest as `tool` cards; delete the `hub-soon-note`
- [x] Tools: `qr` (migrated), `base64`, `uuid`, `epoch`
- [x] Responsive pass at 375 / 768 / 1280 / 1600 for both inner layouts

### Part B — `feat/plan-18b-toolbox-tools`

- [ ] `url`, `bytes`, `jwt`, `case`, `cidr`, `secret`, `cron`
- [ ] `iris` — conversions + client WCAG contrast (own implementation, PLAN-99's note corrected) + image palette extraction
- [ ] `hash` — `crypto.subtle`, gated by `supported()`; verify the card is absent over LAN http and present on `localhost`
- [ ] *Stretch:* Iris "export as theme JSON starter" against THEME-SPEC
- [ ] Docs sync: `architecture.md` module registry + the `toolbox` note, `project-structure.md`, `decisions.md` rows, `progress.md`, `plans/README.md` gate row ticked
- [ ] Archive this file to `.agent/plans/completed/` **in the Part B PR** (PLAN-99 is already stripped — see "On completion")

## On completion

**PLAN-99 is already clean.** Both rows this plan absorbs — Tier A's **Utility toolbox page** and the 2026-07-22 round's **Iris** — were deleted on 2026-08-04 at the owner's instruction, when the plan was scheduled rather than when it completes, so a backlog row for work that already has a numbered plan never sits around to be misread as still-open. A `PROMOTED … to PLAN-18` note points here in their place. *(This supersedes the earlier instruction in this section to strip them in the Part B PR.)*

So the remaining paperwork is the docs sync in Part B's task list plus **archiving this file to `.agent/plans/completed/` in the Part B PR** — a plan's own PR closes its own paperwork. Not after Part A: Part A ships four tools and none of them is Iris, so this plan is not done until B lands. Optionally flip the PLAN-99 note from `PROMOTED` to `DONE` then.

## Acceptance criteria

1. Tapping a tool card opens a panel spanning the **full grid width, below that card's entire row** — at 1 column, 2, 3, 4 and 5 columns, verified by measurement, not by eye.
2. The cards after the panel reflow around it and **no card changes column when a panel opens**; every card is still reachable and clickable.
3. Resizing the window while a panel is open moves the panel to the new row-end within a frame, and **does not scroll the page**.
4. Opening a card in the **last row** scrolls the panel into view; opening a card whose panel already fits **does not scroll at all**; a panel **taller than the viewport** lands with its own top edge just below the sticky header, not with its bottom edge at the fold. Checked at 1280×800 and 390×844, the latter with the bottom nav present.
5. Switching straight from tool A to tool B scrolls **once**, to B.
6. `/diagon-alley/base64` opens the Base64 tool on a cold load; Back closes the panel; Forward reopens it; `/diagon-alley/nonsense` shows the hub with nothing open and the URL replaced.
7. `/sigil` redirects to `/diagon-alley/qr` and the QR tool produces the same code the old page did; Midgard's Join card still renders (i.e. `/api/qr/server-url` is untouched).
8. No inner layout leaves a centred fixed-width block with empty gutters at 1600px — every panel either fills the width or splits it. No horizontal overflow at 375px.
9. Card colours still follow position: reordering the registry reorders the hues, and the open panel is tinted with its source card's hue.
10. Midgard and Ollivanders render **pixel-identically** before and after the `.tone-surface` extraction.
11. Keyboard only: Tab reaches every card, Enter/Space opens, focus lands in the panel, Escape closes and returns focus to the card that opened it. `aria-expanded` tracks the real state.
12. `prefers-reduced-motion`: no panel transition and instant scrolling (both computed values asserted, the PLAN-17a precedent).
13. The SHA-256 card is **absent** when the page is served over plain LAN http and **present** at `localhost` — proven on two origins, not by reading the code.
14. UUID, password and every random-byte path work over plain LAN http (no `crypto.randomUUID`, no `crypto.subtle` on those paths).
15. Base64 round-trips `héllo 🌉` unchanged; JWT decoding a real token shows the correct `exp` in local time and the panel says it does not verify signatures.
16. Typing into a tool, closing the panel, and reopening it restores the input; a page reload clears it.
17. Opening a tool loads exactly one lazy chunk; the second tool opened loads none.
18. `/api/capabilities` lists `toolbox` in both profiles; removing `toolbox` from the manifest hides every `tool` card and leaves Nimbus/Portkey working.

## Tests

- [x] Unit: `panelInsertIndex` across column counts and the last-row boundary; `scrollPlan` for all three branches incl. both insets; column-string parsing incl. `none`
- [ ] Unit: Base64 UTF-8 round-trip corpus, UUID v4/v7 shape + variant/version bits, epoch conversions across DST and negative timestamps, URL parse/encode corpus, byte/base conversions, JWT decode (valid, malformed, unpadded base64url, missing `exp`), CIDR maths incl. `/31` and `/32`, case conversions, cron field parsing + next-fire times, WCAG `contrastRatio` against the `themes` test vectors
- [x] Component: card renders `aria-expanded`, Escape closes and restores focus, unsupported tool is not rendered
- [x] Server: capabilities integration test lists `toolbox` in both profiles
- [ ] Live-verify (`live-verify` skill): expansion at 4 viewport widths with measured panel/card geometry, the three scroll branches, tool-switch scrolling once, the `/sigil` redirect, the two-origin `crypto.subtle` gate, Midgard/Ollivanders before-and-after screenshots, zero console errors
- [ ] Manual: a real phone on the LAN — panel readability, the bottom-nav inset, and that the SHA-256 card is genuinely absent there
