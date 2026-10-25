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

A second report, of the public standalone site at `bifrost.0xsiddhant.com`, scored better (performance 82, accessibility and SEO 100) and adds three things:
- web fonts that shift the layout when they arrive;
- gzip passing through Cloudflare unchanged, so the origin's compression level is what visitors get;
- Cloudflare's own injected scripts, which cause every Best Practices failure it reported.

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
- **The public site's report** (`bifrost.0xsiddhant.com-20261026T013523.json`, Lighthouse 13.4.1, mobile, with the same browser extensions running):
  - performance 82, accessibility 100, best practices 81, SEO 100;
  - FCP 3.1 s, LCP 3.9 s, TBT 20 ms, **CLS 0.017**.

  What it found, sorted by owner:
  - **Bifrost's:**
    - the layout shift: Lighthouse attributes all of it to `space-grotesk-v22-latin-700` and `inter-v20-latin-regular`, which the browser only finds after the CSS (requested at 210 ms, after the CSS ends at 178 ms);
    - render-blocking CSS (300 ms);
    - the entry and `markdown` chunks, where the standalone build's `markdown` chunk is 196 KB raw because highlight.js is folded into it.
  - **Cloudflare's** (the site is proxied: every request is HTTP/3, `server: cloudflare`):
    - the legacy-JavaScript item and both cache-insight items are its Web Analytics beacon (`static.cloudflareinsights.com`) and its bot-detection script (`/cdn-cgi/challenge-platform/…/jsd/main.js`, injected into every page);
    - **all three deprecation warnings** (Shared Storage, `StorageType.persistent`, Protected Audience) come from that bot-detection script, and are the whole Best Practices deduction.
  - **The extensions':** every "unminified JavaScript" item.
- **Cloudflare passes the origin's gzip through.** On the live site, `curl` with `Accept-Encoding: br, gzip` gets the entry chunk as `content-encoding: gzip`, 123 KB, which is nginx's default level 1. A level-9 file is 104 KB, and Brotli would be 89 KB. Cloudflare keeps the origin's caching: `/assets/` comes back `public, max-age=31536000, immutable` with `cf-cache-status: HIT` on a repeat, and `/` comes back `no-cache`, `DYNAMIC`. The HTML arrives Brotli because Cloudflare compresses it itself.
- **The fonts** (`core/fonts.css`): Space Grotesk 500 and 700, Inter 400, 500 and 700, and JetBrains Mono 400 and 700, all `font-display: swap`, all discovered through the stylesheet. None is preloaded.
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
- `gzip_static` in the standalone nginx, which is also what Cloudflare passes on to visitors.
- A preload for the two fonts the first paint uses, in both builds.
- `docs/standalone.md`: running behind Cloudflare (what passes through, and which of its features cost what).
- `docs/performance.md`: how to measure page load properly.

**Out:**
- **HTTP/2 and HTTPS on the LAN hub.** Browsers speak HTTP/2 only over TLS, and `bifrost.local` cannot get a public certificate. The report's "modern HTTP" and "is on HTTPS" items stay, by design. The public standalone site gets both from the owner's VPS nginx, and the docs note `http2 on;` there.
- **SEO on the hub** (its `robots.txt` returns the app shell, and it has no meta description). The hub is deliberately unindexed (#100). A `Disallow: /` robots.txt would only trade the "robots.txt invalid" item for "page is blocked from indexing".
- **Splitting `app.css` per page.** It would save about 10 KB gzipped, but moving rules out of one ordered file risks cascade-order regressions across every page. Better as its own plan with screenshot checks, if the numbers after this plan say it's still worth it.
- **Cloudflare's injected scripts** (Web Analytics, bot detection) and the audits they fail. They are switches in the Cloudflare dashboard, not code, and keeping them is the owner's call. The docs say what each costs.
- **Brotli at the public site's edge.** nginx-unprivileged has no Brotli module, and Cloudflare re-compresses only an uncompressed origin response. So it would mean either a custom nginx build or giving up compression whenever the site runs without Cloudflare.
- **Smaller items:** lazy-loading the sky relics (22 KB of source, decorative), the report's 37 ms forced reflow, and font subsetting.

## Decisions & reasoning

### Precompress at build time, not compress per request

The web host could add `@fastify/compress` and compress every response on the fly. Instead the client build writes a `.br` (Brotli quality 11) and a `.gz` (gzip level 9) beside every text asset, and `@fastify/static` picks one with `preCompressed: true`:
- **No CPU per request, and smaller files.** The hub runs on the owner's Mac beside everything else, and maximum-quality Brotli is too slow to run on every request but costs nothing at build time.
- **No new dependency.** Node's `zlib` does both, the PLAN-25 precedent.
- **Spike-verified,** including the `sendFile` paths the hub's SPA fallback and the standalone mode use.

**What gets compressed:** `.js`, `.mjs`, `.css`, `.html`, `.svg`, `.json`, `.webmanifest`, `.txt`, `.xml` and `.wasm`, when larger than 1 KB and when compression saves at least 10%. Source maps are skipped: only devtools fetch them, and they are larger than everything else together.

**Where it runs:** a Vite plugin beside `seoBuild.ts` (`client/precompress.ts`), in `closeBundle` so it also covers `public/` and the SEO pages. That's both builds; the Docker web image builds the clients inside, so it gets the files too.

**The standalone site:** nginx-unprivileged has no Brotli module, so it gains `gzip_static on;` for the prebuilt `.gz`, and keeps on-the-fly `gzip` as the fallback. Behind Cloudflare this matters more than it looks: Cloudflare passes the origin's gzip straight to visitors, so a level-9 file is what they download (the entry: 104 KB instead of today's 123 KB).

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

### The first-paint fonts are preloaded

The public site's only layout shift (0.017) is two web fonts replacing their fallbacks after the first paint:
- **Space Grotesk 700** (headings);
- **Inter 400** (body text).

The browser finds both only after the stylesheet arrives. A `<link rel="preload" as="font" type="font/woff2" crossorigin>` for each, in the HTML head, starts them with the CSS instead of after it, so on most connections they arrive before the first paint and nothing swaps. `font-display: swap` stays, so text never waits for a font that is slow.

Only those two are preloaded. The other five weights and JetBrains Mono load later and aren't in the shift, and preloading a font the first paint doesn't use spends bandwidth the CSS and the entry chunk need more.

**How:** the hashed file names exist only in the build, so a small Vite plugin (`client/fontPreload.ts`) adds the two links in `transformIndexHtml` (`order: 'post'`), from the build's own asset names. It fails the build if either font is missing, so renaming or replacing a font can't silently drop the preload. The standalone SEO plugin builds its pages from that same `index.html` in `generateBundle`, afterwards, so every prerendered page and `404.html` inherit the links.

⚠️ **Verify first** that `transformIndexHtml`'s build context already holds the CSS-emitted font assets. If it doesn't, the plugin edits `index.html` in `generateBundle` instead, the way `seoBuild.ts` already does, and still runs before the SEO pages are written.

### Cloudflare in front of the public site

The owner's public site runs behind Cloudflare, and Cloudflare changes what Lighthouse sees. `docs/standalone.md` gains a section on it:
- **What passes through:** the origin's caching (immutable `/assets/`, `no-cache` HTML: verified on the live site) and its gzip. So this plan's level-9 `.gz` files are what visitors get, and Brotli there needs an uncompressed origin.
- **What it adds:**
  - *Bot Fight Mode / JavaScript Detections* injects a script into every page. That script is behind all three deprecation warnings on the public site's report, a 4-hour-cached request, and main-thread time.
  - *Web Analytics* (automatic setup) adds the RUM beacon, which brings the legacy-JavaScript item and a second request on every load.

  Keeping either is the owner's call, and the docs say what each costs.
- **What to keep off:** Rocket Loader. It rewrites the page's `<script>` tags to defer them, and this app's module scripts and modulepreloads are not tested under it.

The measuring section notes that a Lighthouse report of the public site includes Cloudflare's scripts, so they are read separately from Bifrost's.

### Measuring: a clean browser, three runs, the median

`docs/performance.md` (PLAN-34's doc) gains a "Page load" section:
- run Lighthouse in a profile with no extensions (Incognito, or `npx lighthouse … --chrome-flags="--headless=new"`), since extensions inject scripts that land in the report as if they were Bifrost's;
- use the **mobile** preset;
- take the **median of three** runs;
- measure the hub's `/` and the standalone site's `/` and `/runestone`;
- for the public site, read Cloudflare's injected scripts separately from Bifrost's, and record whether Bot Fight Mode and Web Analytics were on.

The before numbers in this plan were taken that way. The PR records the after numbers the same way.

## API contracts

None. No route is added, changed or removed, and `server/openapi.json` is unchanged. The web host changes only the headers and encodings of the static files it already serves.

## Task checklist

**Build**
- [ ] `client/precompress.ts`: a Vite plugin (`closeBundle`) writing `.br` (quality 11) and `.gz` (level 9) beside eligible text files over 1 KB that compress by at least 10%; no `.map`; registered for both builds in `vite.config.ts`; `client/tsconfig.json` include
- [ ] `client/bundleBudget.ts`: a Vite plugin (`generateBundle`) that walks the entry and its static imports transitively, fails on any forbidden package and on a gzip total over budget; both builds
- [ ] `client/fontPreload.ts`: a Vite plugin preloading Space Grotesk 700 and Inter 400 from the build's asset names; fails the build if either is missing; both builds. Verify first that `transformIndexHtml`'s build context holds the font assets (otherwise edit `index.html` in `generateBundle`, before the SEO plugin)
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
- [ ] Lighthouse, clean profile, mobile, median of three: the hub's `/`, the standalone `/` and `/runestone`, and the public site's `/` with its Cloudflare settings recorded, before (this plan's numbers) and after
- [ ] Write the budget (the measured total plus 10%, with the date and figure in a comment)

**Docs**
- [ ] `docs/performance.md` "Page load" section, including reading a public-site report behind Cloudflare; `docs/standalone.md`: `http2 on;` for the VPS nginx, and a "Behind Cloudflare" section (what passes through, what Bot Fight Mode / JavaScript Detections and Web Analytics add, Rocket Loader off); `architecture.md` (precompressed assets, the budget, `--accent-text`), `tech-stack.md` (zlib at build time); `decisions.md`, `progress.md`; archive this file into `completed/` in the PR

## Acceptance criteria

1. **Compression.** The hub serves every eligible asset Brotli-compressed to a browser that accepts `br`, gzip to one that accepts only `gzip`, and the plain file otherwise, with `Vary: Accept-Encoding`. This holds for direct asset requests, the SPA fallback and the standalone mode.
2. **Caching.** On the hub, `/assets/*` is `public, max-age=31536000, immutable`, the HTML and other files are `no-cache`, and a missing `/assets/` file is a 404, never the app shell.
3. **Lean first load.** The first load of the hub's `/` contains no module from `highlight.js`, `marked`, `dompurify` or `qrcode`, and transfers at most 300 KB (from 796 KB).
4. **Lighthouse,** clean profile, mobile, median of three, hub `/`: first contentful paint ≤ 3.0 s. Performance ≥ 85 is a target, not a guarantee: if it's missed, the PR names the metric that holds it back and why.
5. **Guide.** It opens on every page that has one, online and on an already-open tab after the hub becomes unreachable (offline mode on).
6. **Join card.** It renders on the hub's home page; if its chunk can't load, the rest of the home page still renders.
7. **Contrast.** Every theme's `--accent-text` reaches 4.5:1 against `--bg`, `--surface` and `--accent-soft` over `--bg`, enforced by `themes.test.ts`. Lighthouse reports no colour-contrast failure on the home page in Tokyo or Daybreak.
8. **Heading order.** Lighthouse reports no heading-order failure on the hub's home page.
9. **Fonts.** Every HTML file both builds ship (the hub's `index.html`, each prerendered page and `404.html`) preloads exactly Space Grotesk 700 and Inter 400, and the build fails if either font is missing. The PR reports the standalone `/`'s layout shift. The target is none attributed to a web font, but it isn't a guarantee: the prerendered summary paints after the CSS alone, so on a slow enough link a font can still arrive after it.
10. **Public site.** On `bifrost.0xsiddhant.com`, assets reach the browser gzipped at level 9 (the entry ~104 KB, from 123 KB). The PR records its before and after Lighthouse numbers with the Cloudflare settings they were taken under.
11. **Budget.** The build fails, naming the package and the chunk, when a forbidden package is added to the first load or the first load grows past the budget.
12. **Nothing else changes.** No behaviour change: `npm test` and the full `npm run test:e2e` pass unchanged.

## Test checklist

**Unit**
- [ ] `precompress`: eligible files get `.br` and `.gz` that decompress to the original; small, incompressible, `.map` and binary files get none
- [ ] `bundleBudget`: a fake bundle with `highlight.js` in a modulepreloaded chunk fails, naming both; the same module in a lazy chunk passes; over budget fails with the figures
- [ ] `resolveTheme`: a light and a dark theme whose accent fails get an `--accent-text` that passes and stays the same hue; one that passes keeps its accent
- [ ] `themes.test.ts`: every bundled theme passes the extended `contrastWarnings`; a fixture failing on `--accent-soft` alone is flagged; a fixture whose accent cannot be stepped within the limit fails and names the token to author
- [ ] `GuideButton.test.tsx`: the panel appears after a click (awaiting the lazy load); Escape and a route change still close it
- [ ] `MidgardPage.test.tsx`: the Join card appears; a rejected card import leaves the rest of the page rendered
- [ ] `fontPreload`: a bundle with both fonts gets exactly two preload links with `crossorigin`; a missing font fails the build, naming it
- [ ] Offline warm-load: the registry includes the Guide panel (and the guide texts, if added)

**Integration (web host)**
- [ ] `host.test.ts`, hub mode: `br`/`gzip`/identity for an asset, the SPA fallback and `index.html`, each with `Vary`; immutable `/assets/`, `no-cache` HTML; `/assets/gone.js` → 404
- [ ] `host.test.ts`, standalone mode: `br` served through `sendFile` with the page's status (200, and 404 for `404.html`)

**End-to-end**
- [ ] The existing Guide, offline-mode, home and standalone journeys pass unchanged
- [ ] `standalone-smoke.sh`: its gzip assertion still passes with `gzip_static` on
- [ ] The standalone journey: every prerendered page and `404.html` carry the two font preloads

**Live-verify / Manual**
- [ ] Lighthouse before and after (criteria 3, 4, 7, 8, 9, 10), recorded in the PR, the public site's with its Cloudflare settings
- [ ] Owner: before/after screenshots of Daybreak and Tokyo's accent text approved
