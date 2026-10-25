# PLAN-40 — Load performance: compressed, cached, and only what the first page needs

## Goal

A Lighthouse run on the hub's home page (`bifrost.local:4646`, mobile preset) scored **40** for performance. Measured again without browser extensions, it scores **61–65**: first paint 5.5 s, largest paint 5.9 s, 796 KB transferred. Nearly all of that time is download, for three reasons:

- **The hub sends nothing compressed.** The 328 KB entry chunk (104 KB gzipped, 89 KB with Brotli) arrives as 328 KB.
- **Every page loads the Guide panel's Markdown stack.** That's marked, all of highlight.js and DOMPurify, about 223 KB raw, though the panel only opens on a click.
- **The home page loads `qrcode`** for the hub's "Join Bifrost" card.

This plan fixes those, and adds three more things:
- the hub caches hashed assets the way the standalone site already does;
- a build-time **bundle budget** keeps the heavy libraries out of the first load from now on;
- the two accessibility failures the same report found are fixed: accent-coloured text below 4.5:1 in two themes, and a skipped heading level.

Both client builds share the code-splitting fixes. The literal name is the name.

## Gate

PLAN-39 merged. Single PR.

**Merge condition:**
- `npm test` and the full `npm run test:e2e` (no behaviour changes, so every journey passes unchanged);
- the bundle budget passes on both builds;
- before and after Lighthouse numbers, measured as described under "Measuring", recorded in the PR.

## Verified against the codebase, not assumed

- **The report was taken with Chrome extensions running.** `bifrost.local_4646-20261026T012009.json` (Lighthouse 13.4.1, mobile, simulated slow 4G, 4× CPU) includes ~360 KB of injected extension scripts (an ad blocker, a cookie-banner detector), which are most of its 1,380 ms of main-thread blocking and every "unminified JavaScript" item. Two clean headless runs (Lighthouse 12, same preset, against the live hub) gave:
  - performance 61 and 65;
  - FCP 5.5 s; LCP 5.9 s;
  - TBT 220 ms and 40 ms;
  - 796 KB transferred.

  That clean baseline is what this plan measures against.
- **No compression on the hub.** Every asset's transfer size equals its resource size in the report. `web/src/host.ts` registers `@fastify/static` with `{ root }` only, and no compression plugin is installed. The standalone nginx already has `gzip on` (#100).
- **No long-lived caching on the hub.** `curl -I` on the live hub: `/assets/index-*.js` and `/` both answer `cache-control: public, max-age=0` with a weak ETag, so every visit revalidates ~15 files. The standalone nginx sends `public, max-age=31536000, immutable` for `/assets/`.
- **Spiked: `@fastify/static` 10.1.2's `preCompressed: true`** (scratch Fastify server, a `.br` and `.gz` beside each file). It serves:
  - `br` for `Accept-Encoding: br`;
  - `gzip` for `gzip`;
  - the plain file for `identity`;
  - with the right `content-type` and `Vary: Accept-Encoding` every time.

  This holds for a static route, **for `reply.sendFile()`**, and for the SPA fallback (`setNotFoundHandler` → `sendFile('index.html')`), which is what the hub and the web host's standalone mode both rely on.
- **Where the first-load weight comes from** (hub build, measured from its source maps):

  | Chunk | Raw | Gzip | What it holds |
  |---|---|---|---|
  | `index` (entry) | 328 KB | 104 KB | React DOM, React Router, `qrcode` (71 KB of source), relics, the Guide panel |
  | `common` | 148 KB | 50 KB | `highlight.js/lib/common` |
  | `markdown` | 47 KB | 15 KB | `marked`, `core/markdown` |
  | DOMPurify | 29 KB | ~10 KB | `dompurify` |

  `index.html` modulepreloads `common`, `markdown` and `purify` on every page.
- **Why the Markdown stack is on every page.** `App.tsx` imports `GuideButton`, which imports `GuidePanel`. That imports `renderMarkdown` from `core/markdown` (`render.ts`: `dompurify`, `highlight.js/lib/common`) and `core/ui/MarkdownPreview`. `GuideButton` already renders `GuidePanel` only when `open` is true, so a lazy import changes no behaviour. The guide *texts* are already one `import()` per guide (`core/guide/registry.ts`).
- **Why `qrcode` is in the entry.** `App.tsx` imports `MidgardPage` eagerly, which imports `JoinBifrostCard` → `QrCard` → `qrcode` (`QRCode.create`, drawn in an effect). The other three `QrCard` users (Heimdall sections, Portkey, the toolbox's `QrTool`) are already in lazy chunks. In the standalone build the card sits under `__HUB__ &&` and is dropped.
- **Offline mode warms pages, not the panel.** `app/offlineWarmLoad.ts` lists the page loaders (toolbox, runestone, groot, atlas, edda, variant, loki, saga, screensaver). Today the Guide panel is safe offline only because it is in the entry chunk.
- **Contrast.** `color.ts`'s `contrastWarnings` checks only `--text` on `--bg` and `--surface`, at the existing `MIN_TEXT_CONTRAST = 4.5`. Measured with the repo's own `contrastRatio` over resolved themes:
  - **Daybreak's `--accent` on `--bg` is 3.15:1**, and Daybreak is the first-visit theme for every light-preferring device;
  - **Tokyo's** is 5.23:1 on `--bg` but 4.15:1 on `--surface`, and 3.92:1 on the active nav item's `--accent-soft` tint, which is the failure the report found;
  - the other five themes pass.

  66 CSS rules use `color: var(--accent)` as a text colour (31 in `app.css`, 23 in `ui.css`, the rest in feature CSS).
- **Heading order.** `JoinBifrostCard` renders `<h3 class="join-card__title">` directly under the page's `<h1>`.
- **The CSS is mostly global.** `main.tsx` imports `app.css` (86 KB source) and `ui.css` (48 KB). Most of `app.css` is per-page (Runestone's tree, Variant, Edda's preview, Loki, Groot, the Accio shelf, Heimdall). It ships as one 96 KB file, 17 KB gzipped.

## Scope

**In:**
- Brotli and gzip files written beside every text asset at build time, for both builds, served by the web host with `preCompressed`.
- Immutable caching for `/assets/` on the hub, `no-cache` for the HTML.
- The Guide panel and the home page's Join card loaded lazily.
- A bundle budget that fails the build when a heavy library re-enters the first load.
- A derived `--accent-text` token that passes 4.5:1 in every theme, used for accent-coloured text.
- The Join card's heading level.
- `gzip_static` in the standalone nginx.
- `docs/performance.md`: how to measure page load properly.

**Out:**
- **HTTP/2 and HTTPS on the LAN hub.** Browsers speak HTTP/2 only over TLS, and `bifrost.local` cannot get a public certificate. The report's "modern HTTP" and "is on HTTPS" items stay, by design. The public standalone site gets both from the owner's VPS nginx, and the docs note `http2 on;` there.
- **SEO on the hub** (its `robots.txt` returns the app shell, and it has no meta description). The hub is deliberately unindexed (#100). A `Disallow: /` robots.txt would only trade the "robots.txt invalid" item for "page is blocked from indexing".
- **Splitting `app.css` per page.** It would save about 10 KB gzipped, but moving rules out of one ordered file risks cascade-order regressions across every page. Better as its own plan with screenshot checks, if the numbers after this plan say it's still worth it.
- **Smaller items:** lazy-loading the sky relics (22 KB of source, decorative), the report's 37 ms forced reflow, and font subsetting.

## Decisions & reasoning

### Precompress at build time, not compress per request

The web host could add `@fastify/compress` and compress every response on the fly. Instead the client build writes a `.br` (Brotli quality 11) and a `.gz` (gzip level 9) beside every text asset, and `@fastify/static` picks one with `preCompressed: true`:
- **No CPU per request, and smaller files.** The hub runs on the owner's Mac beside everything else, and maximum-quality Brotli is too slow to run on every request but costs nothing at build time.
- **No new dependency.** Node's `zlib` does both, the PLAN-25 precedent.
- **Spike-verified,** including the `sendFile` paths the hub's SPA fallback and the standalone mode use.

**What gets compressed:** `.js`, `.mjs`, `.css`, `.html`, `.svg`, `.json`, `.webmanifest`, `.txt`, `.xml` and `.wasm`, when larger than 1 KB and when compression saves at least 10%. Source maps are skipped: only devtools fetch them, and they are larger than everything else together.

**Where it runs:** a Vite plugin beside `seoBuild.ts` (`client/precompress.ts`), in `closeBundle` so it also covers `public/` and the SEO pages. That's both builds; the Docker web image builds the clients inside, so it gets the files too.

**The standalone site:** nginx-unprivileged has no Brotli module, so it gains `gzip_static on;` for the prebuilt `.gz`, and keeps on-the-fly `gzip` as the fallback.

⚠️ **The `.br` and `.gz` files are public alternates of the same asset** (`@fastify/static`'s own warning about `allowedPath`). Nothing in either build is meant to be private, so this changes nothing about what can be fetched.

### The hub caches hashed assets forever

The hub's web host now sends:
- `public, max-age=31536000, immutable` for `/assets/`, whose names change whenever their content does;
- `no-cache` for everything else, so the HTML, the manifest and the icons are always revalidated, and a new deploy shows up on the next load.

These are the standalone nginx's rules (PLAN-35). Repeat visits then skip ~15 revalidation round trips.

⚠️ A missing chunk must still be a 404, never `index.html` under a script's name. Today the SPA fallback would answer `/assets/gone.js` with the shell. The hub's fallback skips `/assets/`, as nginx's `location /assets/ { try_files $uri =404; }` already does, so a stale tab hits the app's own "reload to update" boundary (`core/chunkError.ts`) instead of a confusing MIME error.

### The Guide panel loads when the bulb is clicked

`GuideButton` imports `GuidePanel` with `lazy()`, using the project's own `withChunkTimeout`, and renders it in a `Suspense` whose fallback is nothing. The bulb itself, `guideForRoute` and the Escape handling stay in the entry. On the first click the panel arrives a moment later, over the LAN.

⚠️ **Offline mode.** `offlineWarmLoad.ts` gains the panel's loader. Otherwise, on a tab already open when the hub disappears, the bulb would open nothing on a page it worked on before. The plan also checks whether the six guide texts are in the warm list. They are separate `import()`s today, so they may already be a gap; if they are, it adds them, so the bulb works offline after this plan whether or not it did before.

### The Join card loads after the home page

`MidgardPage` imports `JoinBifrostCard` with `lazy()` (again with `withChunkTimeout`). The card sits under the portals, so it appearing a moment later moves nothing above it. It keeps a reserved height so layout shift stays at 0.

⚠️ **A local error boundary is required.** Midgard renders inside `RouteBoundary`, so a lazy card whose chunk fails to load (the hub just restarted, the tab is offline) would replace the whole home page with the route error. A small boundary around the card renders nothing on failure. The card needs the hub anyway, so there's nothing to offer without it.

`QrCard` itself is unchanged. Its other three users are already lazy, and moving the `qrcode` import inside `QrCard` would add a second offline gap, in the toolbox's QR tool.

### A bundle budget at build time, not Lighthouse in CI

Lighthouse is noisy on a shared runner: two clean runs a minute apart gave 220 ms and 40 ms of main-thread blocking. PLAN-34 already decided that throughput and timing measurements are on demand, never a CI gate. What can be checked exactly is what makes the numbers bad.

`client/bundleBudget.ts`, a Vite plugin for both builds, walks the entry chunk and its static imports, **transitively** (`chunk.imports`, followed down, which is exactly the set `index.html` modulepreloads), in `generateBundle`. It fails the build when:
- any of those chunks contains a module from `highlight.js`, `marked`, `dompurify`, `qrcode`, `mermaid`, `pdfjs-dist` or the CodeMirror packages;
- or their gzipped total plus the CSS exceeds a budget.

The budget is set **after** the code changes land: the measured total plus 10%, written into the plugin with the date and the figure it came from. A later change that legitimately needs more raises it in the same PR, so the cost is visible in review. It's the same pattern as `scripts/check-standalone.ts`: a build-time assertion with a message naming the culprit.

### `--accent-text`: accent colour you can read

The accent is used both as a fill and as a text colour, and only text needs 4.5:1. Changing `--accent` would recolour buttons, borders and the bridge in every theme. Instead:
- **A new optional token `--accent-text`.** `resolveTheme` derives it when a theme doesn't author it: the accent, darkened in light themes or lightened in dark themes, in small steps until it reaches 4.5:1 against the hardest of its three backgrounds (`--bg`, `--surface`, and `--accent-soft` composited over `--bg`). If the accent already passes, it's unchanged. Stepping towards white (dark themes) or black (light themes) always reaches 4.5:1 against a background of the opposite lightness, but it may drift far from the accent's hue on an unusual theme. So if the derived value would need more than a fixed number of steps, `resolveTheme` stops and leaves the accent, `themes.test.ts` fails, and that theme authors its own `--accent-text` instead. A theme is never silently given an unreadable or unrecognisable colour.
- **The 66 text uses switch** from `color: var(--accent)` to `color: var(--accent-text)`.
- **`contrastWarnings` checks the new token** against those three backgrounds, so `themes.test.ts` fails any future theme whose derived or authored value falls short.
- **THEME-SPEC.md and the theme schema** gain the optional token.

Five themes keep their exact look (their accent already passes). Daybreak's and Tokyo's accent *text* becomes slightly deeper or brighter, while their buttons and fills stay the same. That fits the 2026-07 house-theme bar ("calm, not glaring"), but it is a visible change, so the PR shows before/after screenshots of both, and the owner approves them before merge.

### The Join card's heading is an `h2`

`<h3 class="join-card__title">` becomes `<h2>`, with the same class, so the look is unchanged. It's the first section heading under the page's `<h1>`.

### Measuring: a clean browser, three runs, the median

`docs/performance.md` (PLAN-34's doc) gains a "Page load" section:
- run Lighthouse in a profile with no extensions (Incognito, or `npx lighthouse … --chrome-flags="--headless=new"`), since extensions inject scripts that land in the report as if they were Bifrost's;
- use the **mobile** preset;
- take the **median of three** runs;
- measure the hub's `/` and the standalone site's `/` and `/runestone`.

The before numbers in this plan were taken that way. The PR records the after numbers the same way.

## API contracts

None. No route is added, changed or removed, and `server/openapi.json` is unchanged. The web host changes only the headers and encodings of the static files it already serves.

## Task checklist

**Build**
- [ ] `client/precompress.ts`: a Vite plugin (`closeBundle`) writing `.br` (quality 11) and `.gz` (level 9) beside eligible text files over 1 KB that compress by at least 10%; no `.map`; registered for both builds in `vite.config.ts`; `client/tsconfig.json` include
- [ ] `client/bundleBudget.ts`: a Vite plugin (`generateBundle`) that walks the entry and its static imports transitively, fails on any forbidden package and on a gzip total over budget; both builds
- [ ] Check that `scripts/check-standalone.ts` and the Docker build context ignore `.br`/`.gz` correctly (the check scans by extension; confirm, don't assume)

**Web host**
- [ ] `web/src/host.ts` hub mode: `preCompressed: true`; `/assets/` immutable, everything else `no-cache`; the SPA fallback skips `/assets/` (404 for a missing chunk)
- [ ] Standalone mode (`registerStandalone`): `preCompressed: true` (its cache headers already mirror nginx)
- [ ] `web/src/host.test.ts`: the cases in the test checklist

**Standalone nginx**
- [ ] `docker/nginx-standalone.conf`: `gzip_static on;`; the e2e and web-host rule mirrors re-checked (server-level directive, no location change); `scripts/standalone-smoke.sh`'s existing gzip assertion keeps passing (it cannot tell `gzip_static` from on-the-fly gzip; the headers are identical, so a hand check of nginx's access to the `.gz` file confirms it once)

**Client**
- [ ] `core/guide/GuideButton.tsx`: `GuidePanel` through `lazy()` + `withChunkTimeout`, inside `Suspense` with no fallback
- [ ] `app/offlineWarmLoad.ts`: the Guide panel's loader; check the guide texts, and add them if they are not warmed
- [ ] `app/pages/MidgardPage.tsx`: `JoinBifrostCard` through `lazy()`, in `Suspense` with a reserved-height placeholder and a local error boundary that renders nothing
- [ ] `core/ui/JoinBifrostCard.tsx`: `<h3>` → `<h2>`, same class
- [ ] `core/theme/resolve.ts`: derive `--accent-text`; `core/theme/color.ts`: `contrastWarnings` checks it against `--bg`, `--surface` and `--accent-soft` over `--bg`; `core/theme/schema.ts` + `docs/THEME-SPEC.md`: the optional token
- [ ] The 66 `color: var(--accent)` text rules → `var(--accent-text)` (each one checked as text, not a fill, border or background)

**Measure, then set the budget**
- [ ] Lighthouse, clean profile, mobile, median of three: the hub's `/`, the standalone `/` and `/runestone`, before (this plan's numbers) and after
- [ ] Write the budget (the measured total plus 10%, with the date and figure in a comment)

**Docs**
- [ ] `docs/performance.md` "Page load" section; `docs/standalone.md`: `http2 on;` for the VPS nginx; `architecture.md` (precompressed assets, the budget, `--accent-text`), `tech-stack.md` (zlib at build time); `decisions.md`, `progress.md`; archive this file into `completed/` in the PR

## Acceptance criteria

1. **Compression.** The hub serves every eligible asset Brotli-compressed to a browser that accepts `br`, gzip to one that accepts only `gzip`, and the plain file otherwise, with `Vary: Accept-Encoding`. This holds for direct asset requests, the SPA fallback and the standalone mode.
2. **Caching.** On the hub, `/assets/*` is `public, max-age=31536000, immutable`, the HTML and other files are `no-cache`, and a missing `/assets/` file is a 404, never the app shell.
3. **Lean first load.** The first load of the hub's `/` contains no module from `highlight.js`, `marked`, `dompurify` or `qrcode`, and transfers at most 300 KB (from 796 KB).
4. **Lighthouse,** clean profile, mobile, median of three, hub `/`: first contentful paint ≤ 3.0 s. Performance ≥ 85 is a target, not a guarantee: if it's missed, the PR names the metric that holds it back and why.
5. **Guide.** It opens on every page that has one, online and on an already-open tab after the hub becomes unreachable (offline mode on).
6. **Join card.** It renders on the hub's home page; if its chunk can't load, the rest of the home page still renders.
7. **Contrast.** Every theme's `--accent-text` reaches 4.5:1 against `--bg`, `--surface` and `--accent-soft` over `--bg`, enforced by `themes.test.ts`. Lighthouse reports no colour-contrast failure on the home page in Tokyo or Daybreak.
8. **Heading order.** Lighthouse reports no heading-order failure on the hub's home page.
9. **Budget.** The build fails, naming the package and the chunk, when a forbidden package is added to the first load or the first load grows past the budget.
10. **Nothing else changes.** No behaviour change: `npm test` and the full `npm run test:e2e` pass unchanged.

## Test checklist

**Unit**
- [ ] `precompress`: eligible files get `.br` and `.gz` that decompress to the original; small, incompressible, `.map` and binary files get none
- [ ] `bundleBudget`: a fake bundle with `highlight.js` in a modulepreloaded chunk fails, naming both; the same module in a lazy chunk passes; over budget fails with the figures
- [ ] `resolveTheme`: a light and a dark theme whose accent fails get an `--accent-text` that passes and stays the same hue; one that passes keeps its accent
- [ ] `themes.test.ts`: every bundled theme passes the extended `contrastWarnings`; a fixture failing on `--accent-soft` alone is flagged; a fixture whose accent cannot be stepped within the limit fails and names the token to author
- [ ] `GuideButton.test.tsx`: the panel appears after a click (awaiting the lazy load); Escape and a route change still close it
- [ ] `MidgardPage.test.tsx`: the Join card appears; a rejected card import leaves the rest of the page rendered
- [ ] Offline warm-load: the registry includes the Guide panel (and the guide texts, if added)

**Integration (web host)**
- [ ] `host.test.ts`, hub mode: `br`/`gzip`/identity for an asset, the SPA fallback and `index.html`, each with `Vary`; immutable `/assets/`, `no-cache` HTML; `/assets/gone.js` → 404
- [ ] `host.test.ts`, standalone mode: `br` served through `sendFile` with the page's status (200, and 404 for `404.html`)

**End-to-end**
- [ ] The existing Guide, offline-mode, home and standalone journeys pass unchanged
- [ ] `standalone-smoke.sh`: its gzip assertion still passes with `gzip_static` on

**Live-verify / Manual**
- [ ] Lighthouse before and after (criteria 3, 4, 7, 8), recorded in the PR
- [ ] Owner: before/after screenshots of Daybreak and Tokyo's accent text approved
