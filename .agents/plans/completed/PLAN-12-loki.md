# PLAN-12 — Loki (JavaScript shapeshifter: transforms · regex · execution)

## Goal

A full-width JS workbench at `/loki`, in two parts. **Part A — Transforms & Regex:** one editor buffer + a grouped action rail (beautify, minify, stringify/destringify, escape/unescape, quote conversion, strip comments, IIFE wrap/unwrap, cURL→fetch), plus a top-level `Transforms | Regex` mode toggle housing a regex tester. **Part B — Execution ("Calcifer"):** run the buffer in a killable Web Worker sandbox with a console output drawer. Named for the shapeshifter; the run panel is Calcifer, the fire that burns the code.

## Gate

Starts after PLAN-11 is merged (Edda; currently PR #29, in review). Two PRs by declared exception: `feat/plan-12a-loki-transforms`, then `feat/plan-12b-loki-execution` after A merges. **UI checkpoint:** after Part A's first working build, pause for an owner UI/UX review round (Edda/PLAN-01 style) before polish and before Part B.

## Entry points (verified against the codebase 2026-07-23)

Where Loki plugs into what already exists — confirm these still hold at implementation time:

- **Nav / hub card:** Loki is the **4th Ollivanders card**, beside Runestone (`--teal`), Variant (`--violet`), and Edda (`--amber`) in `client/src/app/pages/OllivandersPage.tsx`. Edda is now **live** (no longer the coming-soon slot), so Loki is a brand-new card, not a re-wire of an existing placeholder. It shows only when **`loki`** is in `/api/capabilities.modules`. The card gets a **new 4th tone `--tone-loki` (emerald) with a distinct dual-hue shifting gradient** (see the UI/UX decision below).
- **Shared editor:** `client/src/core/ui/JsonEditor.tsx` already carries **json / plain / markdown** modes (markdown added in PLAN-11 via `@codemirror/lang-markdown` + `--syn-*` tinting). JS mode plugs in identically — add a `javascript` mode branch using `@codemirror/lang-javascript` (a **new** client dep). It also exposes the `applyEdit(fn)` handle (PLAN-11) that toolbar transforms should reuse for minimal-change, single-undo edits.
- **Runestone "Copy as JS":** Runestone's toolbar lives in `client/src/features/runestone/RunestonePage.tsx` (Format / Minify / Sort keys / Unescape / Find / Fold…); add the action there, enabled only when the buffer is Valid JSON, using `core/copy` and the shared `jsonToJs` util.
- **Config:** env keys follow the established zod pattern in `server/src/core/config/index.ts` (schema → `AppConfig` → nested group), mirroring the PLAN-11 `edda.*` keys and the runtime-mutable `OVERLAYS` map that Heimdall writes through.
- **Heimdall card:** Heimdall is a **modal** (PLAN-10) with grouped, searchable sections; the "Loki" card is `settings`-table backed with env defaults and rides the existing settings PATCH + `settings.updated` SSE rebind (same as shortcut/tap-count/log-level/theme-default).
- **Capabilities / profiles:** `/api/capabilities` returns `{ profile, modules }`. Loki registers in **both** profiles so the nav card shows everywhere, but **Part B execution UI is gated client-side on `capabilities.profile === 'local'`** (plus the Heimdall master switch) — a module in both profiles can't advertise a sub-capability, so the profile check is the mechanism.
- **Variant handoff — correction:** Variant's existing `?left=<slug>&right=<slug>` URL handoff loads **saved runestones by slug into the JSON panes** (`fetchRunestone(slug)`), not arbitrary text. Loki's "Diff before/after" is raw JS text, which slugs can't carry, so it needs a **new lightweight text seed** — a sessionStorage bridge (or equivalent) that opens `/variant` in **text mode** with both panes pre-filled. Still route/URL-level, still no cross-feature imports; just not the current slug params.

## Scope

**In (A):** `loki` module (both profiles), all transforms below, syntax-error banner, mode toggle + regex tester, Variant diff hook, panel font control, Heimdall "Loki" settings card, stats bar, full-width creative UI with mobile bottom-sheet rail.
**In (B):** worker runner, console shim + serializer, watchdog + Stop, output drawer, run settings. **Execution is local-profile only — the module ships in both profiles, but the run UI is never reachable in the cloud profile, ever.**
**Out:** base64 encode/decode (**deliberately excluded** — owned by the PLAN-99 utility-toolbox item; Loki stays JS-focused), snippet library (skipped by owner decision — Hermes covers cross-device snippets; backlog if demand appears), TypeScript transforms, node-API shims in the runner.

## Decisions & reasoning

**Transforms (Part A)**
- **Beautify = Prettier standalone** (`prettier/standalone` + babel plugin, lazy-loaded ~300 KB): the industry formatter; hand-rolled formatting breaks on template literals/regex/ASI. Options (indent, quotes, semicolons) from Heimdall defaults. **Minify = Terser** (lazy-loaded ~200 KB): real compression + optional mangle, before→after bytes in the stats bar. Both pure in-browser compute — offline-safe once bundled.
- **Stringify/destringify = pure utils in `core/js/`**, zero deps: stringify escapes the buffer into a string literal (quote style option: `'`/`"`/backtick, or JSON semantics); destringify **lexes** a quoted literal back to raw code — never `eval`. Property-tested: stringify→destringify is identity.
- **Also pure utils:** escape/unescape (HTML entities, URI component), single↔double quote conversion (string-literal-aware, not naive replace), **strip comments (its own rail action, per owner)**, IIFE wrap/unwrap, cURL→fetch (tokenize the cURL command: method/headers/data/url → fetch snippet; unsupported flags listed, never silently ignored).
- **JSON→JS conversion lives in Runestone, not Loki (owner decision; JS→JSON direction dropped entirely).** The pure `jsonToJs` util (demo cases D/E, 2026-07-21: identifier keys unquoted, non-identifier keys like `data-id` stay quoted, single-quoted strings, round-trip identity property-tested) ships in shared core; the surface is a **"Copy as JS" action in Runestone's toolbar**, enabled only while the buffer is Valid JSON ✓ — converted literal to clipboard. Safe by construction (input is already-validated JSON), so no loss guards, no confirm dialogs, and **no JSON5 dependency**. (The converter demo that proved this used JSON5 + acorn; the plan keeps neither for conversion — `jsonToJs` is a hand-written pure util, and acorn is introduced **new** only for the Part-A syntax banner, lazy-loaded.) Loki carries no JSON conversion actions.
- **Universal transform rules:** a refused/cancelled transform leaves the buffer byte-identical; every applied transform is a single CM-history undo away. **Single buffer + undo** over an in/out two-pane — simpler model; Variant exists for comparing (a rail action "Diff before/after in Variant" snapshots pre-transform and opens `/variant` **in text mode** with both panes pre-filled). Note the mechanism: Variant's current `?left/?right` URL handoff resolves **runestone slugs** into the JSON panes, so it can't carry raw before/after JS — this needs a **new lightweight text seed** (sessionStorage bridge or equivalent). Still route/URL-level, no cross-feature imports.
- **Syntax banner:** lightweight acorn parse (~30 KB, a **new lazy dep** — not currently in the tree; the JSON stack uses jsonc-parser, not acorn) surfaces error + line/col above the rail before any transform runs; transforms that require valid JS disable with a tooltip while broken (string-level ones like escape stay enabled).
- **Regex = a top-level mode toggle (`Transforms | Regex`), not a nav entry, not a buried CTA** — Variant's `JSON | Text` precedent: first-class surface, zero nav cost, mobile stacking already solved. Regex mode: pattern + flags + test string, live match highlighting in the test pane, capture-group table, match count, invalid-pattern inline error. Pure client compute; per-mode workspaces survive toggling (the Variant separate-workspaces lesson).

**Execution (Part B — "Calcifer")**
- **Stack: native ephemeral Web Worker per run** (`new Worker(new URL(...), {type:'module'})`, Vite-bundled), no pool, no Comlink. Flow: Run → spawn + `runId` + watchdog (`loki.runTimeoutMs` setting, env default `LOKI_RUN_TIMEOUT_MS=5000`, user-adjustable per run up to a capped max) → worker installs a console shim (`log/info/warn/error/debug/table` → serialized `postMessage`, **caps enforced inside the worker**: entry budget from settings, per-entry ~8 KB truncation) → executes via `AsyncFunction` (top-level `await` works; single-expression detection tries `return (…)` first for REPL feel) → `result`/`error` (stack mapped to editor lines where possible) → main thread streams entries into the output drawer, then **`worker.terminate()`**. Watchdog fire and the manual **Stop** button are the two kill paths — both just terminate. `runId` filtering drops stale messages.
- **The serializer is the load-bearing component:** cycle-safe, depth-limited; explicit representations for `undefined`, `BigInt`, `Symbol`, functions (`ƒ name()`), `Error` (name/message/stack) — structured clone throws on functions and loses `undefined`, so nothing crosses the channel raw. Corpus-tested.
- **Safety model (why Level 2 is enough here):** worker has no DOM/localStorage/cookies and is killable from outside — a `while(true)` can never take the editor down. `fetch` **stays available by default** (calling your own Bifrost APIs from a snippet is genuinely useful on a LAN), flagged in the panel and switchable off in Heimdall. Execution as a whole has a **master switch in Heimdall** and is hidden in the cloud profile (gated on `capabilities.profile === 'local'`).

**Panel font & Heimdall settings**
- **Font control `A− / A / A+`** in the rail: sets `--loki-panel-font` (range 11–22px) scoped to the editor + output drawer only — page chrome untouched, no browser zoom. Chosen size persists **per device** (localStorage — device comfort); the **default** comes from Heimdall. Backlog note: generalize the same control to Runestone/Edda editors.
- **Heimdall "Loki" card** (all `settings`-table backed with env defaults, broadcast via `settings.updated`): default panel font size · default mode on load (Transforms|Regex) · run timeout default · console entry budget · **execution enabled** master switch · runner `fetch` allowed · beautify defaults (indent, quotes, semicolons) · minify mangle · default regex flags.

**UI/UX (owner directive: lots on the plate — creativity mandatory, not optional)**
- **Ollivanders card = a new 4th card tone with a *distinct gradient effect* (owner directive).** The three existing hub cards use a single-hue soft radial-corner tint keyed off one tone token (`--tone-teal`/`-violet`/`-amber`, Runestone/Variant/Edda). Loki's card must read **differently** — fitting the shapeshifter. **Tone: `--tone-loki` = emerald green** (Loki's signature colour), added as `--tone-loki` + `--tone-loki-soft` + `--glow-loki` for **both** dark and light in `client/src/core/tokens.css`, per the tone-gradient system. **Gradient effect (distinct on purpose):** not the other cards' single soft corner tint but a **two-stop diagonal sweep that shifts hue** — emerald → a warmer ember/lime second stop (`--tone-loki-2`, the Calcifer flicker) — so the card visibly "shapeshifts" rather than sitting in one flat wash. A slow, subtle animated drift of the gradient is allowed and encouraged, but **must** be disabled under `prefers-reduced-motion` (the ambient-motion decision applies) and stay within the 150–200ms rule for any hover feedback. Add the matching `.hub-card--loki` (the dual-hue sweep background, hover border/glow off `--glow-loki`, `.hub-card__icon` chip in `--tone-loki`) alongside the existing three in `client/src/app/app.css`. Exact green values + the second-stop hue + drift feel are still an **owner tweak at the UI checkpoint**; this pins the intent (emerald base, shifting two-hue gradient, visibly unlike teal/violet/amber).
- Full-viewport breakout ≥1024px (Edda/Variant precedent). Rail actions in **labeled groups — Format · Strings · Convert · Clean · Run** — never a wall of 14 buttons; each action gets an icon + one-line hint on hover/long-press.
- **Mobile: the rail collapses to a bottom-sheet picker** — tap a group chip, sheet slides up with its actions; thumb-reachable, nothing hidden in overflow ellipses. Output drawer is mobile-primary after a run (Variant's drawer pattern).
- The Run button *is* Calcifer — a flame mark that burns during execution and is the Stop target mid-run. Consult DESIGN.md + the frontend-design sensibilities; invent affordances rather than defaulting to gray toolbar buttons. Confirm/refusal dialogs for JSON⇄JS render the problems table (path · found · becomes), not a paragraph.

## API contracts

Part A is pure client compute — no routes. Module registers in both profiles for capability/nav; **Part B adds no server routes either** (worker is client-side), but the execution capability is flagged local-only and Heimdall settings ride the existing settings PATCH. New env: `LOKI_RUN_TIMEOUT_MS` (default 5000), `LOKI_CONSOLE_MAX_ENTRIES` (default 500) in zod + `.env.example`.

## Task checklist

**Part A**
- [ ] JS mode in the shared `core/ui/JsonEditor` (`@codemirror/lang-javascript` — **new dep**; `--syn-*` mapping), added the same way markdown mode was in PLAN-11; reuse its `applyEdit` handle for transforms
- [ ] `core/js/` pure utils: stringify/destringify (lexer), escapes, quote conversion, strip comments, IIFE pair, curlToFetch, jsonToJs (demo D/E spec) — all unit/property-tested
- [ ] Runestone toolbar: **"Copy as JS"** action (enabled only on Valid JSON ✓; jsonToJs → clipboard via core/copy) — small cross-feature enhancement, uses core util only
- [ ] Prettier-standalone + Terser lazy integration with options from settings; stats bar bytes before→after
- [ ] Syntax banner (acorn), transform enable/disable rules, universal untouched-on-refuse + undo guarantees
- [ ] Mode toggle + regex tester (separate workspaces, match highlighting, group table)
- [ ] Variant diff hook; panel font control (+ per-device persistence); coming from Heimdall: defaults applied on load
- [ ] Heimdall "Loki" settings card (server keys + card UI + broadcast rebind)
- [ ] Full-width layout, grouped rail, mobile bottom sheet; **UI checkpoint with owner**
- [ ] **New 4th card tone + distinct gradient** for the Loki Ollivanders card: emerald `--tone-loki`/`-soft`/`-2` + `--glow-loki` (dark+light) in `tokens.css`, a dual-hue shifting-sweep `.hub-card--loki` in `app.css` (reduced-motion-safe), and the card wired in `OllivandersPage.tsx` (4th card, capability-gated on `loki`)
- [ ] Nav via capabilities (register `loki` in the MANIFEST, both profiles; card + Ollivanders `match` prefix `/loki`)

**Part B**
- [ ] `loki-runner.worker.ts`: console shim with in-worker budgets, serializer (corpus tests), AsyncFunction execution, single-expression detection, runId protocol
- [ ] Main-thread run controller: spawn/watchdog/Stop/terminate lifecycle, stale-message filtering
- [ ] Output drawer: level-colored mono entries, truncation markers, duration summary, mobile-primary
- [ ] Heimdall gates honored live: master switch hides Run group; fetch toggle passed into the worker; timeout/budget from settings
- [ ] Execution is **local-profile only**: the `loki` module stays in both profiles (transforms/regex everywhere), but the Run group / Calcifer UI is hidden unless `capabilities.profile === 'local'` **and** the Heimdall master switch is on — verify both gates in a cloud-profile build

## Acceptance criteria

1. Every transform round-trips its inverse where one exists (stringify↔destringify, IIFE wrap↔unwrap, quote conversions) — property-tested; a refused transform leaves the buffer byte-identical and ⌘Z reverses any applied one.
2. Runestone's "Copy as JS" is disabled while the buffer has errors and, on valid JSON, puts a literal on the clipboard matching demo cases D/E (identifier keys unquoted, `data-id`-style keys quoted, single quotes); JSON→JS→(parse) round-trip is identity, property-tested.
3. Beautify/minify handle template literals, regex literals, and a 500 KB bundle without hanging (lazy-load spinner allowed, jank not); minify shows honest before→after bytes.
4. Regex mode highlights matches live, shows capture groups, survives mode toggling with both workspaces intact.
5. Run: `console.log` streams to the drawer; `while(true){}` is killed by the watchdog at the configured timeout with the editor fully responsive throughout; Stop kills mid-run; a million-log loop truncates at the in-worker budget with "…and N more"; `await fetch('/api/health')` works with the toggle on and is blocked with it off; thrown errors show name/message/stack with editor line mapping.
6. Font A−/A+ changes only panel text (page chrome unchanged), persists per device, and Heimdall's default applies on a fresh device.
7. Heimdall card round-trips every setting; execution master switch off → Run group absent everywhere without reload.
8. Mobile 390×844: bottom-sheet rail reachable one-handed, zero horizontal overflow, drawer leads after a run.
9. Loki's Ollivanders card renders the **emerald `--tone-loki` with a dual-hue shifting gradient visibly distinct** from the teal/violet/amber cards (not the single-corner tint), in **both** light and dark themes, with any drift honoring `prefers-reduced-motion`; the card is capability-gated on `loki`.

## Test checklist

- [ ] Unit/property: every `core/js` util (round-trips, lexer corpus incl. escaped quotes/newlines/unicode, curl flag matrix), jsonToJs corpus (identifier vs quoted keys, escapes, nesting), serializer corpus (cycles, BigInt, functions, deep nesting, huge strings)
- [ ] Component: transform refuse-leaves-buffer, dialog rendering, workspace survival across mode toggles, watchdog/Stop lifecycle (worker mocked)
- [ ] Manual (live-verify): real `while(true)` kill on the built server, 500 KB minify timing, iPhone/iPad bottom-sheet pass, settings rebind live
