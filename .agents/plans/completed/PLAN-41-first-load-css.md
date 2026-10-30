# PLAN-41 — First-load CSS: page styles with their pages, the shell's inline, relics after the first render

## Goal

The owner ran Lighthouse on the public standalone site after PLAN-40 was deployed (`bifrost.0xsiddhant.com-20261029T234207.json`, Lighthouse 13.4.1, mobile). It scored performance 91, accessibility 100, best practices 81 and SEO 100 (FCP 2.6 s, LCP 2.9 s, TBT 0 ms, CLS 0), with five red items the owner asked to fix: **uses deprecated APIs**, **reduce unused CSS**, **reduce unused JavaScript**, **network dependency tree** and **render-blocking requests**.

Measured, they have four causes, and only two of the five can turn green:

- **One stylesheet holds every page's styles.** The 100 KB stylesheet (17.7 KB gzipped) is 90% unused on `/`, because `app/app.css`, `core/ui/ui.css` and `features/toolbox/toolbox.css` hold the styles of every page, panel and tool, and it is the page's only render-blocking request. This plan moves each page's and panel's styles into a stylesheet that page or panel imports, so Vite loads it with that page's chunk. What remains is the shell's stylesheet, small enough to inline into every HTML file both builds ship. **Unused CSS and render-blocking turn green.**
- **The sky relics are drawn by the entry chunk.** All 115 relic drawings ship in the entry chunk (29.5 KB of it), but each page draws 10–14. They move to a chunk of their own, loaded after the first render. **Unused JavaScript shrinks but stays red:** what is left is React DOM and React Router's own code paths that a first render does not run, about 30 KiB compressed, above Lighthouse's 20 KiB per-script threshold.
- **The dependency tree fails by construction.** It flags any high-priority request the HTML starts that is not a preload, so the entry script alone keeps it red, and on the public site so does Cloudflare's analytics beacon. Inlining the stylesheet removes the three-request chain (HTML → stylesheet → fonts), leaving chains of two. **It stays red, with the chain shortened.**
- **All three deprecation warnings come from Cloudflare's bot-detection script**, injected into every page by Bot Fight Mode. A clean local run of the same build passes. **It's a switch in the Cloudflare dashboard, the owner's call;** the docs say exactly where it is.

None of the five audits counts towards the performance score: in Lighthouse 13 the score is the five metrics alone, and these audits carry weight 0 (deprecations carries 5 of Best Practices). This plan therefore fixes what each audit points at, and doesn't promise a score. FCP and LCP are set by the entry script's download and React's first render, and this plan trims the bytes ahead of that render rather than changing what gates it.

## Gate

PLAN-40 merged. Single PR, **with this plan in it**: the owner asked for the plan, two review passes and the implementation in one PR (2026-10-29).

## Verified against the codebase, not assumed

- **The owner's report** (Lighthouse 13.4.1, mobile, simulated throttling, Chrome 152, Cloudflare in front):
  - *Unused CSS:* `index-HLNM9JuU.css`, 15,936 of 17,652 bytes unused (90.3%), estimated FCP saving 300 ms.
  - *Unused JavaScript:* `index-BK8GacmW.js`, 48,517 of 103,686 bytes unused (46.8%).
  - *Render-blocking:* the same stylesheet, the only render-blocking request, estimated saving 450 ms.
  - *Network dependency tree:* the longest chain is HTML (107 ms) → stylesheet (165 ms) → Inter 500 (271 ms) and JetBrains Mono 400 (264 ms). Beside it are the entry script (182 ms) and Cloudflare's beacon → `/cdn-cgi/rum`. Space Grotesk 700 and Inter 400 are absent because PLAN-40 preloads them.
  - *Deprecations:* Shared Storage, `StorageType.persistent` and Protected Audience, all three at `/cdn-cgi/challenge-platform/scripts/jsd/main.js`.
  - The two half-scored items (cache lifetimes, legacy JavaScript) are Cloudflare's scripts too, as `docs/performance.md` already says.
  - Category weights in the same file: FCP 10, SI 10, LCP 25, TBT 30, CLS 25. The four performance audits above are weight 0; deprecations is weight 5 in Best Practices.
- **How each audit decides**, read from Lighthouse 13.5.0's source (`@paulirish/trace_engine` insights and `core/audits/byte-efficiency/`):
  - *Network dependency tree* fails when any chain has two or more requests. A request is in a chain when it is the document, or a non-preload request at High or VeryHigh priority (or render-blocking) with an initiator, and not an image, XHR or fetch. So any page whose HTML starts a non-preloaded module script fails.
  - *Render-blocking* fails when any request marked render-blocking finishes before first paint. Module scripts aren't render-blocking, so only a stylesheet `<link>` qualifies.
  - *Unused CSS* lists a stylesheet, inline `<style>` included, when its unused share times its compressed size passes **10 KiB**.
  - *Unused JavaScript* lists a script when its unused bytes pass **20 KiB**, measured per function (`Profiler.startPreciseCoverage({detailed: false})`).
- **Local baseline** (Lighthouse 13.5.0, mobile preset, headless, median of three, `docs/performance.md`'s protocol; served by the web host, Brotli, no Cloudflare):

  | Page | Performance (runs) | FCP | LCP | Transferred |
  |---|---|---|---|---|
  | Standalone `/` | **94** (86 / 95 / 94) | 2.1 s | 2.6 s | 217 KB |
  | Standalone `/runestone` | **78** (78 / 78 / 79) | 2.8 s | 4.4 s | 470 KB |
  | Hub `/` | **91** (90 / 92 / 91) | 2.2 s | 2.9 s | 226 KB |

  The same four performance items are red on all three pages, and **deprecations passes**: without Cloudflare there is no bot-detection script.
- **The stylesheet.**
  - It is the same file in both builds (`index-HLNM9JuU.css`, also the live site's hash): `main.tsx` imports `fonts.css`, `tokens.css`, `base.css`, `ui.css` and `app.css`, and the first load adds `toolbox.css` (`features/toolbox/index.ts` imports it), `notify.css` and `bridge-closed.css`.
  - Only Saga's and the screensaver's stylesheets are split off today. Brotli's, Nimbus's and Portkey's are their own files too, but those pages are hub-only.
  - Playwright's CSS coverage on the standalone `/` uses 9.8% of it (9,850 of 100,046 bytes).
- **What can move.** The rules were classified against the real module graph: the source files of the chunks each build's `index.html` loads, against every non-test file that names a class, with comments stripped. A rule is lazy-only when one of its classes is named only outside the first load.

  | File | First-load rules | Lazy-only rules |
  |---|---|---|
  | `app.css` | 8.8 KB | 57.9 KB |
  | `ui.css` | 10.5 KB | 20.9 KB |
  | `toolbox.css` | 0 | 7.9 KB |

  The figures are rule text, comments excluded (108.4 KB in all). Another 1.6 KB names classes no code mentions, and is left alone (see Scope).

  A lazy-only rule has an **anchor** when one of its classes is rendered by a single owner: one feature directory, one page, or one core component file. The anchored groups, largest first:

  | Owner | Lazy-only rules |
  |---|---|
  | Loki | 10.7 KB |
  | Variant | 8.6 KB |
  | the tool bodies | 7.9 KB |
  | Heimdall | 6.9 KB |
  | `core/ui/PlistTable.tsx` (Atlas's table) | 6.0 KB |
  | Accio | 5.2 KB |
  | the Pensieve page | 4.9 KB |
  | Edda | 4.3 KB |
  | `core/ui/TreeView.tsx` | 2.6 KB |
  | `core/guide/GuidePanel.tsx` | 2.5 KB |
  | previews | 2.2 KB |
  | `core/ui/Pager.tsx` | 1.4 KB |
  | Hermes | 1.2 KB |
  | Atlas | 1.1 KB |
  | Groot | 0.7 KB |
  | file transfer | 0.6 KB |
  | Wardens | 0.3 KB |
  | Runestone | 0.3 KB |

  Together that's about 68 KB. Besides those:
  - **The rendered Markdown surface** (`.md-preview`, `app.css` 2650–2776, with its highlight.js colours): about 2.3 KB. Two renderers share it, `core/ui/MarkdownPreview.tsx` and Saga's `SlideView.tsx`, and both are lazy since PLAN-40.
  - **Lazy-only, with no single owner:** about 17 KB.
    - rules several features share: about 12 KB;
    - nine small components, at 5.2 KB together: Toast, JSON editor, panel controls, code-copy buttons, QR card, file rows, the Join card, progress bar and load-more.

  One rule mixes the two kinds in its selector list: `.tool-output, .tool-panel__body { container-type: inline-size }` in `toolbox.css`. `.tool-panel__body` is rendered by the first-load `ExpandingGrid`.
- **A lazy chunk's stylesheet can't flash unstyled.** Vite's preload helper, read in the built entry chunk:
  - it appends the chunk's stylesheet to `<head>` as a `<link>`;
  - it resolves the dynamic import only on that link's `load`, or rejects with `Unable to preload CSS for …`, which `core/chunkError.ts` already counts as a chunk failure;
  - it skips a sheet that is already linked.

  So a `React.lazy` page renders only once its styles are in, and that covers the concern behind `features/toolbox/index.ts`'s comment ("Eager on purpose: … no unstyled flash inside the panel", PLAN-18). Saga's page already loads this way.
- **The cascade moves with the files.** A rule moved out of `app.css` comes after every global rule, and lazy stylesheets come in the order their pages were opened, not in `app.css`'s order. `app.css` keeps a mixed `/* ── responsive ── */` block (line 1844), whose media rules for several features come after those features' own sections; each must move with its feature, in order. A rule that is moved and still competes with a global rule of equal specificity changes winner. That is PLAN-40's reason for leaving the split out ("~10 KB gzipped for cascade-order risk across every page", decisions.md 2026-10-26), so this plan proves no change by comparing computed styles (see "Page styles live with their page").
- **Spiked: inlining alone moves the audits, not the metrics.** The stylesheet was inlined into the built standalone `index.html` with no other change, and Lighthouse 13.5.0 run three times:
  - render-blocking passed, and the longest chain went from 325 ms to 76 ms;
  - FCP and LCP stayed at 2.1 s and 2.6 s;
  - unused CSS was still flagged (14 KiB), now on the inline sheet, and the HTML grew to 17.6 KB Brotli.

  FCP waits on the entry script, because React renders the whole page, so the stylesheet was never what held it. Inlining is worth it only once the split has made the stylesheet small.
- **The entry chunk.** It is 331 KB raw and 105 KB gzipped. Function-level coverage on the standalone `/` (Lighthouse's own granularity) finds 46.3% of it unused, against Lighthouse's 46.8%:
  - `react-dom`: 81 KB raw unused;
  - `react-router`: 18 KB;
  - the relic drawings: 26.4 KB of their 29.5 KB (`halloween.tsx` alone 11.9 KB; 115 drawings in five collections);
  - everything else: under 4 KB per module.

  The drawings enter through `assets/relics/index.ts`, which three modules import:
  - `core/relicPrefs.ts`, which needs only `ALL_COLLECTIONS`;
  - `core/ui/SkyRelics.tsx`, rendered by `App.tsx` on every page;
  - Heimdall's Sky relics section (`features/heimdall/sections.tsx`), which reads each collection's label and `relics.length` and is already lazy.
- **The fonts.** The home page renders with four fonts (`document.fonts` after load):
  - Space Grotesk 700 and Inter 400, preloaded since PLAN-40;
  - Inter 500 and JetBrains Mono 400.

  The last two are requested only once React has rendered (244 ms in the owner's run, after the stylesheet ended at 165 ms), so they hang off the stylesheet in the tree because it names them, not because they wait for it.
- **A boot-time `import()` forms no chain.** The hub's home page already imports the lazy Join card (and its `QrCard` chunk) at boot, both at High priority. In all three hub baseline runs neither appears in the dependency tree, whose chains are HTML → stylesheet → fonts, HTML → entry script and HTML → manifest. So a lazily loaded relic chunk doesn't lengthen it.
- **The HTML pipeline.** The relevant hooks run in this order:
  1. `fontPreloadPlugin` adds its links in `transformIndexHtml` (`order: 'post'`), inside Vite's `vite:build-html` `generateBundle`;
  2. `seoPlugin` (`enforce: 'post'`, standalone only) builds every prerendered page and `404.html` from that `index.html`, in its own `generateBundle`;
  3. `bundleBudgetPlugin` (`enforce: 'post'`, after it in `vite.config.ts`) counts the entry's CSS from `viteMetadata.importedCss` and the bundle;
  4. `precompressPlugin` walks the output directory in `closeBundle`.

  Vite injects the entry stylesheet as `<link rel="stylesheet" crossorigin href="/assets/index-….css">` after the modulepreload links; the font preloads follow it. Asset URLs inside the stylesheet are absolute (`/assets/…`), because `base` is `/`.
- **Tests that see the stylesheet.**
  - `e2e/api/transport.e2e.ts` ("serves a built asset with its content type") takes the CSS path from a `<link …>` in the hub's `index.html`.
  - `themes.test.ts` scans every `.css` under `client/src` recursively for `color: var(--accent)`, so new files are covered.
  - `e2e/browser/shell.spec.ts` waits for `.relic` to attach before reading animations.
  - `scripts/standalone-smoke.sh` (CI's image job) takes a `.js` asset from the page for its gzip check, not a stylesheet, so it needs no change.
- **Offline mode** warms page chunks through their `import()`, which goes through the same preload helper, so a warmed page's stylesheet is linked and cached when it is warmed (`app/offlineWarmLoad.ts`).

## Scope

**In:**
- Each lazily loaded page's and panel's own styles moved out of the global sheets into a stylesheet that page or panel imports:
  - the features: Loki, Variant, the tool bodies, Heimdall, Accio, Edda, Hermes, Atlas, Groot, Runestone, file transfer, Wardens, previews;
  - the Pensieve page;
  - the Guide panel;
  - the four lazily rendered core pieces big enough to matter: Atlas's plist table, the tree view, the Markdown surface and the Pensieve pager.
- The remaining (shell) stylesheet inlined into every HTML file both builds ship, and the file itself no longer emitted.
- The sky relics' drawings in their own chunk, loaded after the first render.
- A first-load CSS budget.
- Docs:
  - `docs/performance.md`: how to read these five audits for this app, and this plan's numbers;
  - `docs/standalone.md`: Bot Fight Mode on Cloudflare's Free plan;
  - the coding rule for where styles go;
  - `architecture.md` and `project-structure.md`.

**Out:**
- **Cloudflare's settings.** Bot Fight Mode (the deprecations) and Web Analytics (the beacon) are the owner's switches.
- **Preloading Inter 500 and JetBrains Mono 400.** They would be 45 KB more ahead of the entry script, which FCP waits for, and they swap in with `font-display: swap` at no layout shift (CLS 0 in the owner's report). PLAN-40 preloaded only two for that bandwidth reason, which stands. Its other reason, that the rest "are not in the first paint", holds for the prerendered summary but not for React's first render, which uses both (measured above). `fontPreload.ts`'s comment is corrected to say so.
- **Preloading the entry script, or anything else, only to satisfy the dependency tree.** The script is in `<head>` already, so a preload would change the report and nothing else.
- **A separate vendor chunk for React.** It would let returning visitors keep React across deploys, but it removes no unused bytes: the audit would list the vendor chunk instead. That's a caching question for its own plan.
- **Replacing React** (e.g. Preact), the only way under the unused-JavaScript threshold.
- **Prerendering the app's first screen.** That's what would move FCP a lot. It undoes #105's decision to show the prerendered summary only without JavaScript, so it would be a plan of its own.
- **Lazy-only rules with no single owner** (about 17 KB, listed above) stay global. They'd need a shared stylesheet or one per small component, for about 3 KB gzipped together, and the estimate says the split clears the threshold without them. "Page styles live with their page" says what happens if it doesn't.
- **Rules naming classes no code mentions** (1.6 KB, e.g. `.hub-soon-note`, `.state-switch`). Some are built at runtime (`sse-${status}`), so telling dead from dynamic is its own clean-up.
- **`/runestone`'s unused JavaScript** (153 KiB in its editor chunk). CodeMirror is that page's content.

## Decisions & reasoning

### Page styles live with their page

A rule leaves the global sheets when it is lazy-only and anchored on its owner: a class that only one lazily loaded page, panel or component renders. It moves into a stylesheet beside that code, imported by it, and Vite then emits it with that code's chunk and loads it before the code runs.

The Markdown surface is the one shared stylesheet. Its anchor, `.md-preview`, has two lazy renderers, and both import it, so Vite gives it a chunk of its own that either brings in. Each destination:

| Stylesheet | Imported by | From |
|---|---|---|
| `features/<name>/<name>.css`, for `loki`, `variant`, `heimdall`, `accio`, `edda`, `hermes`, `atlas`, `groot`, `runestone`, `file-transfer`, `wardens`, `previews` | each lazy entry module of that feature: the pages `lazyPages.tsx` loads, `HeimdallModal.tsx`, the two preview modals | `app.css`, and `ui.css` for previews, file transfer and Edda |
| `features/toolbox/toolbox.css` (the file stays) | `ToolBody.tsx`, instead of `index.ts` | (unchanged) |
| `app/pages/pensieve.css` | `PensievePage.tsx` | `app.css` |
| `core/guide/guide-panel.css` | `GuidePanel.tsx` | `ui.css` |
| `core/ui/plist-table.css` | `PlistTable.tsx` | `ui.css` |
| `core/ui/tree-view.css` | `TreeView.tsx` | `app.css` |
| `core/ui/pager.css` | `Pager.tsx` | `ui.css` |
| `core/ui/markdown-preview.css` | `MarkdownPreview.tsx` and Saga's `SlideView.tsx`, which render `.md-preview` | `app.css` (the surface and its highlight.js colours) |

Kebab-case file names, like `bridge-closed.css`.

**What moves is decided by the classification, not by section headings.** The check that produced the tables above is re-run on each section before it moves. A section's rules move together and in source order, with their comments, including that section's rules in `app.css`'s mixed responsive block and any of its rules elsewhere in the file. Within a section:
- a rule the classification marks first-load or shared stays;
- a rule whose selector list mixes the two is split, its first-load selectors staying global.

The one such rule today is `.tool-output, .tool-panel__body`: its `.tool-panel__body { container-type: inline-size }` joins `ui.css`'s other `.tool-panel__body` rules (ExpandingGrid's), so an open card's panel keeps it while the tool chunk is still loading.

**If the median Lighthouse run still lists the stylesheet** after these moves, the nine small components get stylesheets beside them next, then the shared rules go into a stylesheet the sharing pages import, until it isn't listed. The estimate says it won't come to that: about 44 KB of minified shell CSS, about 10 KB of it used on `/`, is about 6 KiB unused compressed, against the 10 KiB threshold.

**What stays global:**
- the shell, meaning what every page's first render shows: tokens, base, fonts, the sky and bridge, header, nav, footer, the hubs and their cards, notifications, the offline toggle, the theme switcher, error screens;
- the shared controls (`.btn`, fields, modals);
- the rules several features share;
- the small shared components named in Scope.

**`toolbox.css`'s import moves to the lazy `ToolBody.tsx`,** less the `.tool-panel__body` selector above. Its comment (PLAN-18) kept the panel styles eager to avoid an unstyled flash; Vite's helper now waits for the stylesheet before the chunk resolves, so opening a tool costs the chunk and its stylesheet, fetched together, and still never shows unstyled. The comment is rewritten to say so.

⚠️ **Cascade order is the risk PLAN-40 named.**
- Moved rules now come after every global rule, where before they sat between them.
- Two pages' stylesheets come in whatever order the visitor opened them, or in warm-load order when offline mode warms them all.

Three things keep that safe:
1. **Rules only move whole, in order, anchored on their own markup.** A moved rule names a class only its importers render, so it can only match once that code has rendered, and by then its stylesheet is in. It can't match the shell or another page, which is what makes the order of two pages' sheets irrelevant.
2. **A one-off computed-style comparison of the old and new builds before merge.** Every element's computed style is compared, the sky's random relics excepted:
   - on every route of both builds;
   - at 412 and 1280 px wide, in a dark and a light theme (themes change token values, not which rules match, so one of each covers the cascade);
   - in the states that render moved styles: Heimdall with every section opened, the Guide panel, every toolbox tool open, Variant's results, Loki's output and regex mode, Edda's split and preview, Atlas's table, Groot's and Runestone's trees, the Pensieve with documents and its pager, Accio with items.

   Any difference is fixed before merge; none is expected. The comparison is a migration check, not a test: it diffs two builds, so it lives in the PR as its result and is not committed.
3. **The full e2e net**, which renders every page on two devices.

A permanent "each stylesheet only selects its own markup" test was considered and dropped. It would have to decide ownership by finding class names in source, and that is noisy here: `saga`, `notify` and `nott` are also route and module names, and BEM modifiers are often built at runtime (`tool-badge--${state}`). A test that needs an allowlist on day one would be ignored, not trusted. The guard going forward is the first-load CSS budget (below) plus the coding rule.

### The shell's stylesheet is inlined

Once the split leaves only the shell's styles in the entry stylesheet, a new Vite plugin, `client/inlineCss.ts` (both builds), replaces its `<link rel="stylesheet">` with a `<style>` holding the same CSS:
- **No render-blocking request is left.** The stylesheet was the only one.
- **The dependency tree loses the stylesheet link.** Fonts named in an inline `<style>` no longer hang off a stylesheet; in the spike they left the tree altogether.
- **One round trip less** before the first render can be styled.

**Where:** `transformIndexHtml` with `order: 'post'`, from the CSS asset in `context.bundle`, the hook and bundle `fontPreload.ts` already uses. Because `seoPlugin` builds every prerendered page and `404.html` from `index.html` afterwards, they all carry it (PLAN-40's font-preload precedent).

**Placement:** the `<style>` goes last in `<head>`, after the module script, the modulepreloads and the font preloads, so the browser's preload scanner meets every URL before the CSS bytes. A lazy page's stylesheet is appended to `<head>` later, so global rules still come first, as they did with the `<link>`. Cascade order is unchanged by the inlining itself.

**The file is dropped from the build.** In `generateBundle`, after `bundleBudgetPlugin` has counted it (the plugin is listed after the budget in `vite.config.ts`, both `enforce: 'post'`), the plugin:
1. fails the build if any other emitted file names the CSS file;
2. deletes it from the bundle.

A lazy chunk that linked the global sheet again would re-apply it after the page sheets and change their cascade, so that must be loud, and a file nothing loads shouldn't ship.

⚠️ **Guards, each a build failure naming the file:**
- `index.html` links a stylesheet that isn't in the bundle;
- the CSS contains `</style` (it would end the element early);
- `base` isn't absolute: the stylesheet's `url()`s are written relative to `/assets/`, and inline in a page they would resolve against the page.

**The dev server is untouched** (`apply: 'build'`; Vite injects CSS from JavaScript in dev).

**The trade, stated:** the shell's CSS is now part of the HTML, which both builds send with `no-cache`.
- *A repeat visit* revalidates the HTML and gets a `304` when it is unchanged (nginx and `@fastify/static` both send `ETag` and `Last-Modified`; the task list checks the web host, and nginx where one can be run). If either answers `200` with the body instead, the PR says so: a repeat visit then costs the HTML, about 8 KB, where it cost about 4 KB before.
- *After a deploy*, the HTML and its styles (about 8 KB gzipped) download again. Before, the stylesheet was cached, unless its content had changed.
- *Every HTML file carries a copy.* The standalone build's prerendered pages carry the same copy, which costs disk only; a visitor loads one of them.

**Both builds,** so the hub's e2e net runs the same HTML shape the public site serves, the PLAN-40 precedent for shared fixes.

**For the future security-headers plan:** a CSP's `style-src` will need this element's hash or `'unsafe-inline'`. It needs one already, for `seoBuild.ts`'s first-paint `<style>` and CodeMirror's injected styles.

### The sky relics load after the first render

The relic drawings move to a chunk of their own:
- **`assets/relics/collections.ts`** holds the `RelicCollection` type and `ALL_COLLECTIONS`, which `core/relicPrefs.ts` imports instead of `index.ts`.
- **`assets/relics/index.ts`** keeps `RELIC_COLLECTIONS` (labels and drawings) and re-exports the two, so Heimdall's section (lazy) is unchanged.
- **A test holds the name list and the drawings' keys equal,** so they can't drift.

`App.tsx` renders `SkyRelics` through `lazy()` with `withChunkTimeout`, inside `Suspense` (no fallback) and `ChunkBoundary`, whose failure handler logs a `warn`. A relic chunk that can't be fetched leaves an empty sky, and the shell carries on. This is the coding rule PLAN-40 set for heavy shell pieces, applied to decoration.

**Not warmed for offline mode.** The chunk loads on every page's first render, long before anyone can arm offline mode, so `SHELL_WARM_LOADERS` doesn't need it.

**The relic styles stay global.** The sky is shell, on every page; moving 1 KB of CSS into the relic chunk would only add a request at boot.

**The relics appear a moment after the first paint.** They're decorative, absolutely positioned inside `.sky`, and already re-seeded on every route change, so nothing shifts (CLS stays 0), and the shell journey already waits for `.relic`.

### A first-load CSS budget

`bundleBudget.ts` gains `FIRST_LOAD_CSS_BUDGET_BYTES`: the gzipped CSS of the first load, in either build, may not pass it.
- **Set after the split**, to the measured figure plus 10%, with the date and the figure in its comment, as PLAN-40 set the total.
- **Its failure message** says to put a page's own styles in that page's stylesheet, and to raise the figure in the same change if shell styles really grew.
- **The total budget (133 KB) is unchanged**, and the build prints both figures.

That is the guard against the split eroding, one page section added back to `app.css` at a time. The total alone has 12 KB of slack, about the size of everything this plan moves.

### What stays red, and why

- **Network dependency tree.** After this plan every chain is two requests long: HTML → entry script, HTML → manifest, and, on the public site while Web Analytics is on, HTML → Cloudflare's beacon. It can only pass with no non-preloaded critical request at all, which would mean preloading the script already in `<head>`. That changes the report, not the load, so it's out. `docs/performance.md` says to read its longest chain instead, and that should no longer pass through a stylesheet.
- **Unused JavaScript.** The floor is React DOM and React Router (99 KB raw unused, about 30 KiB compressed, past the 20 KiB threshold): code paths a first render doesn't run, such as hydration, other event types and data routers. The entry's unused share drops by the relics' 26 KB raw; what's left is named in the PR.
- **Deprecations.** On Cloudflare's Free plan, JavaScript Detections can't be turned off while Bot Fight Mode is on: Bot Fight Mode itself has to go off. In the dashboard that's Security → Settings, filtered by *Bot traffic*. Paid plans have a separate toggle under Super Bot Fight Mode. (Cloudflare's docs, read through a web search because this container cannot reach `developers.cloudflare.com`: the owner checks the labels.) Turning it off gives up Cloudflare's bot challenge on the site; the docs put the trade, and the decision stays the owner's.

### Measuring

As `docs/performance.md` prescribes, with this plan's numbers added to it: Lighthouse 13.5.0, mobile preset, headless, median of three, on the standalone `/` and `/runestone` and the hub's `/`. The before figures are the baseline above, taken with the same version. The owner re-runs the public site once deployed, noting whether Bot Fight Mode and Web Analytics were on; this container can't reach it.

## API contracts

None. No route is added, changed or removed, `server/openapi.json` is unchanged, and the web host serves the same files except that the hub's and the standalone build's global stylesheet no longer exists as a file.

## Task checklist

**Build**
- [ ] `client/inlineCss.ts`: a Vite plugin (`apply: 'build'`):
  - in `transformIndexHtml` (`order: 'post'`), replaces each `<link rel="stylesheet">` `index.html` carries with a `<style>` last in `<head>`;
  - in `generateBundle` (`enforce: 'post'`, listed after `bundleBudgetPlugin`), fails if another emitted file names an inlined CSS file, then deletes it;
  - fails on a missing asset, a `</style` in the CSS, or a non-absolute `base`.

  Registered for both builds in `vite.config.ts`, and in `client/tsconfig.json`'s include.
- [ ] `client/bundleBudget.ts`: `FIRST_LOAD_CSS_BUDGET_BYTES` checked beside the total; the info line prints both. The figure is set after the split (measured plus 10%, dated).
- [ ] `client/fontPreload.ts`: the comment's reason corrected (Inter 500 and JetBrains Mono are in React's first render, requested after it; the bandwidth reason is why they aren't preloaded)

**Stylesheets** (each a move, rules in source order with their comments, re-classified before moving)
- [ ] Features: `loki`, `variant`, `heimdall`, `accio`, `edda`, `hermes`, `atlas`, `groot`, `runestone`, `file-transfer`, `wardens`, `previews`, each into `features/<name>/<name>.css`, imported by its lazy entry module(s)
- [ ] `features/toolbox/index.ts` → `ToolBody.tsx` imports `toolbox.css`; the comment rewritten; `.tool-panel__body { container-type: inline-size }` split off into `ui.css` beside ExpandingGrid's `.tool-panel__body` rules
- [ ] `app/pages/pensieve.css` (`PensievePage.tsx`), `core/guide/guide-panel.css` (`GuidePanel.tsx`), `core/ui/plist-table.css` (`PlistTable.tsx`), `core/ui/tree-view.css` (`TreeView.tsx`), `core/ui/pager.css` (`Pager.tsx`), `core/ui/markdown-preview.css` (`MarkdownPreview.tsx` and Saga's `SlideView.tsx`)
- [ ] The classification re-run on the result: no single-owner lazy-only rule left in the global sheets beyond the listed shared and small ones

**Relics**
- [ ] `assets/relics/collections.ts` (`RelicCollection`, `ALL_COLLECTIONS`); `index.ts` re-exports them; `core/relicPrefs.ts` imports from `collections.ts`
- [ ] `App.tsx`: `SkyRelics` through `lazy()` + `withChunkTimeout`, in `Suspense` and `ChunkBoundary` (failure: one `warn`)

**Tests that read the old shape**
- [ ] `e2e/api/transport.e2e.ts`: the CSS asset taken from `client/dist/assets/`, not from a `<link>` in `index.html`

**Measure, then set the budget**
- [ ] The computed-style comparison (old build vs new; routes, widths, themes and states as above), result in the PR
- [ ] Lighthouse after, same protocol as the baseline; the first-load CSS budget written from the measured figure
- [ ] `304` on a repeat request for `/` with `If-None-Match` from the web host (hub and standalone mode), and from nginx with `docker/nginx-standalone.conf` if one can run here

**Docs**
- [ ] `docs/performance.md`:
  - a "Reading the audits" part: the five items, what each means for this app, which stay red and why;
  - PLAN-41's numbers;
  - the first-load CSS budget beside the total.
- [ ] `docs/standalone.md`: Behind Cloudflare. Bot Fight Mode's location and the Free plan's all-or-nothing, and that the shell's CSS is now in the HTML (the `no-cache` pages carry it).
- [ ] `.agents/rules/coding.md` (Frontend): where styles go, and the CSS budget
- [ ] `.claude/skills/verify/SKILL.md`: what the client build now fails on (the CSS budget, the inline-CSS guards)
- [ ] `architecture.md` and `project-structure.md`: the stylesheet layout, `inlineCss.ts`, `collections.ts`
- [ ] `decisions.md`, `progress.md`; this file archived to `completed/` in the PR

## Acceptance criteria

1. **Unused CSS.** Lighthouse (median run, the protocol above) lists no stylesheet on the standalone `/` or the hub's `/`.
2. **Render-blocking.** Lighthouse lists no render-blocking request on the standalone `/` and `/runestone` or the hub's `/`.
3. **Inline shell styles.** Every HTML file both builds ship (the hub's `index.html`, each prerendered page, `404.html`):
   - has exactly one `<style>` holding the shell's CSS, last in `<head>`, besides the standalone first-paint style;
   - has no `<link rel="stylesheet">`.

   The global CSS file is not emitted. The build fails if anything names it, on `</style` in it, or on a relative `base`.
4. **No visual change.** The computed-style comparison finds no difference on any route of either build, at either width, in either theme, or in any listed state. If one is intended, the PR names it and the owner approves it.
5. **Page styles arrive with their page.** Each page and panel whose styles moved is styled on its first render, with no unstyled frame. A page warmed by offline mode still opens styled with the hub unreachable (the offline journey).
6. **Relics.**
   - No relic drawing is in either build's first load.
   - The sky still shows 10–14 relics on a page.
   - Heimdall's Sky relics section shows every collection's name and count.
   - If the relic chunk can't load, the shell stays up with an empty sky and one `warn`.
7. **Budget.** The build fails, naming the figure, when the first load's CSS passes `FIRST_LOAD_CSS_BUDGET_BYTES`. Every build prints it beside the total.
8. **Dependency tree.** On the standalone `/` and the hub's `/`, no chain passes through a stylesheet, and every chain is two requests long. The PR gives the longest chain's latency before and after.
9. **Unused JavaScript.** The entry's unused bytes fall by at least the relic drawings' share, and the PR attributes what is left by module.
10. **Metrics.** FCP and LCP on each measured page are no worse than the baseline's median, read at Lighthouse's 0.1 s step, and CLS stays 0. If one is worse, the PR names the cause.
11. **Nothing else changes.** `npm test` and the full `npm run test:e2e` pass.
12. **Docs.** `docs/performance.md` explains the five audits, and `docs/standalone.md` names the Bot Fight Mode switch and its Free-plan behaviour.

## Test checklist

**Unit**
- [ ] `inlineCss`:
  - the link becomes a `<style>` last in `<head>`;
  - a missing asset, `</style` in the CSS, and a relative `base` each fail, naming the file;
  - a chunk that names the CSS file fails the build;
  - the asset is removed from the bundle.
- [ ] `bundleBudget`: first-load CSS over its figure fails with the figures; under it passes; the total is still checked
- [ ] Relics: `ALL_COLLECTIONS` equals `RELIC_COLLECTIONS`' keys; `relicPrefs` tests unchanged
- [ ] `App` (or a `SkyRelics` boundary test): a rejected relic import leaves the shell rendered and logs once

**End-to-end**
- [ ] The standalone journey: every HTML file the build ships has the inline shell style and no stylesheet link (beside PLAN-40's font-preload check)
- [ ] `transport.e2e.ts`: a built `.css` asset still served as `text/css`
- [ ] The existing journeys pass unchanged, the offline and shell journeys included

**Live-verify**
- [ ] The computed-style comparison (criterion 4)
- [ ] Each moved page opened with its stylesheet throttled: no unstyled frame (criterion 5)
- [ ] Lighthouse before and after, one version (criteria 1, 2, 8–10)
- [ ] `304` revalidation of `/`

**Manual (owner)**
- [ ] The public site's Lighthouse once deployed, with the Cloudflare settings it ran under
- [ ] Bot Fight Mode: keep it on, or turn it off to clear the deprecations
