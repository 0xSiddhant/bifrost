# PLAN-01 — UI/UX Foundation (⛔ hard approval gate)

## Goal

A distinctive, responsive design system and the static shells of every page — presented to the user for approval. **No plan after this one may begin until the user explicitly approves the UI/UX.** Expect iteration; budget for 2–3 review rounds.

## Why this is its own plan

Bifrost must not look like a Bootstrap/Tailwind template. Fonts, the initial theme, spacing, and motion are product decisions the owner signs off on — cheaper to iterate on static screens than on wired-up features. Everything here also becomes the substrate the theme engine (PLAN-04) parametrizes, so tokens must be complete and disciplined from the start.

## Scope

**In:** design tokens, typography (self-hosted fonts), initial theme + one alternate, app shell, static versions of all pages with mocked data, responsiveness, motion guidelines, empty/loading/error states.
**Out:** any real API wiring, theme engine JSON pipeline (PLAN-04 consumes the tokens defined here), admin logic.

## Decisions & reasoning

- **Fonts are self-hosted in the repo** (`client/src/assets/fonts`, woff2 + `@font-face`). A LAN-only site may run with no internet at all — a Google Fonts CDN link would silently fall back to system fonts on half the devices. Licensing: use open licenses only (OFL / Fontshare free tier).
- **Proposed font direction (present 2 options to user, they pick):**
  - *Option A — "Asgard console":* **Space Grotesk** (display/headings — geometric, slightly retro-futuristic) + **Inter** or **General Sans** (body) + **JetBrains Mono** (file names, sizes, code — a dev tool should render filenames in mono).
  - *Option B — "Editorial bridge":* **Clash Display** (headings — high personality) + **Satoshi** (body) + **IBM Plex Mono** (data).
- **Initial theme: "Aurora" (dark-first).** Near-black blue-slate background, aurora accent spectrum (teal → violet → green) used *sparingly* — a top border "bridge" gradient on the shell, accent on interactive states, per-file-type tint on icons. Rationale: the rainbow-bridge identity, and a file hub is glanced at from phones at night. Alternate built-in: **"Daybreak"** (light, warm paper background, same accent hues desaturated) — also proves two themes work before the engine exists.
- **Every visual value is a CSS custom property** in `tokens.css`: color roles (`--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--accent`, `--accent-2`, `--danger`, `--ok`, `--border`), radii, spacing scale, font families, shadows, motion durations. Components consume tokens only — this file's shape *is* the future theme JSON contract.
- **Layout language:** card-based, generous whitespace, max-width container on desktop, bottom-tab feel on phones. Home = two large "portal" cards (Upload / Download) — the two options every visitor sees, per requirements.
- **Motion:** subtle only — 150–200ms ease transitions, upload progress as a filling bridge-gradient bar; respect `prefers-reduced-motion`.

## Task checklist

- [ ] Add chosen fonts (woff2) + `@font-face`, fallback stacks, `font-display: swap`
- [ ] `tokens.css`: full token set; `Aurora` as `:root` defaults; `Daybreak` as `[data-theme="daybreak"]` override — switching = swapping one attribute
- [ ] Base styles: reset, typography scale (h1–h4, body, caption, mono-data), focus-visible states
- [ ] Component set (static): Button (primary/ghost/danger), Card, PortalCard, FileRow (icon + name + size + time), ProgressBar, Toast, EmptyState, Modal, Input/Select, ThemeToggle placeholder
- [ ] App shell: header with Bifrost wordmark + bridge gradient strip, responsive nav (capabilities-driven slots), footer with server identity
- [ ] Static pages with mocked data: Home (two portals), Upload (dropzone + multi-file queue with per-file progress), Downloads (live list look, sort/search bar), Clipboard, QR tool, Heimdall (login + dashboard shells), 404
- [ ] States designed, not improvised: empty download folder, upload error, offline/SSE-reconnecting banner
- [ ] Responsive verification at 375 / 768 / 1280 px + iPhone safe-area insets
- [ ] Screenshot set (or short screen recording) of every page at phone + desktop widths for the approval review
- [ ] `docs/DESIGN.md` (concise): token reference, font rationale, do/don't examples

## Approval gate protocol

1. Open PR `feat/plan-01-uiux` → `develop` with the screenshot set in the PR description.
2. User reviews on real devices (`npm run dev`, phone + laptop).
3. Iterate on feedback within the same PR.
4. Only when the user writes explicit approval (e.g. "UI approved") → merge, mark PLAN-01 `done`, unlock PLAN-02+. Record approval date in `memory/progress.md`.

## Acceptance criteria

1. All pages render from mocked data, responsive at the three breakpoints, no horizontal scroll on 375px.
2. Toggling `data-theme` swaps the entire look with zero component changes.
3. No hardcoded colors/sizes in any component (`grep` for hex values outside `tokens.css` returns nothing).
4. Fonts load with no network access (verified with Wi-Fi off on the host).
5. **User has explicitly approved the design.**

## Test checklist

- [ ] Visual pass on real iPhone + Android + desktop browser
- [ ] Lighthouse a11y score ≥ 90 on Home; keyboard-only navigation works
- [ ] `prefers-reduced-motion` disables non-essential animation
