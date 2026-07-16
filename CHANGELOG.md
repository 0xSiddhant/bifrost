# Changelog


## v1.0.0 (2026-07-16)

First release: plans 00–06 — foundation, UI/UX system, file transfer, previews + QR, JSON theming, Heimdall admin panel, and clipboard sync / device presence / audit log.


### 🚀 Enhancements

- **core:** Add kernel services and the feature-module contract ([7e05c85](https://github.com/0xSiddhant/bifrost/commit/7e05c85))
- **core:** Add composition root, profile manifest, health module ([bc6137c](https://github.com/0xSiddhant/bifrost/commit/bc6137c))
- **client:** Add react shell with capabilities nav and sse client ([b6e7364](https://github.com/0xSiddhant/bifrost/commit/b6e7364))
- **client:** Add self-hosted fonts and the aurora/daybreak tokens ([8e3bd77](https://github.com/0xSiddhant/bifrost/commit/8e3bd77))
- **client:** Add the token-driven ui component set ([0bf2713](https://github.com/0xSiddhant/bifrost/commit/0bf2713))
- **client:** Add sky relics with three collections and local prefs ([f03a12c](https://github.com/0xSiddhant/bifrost/commit/f03a12c))
- **client:** Add app shell and static pages for every module ([42a29bb](https://github.com/0xSiddhant/bifrost/commit/42a29bb))
- **core:** File-transfer events, rate-limit config, safer shutdown ([233edd9](https://github.com/0xSiddhant/bifrost/commit/233edd9))
- **file-transfer:** Server module with upload, live watch, download ([458c13c](https://github.com/0xSiddhant/bifrost/commit/458c13c))
- **client:** Wire upload queue and live downloads to the api ([44684b6](https://github.com/0xSiddhant/bifrost/commit/44684b6))
- **core:** Range parser, inline mime map, shared download-id ([c9a0b44](https://github.com/0xSiddhant/bifrost/commit/c9a0b44))
- **file-transfer:** Range and inline support on the content route ([5360980](https://github.com/0xSiddhant/bifrost/commit/5360980))
- **previews:** Meta endpoint with byte-sniffed kind resolution ([8a38ce0](https://github.com/0xSiddhant/bifrost/commit/8a38ce0))
- **qr-tool:** Server-url endpoint and boot-log qr ([8ba9555](https://github.com/0xSiddhant/bifrost/commit/8ba9555))
- **client:** Preview modal route with per-kind viewers ([8cfcb06](https://github.com/0xSiddhant/bifrost/commit/8cfcb06))
- **client:** Live qr page with reusable qrcard ([7d2c55f](https://github.com/0xSiddhant/bifrost/commit/7d2c55f))
- **client:** Draw the bifrost bridge badge in qr centers ([330283c](https://github.com/0xSiddhant/bifrost/commit/330283c))
- **client:** Theme-aware qr styling with a refined bridge badge ([9f43b5b](https://github.com/0xSiddhant/bifrost/commit/9f43b5b))
- **client:** Carve the bifrost wordmark into the qr matrix ([f3a8558](https://github.com/0xSiddhant/bifrost/commit/f3a8558))
- **client:** Name downloaded qr pngs after their content ([576d8c4](https://github.com/0xSiddhant/bifrost/commit/576d8c4))
- **core:** Theme.updated event and themes config ([1840f95](https://github.com/0xSiddhant/bifrost/commit/1840f95))
- **themes:** Json theme engine with ajv validation and live watch ([542f445](https://github.com/0xSiddhant/bifrost/commit/542f445))
- **client:** Live theme engine, switcher, and fouc guard ([87024bc](https://github.com/0xSiddhant/bifrost/commit/87024bc))
- **core:** Add pin-session auth and admin route guard ([601ea50](https://github.com/0xSiddhant/bifrost/commit/601ea50))
- **heimdall:** Admin panel with settings, stats, and upload audit ([d3bf47d](https://github.com/0xSiddhant/bifrost/commit/d3bf47d))
- **themes:** Session-guard writes and admin theme enable/disable ([d136083](https://github.com/0xSiddhant/bifrost/commit/d136083))
- **themes:** Add ghibli dusk evening theme ([377f649](https://github.com/0xSiddhant/bifrost/commit/377f649))
- **heimdall:** Admin panel ui, entry gesture, and theme manager ([da4026f](https://github.com/0xSiddhant/bifrost/commit/da4026f))
- **client:** Add ghibli world relic collection ([9fc57d7](https://github.com/0xSiddhant/bifrost/commit/9fc57d7))
- **core:** Sse connection metadata + db schema for plan-06 ([16ea4e2](https://github.com/0xSiddhant/bifrost/commit/16ea4e2))
- **clipboard:** Shared clipboard module for the local network ([c3136ee](https://github.com/0xSiddhant/bifrost/commit/c3136ee))
- **presence:** Device presence with character aliases ([2fd7d4e](https://github.com/0xSiddhant/bifrost/commit/2fd7d4e))
- **audit-log:** Activity-log subscriber and history endpoint ([df1ae4f](https://github.com/0xSiddhant/bifrost/commit/df1ae4f))
- **core:** Register clipboard, presence, and audit-log modules ([5211706](https://github.com/0xSiddhant/bifrost/commit/5211706))
- **client:** Device identity and shared device registry ([7b3a157](https://github.com/0xSiddhant/bifrost/commit/7b3a157))
- **client:** Muninn, wardens, and sigil pages ([2384809](https://github.com/0xSiddhant/bifrost/commit/2384809))
- **heimdall:** Activity history and connected-devices views ([c3832c7](https://github.com/0xSiddhant/bifrost/commit/c3832c7))

### 🩹 Fixes

- **core:** Answer mdns a-record queries for bifrost.local ([627598d](https://github.com/0xSiddhant/bifrost/commit/627598d))
- **client:** Bind vite dev server to ipv4 and allow the mdns host ([abc1273](https://github.com/0xSiddhant/bifrost/commit/abc1273))

### 💅 Refactors

- **client:** Rename the landing page home to midgard ([a38b4d6](https://github.com/0xSiddhant/bifrost/commit/a38b4d6))

### 📖 Documentation

- Seed agent knowledge base, project docs, and readme ([c893e7e](https://github.com/0xSiddhant/bifrost/commit/c893e7e))
- Mirror architecture, add theme spec placeholder and assets ([4d9f6f0](https://github.com/0xSiddhant/bifrost/commit/4d9f6f0))
- Mark plan-00 done and set plan-01 active ([07d424b](https://github.com/0xSiddhant/bifrost/commit/07d424b))
- Add design system reference and record plan-01 decisions ([97b4cf7](https://github.com/0xSiddhant/bifrost/commit/97b4cf7))
- Add ui screenshots to the readme ([de477b1](https://github.com/0xSiddhant/bifrost/commit/de477b1))
- Record plan-02 progress and decisions ([a318458](https://github.com/0xSiddhant/bifrost/commit/a318458))
- Record plan-03 progress and decisions ([0851b8d](https://github.com/0xSiddhant/bifrost/commit/0851b8d))
- Add plan-07 runestone, reserve plan-08, renumber ops to 09 ([3a000d4](https://github.com/0xSiddhant/bifrost/commit/3a000d4))
- Write theme-spec and record plan-04 progress ([ba63452](https://github.com/0xSiddhant/bifrost/commit/ba63452))
- Author plan-08 variant and sync the plan index ([99bf7d1](https://github.com/0xSiddhant/bifrost/commit/99bf7d1))
- Log midgard naming and the plan-08 diff-token open point ([6cf84d3](https://github.com/0xSiddhant/bifrost/commit/6cf84d3))
- Record plan-05 heimdall progress and decisions ([f2e17ec](https://github.com/0xSiddhant/bifrost/commit/f2e17ec))
- Record plan-06 progress and decisions ([cbf1a80](https://github.com/0xSiddhant/bifrost/commit/cbf1a80))
- Validate and amend plans 07-10 ahead of implementation ([0b0be7d](https://github.com/0xSiddhant/bifrost/commit/0b0be7d))

### 🏡 Chore

- Add workspaces, strict ts, lint boundaries, commit tooling ([9aea55d](https://github.com/0xSiddhant/bifrost/commit/9aea55d))
- Add setup and backup scripts ([bff5d04](https://github.com/0xSiddhant/bifrost/commit/bff5d04))
- **docs:** Context sync for v1.0.0 ([f28198d](https://github.com/0xSiddhant/bifrost/commit/f28198d))

### ✅ Tests

- **file-transfer:** Sanitizer corpus, usecases, http, watcher, kill ([e88e4cd](https://github.com/0xSiddhant/bifrost/commit/e88e4cd))
- **previews:** Range corpus, kind resolver, http integration ([1767e19](https://github.com/0xSiddhant/bifrost/commit/1767e19))
- **themes:** Schema corpus, contrast, integration, resolution order ([e361d80](https://github.com/0xSiddhant/bifrost/commit/e361d80))

### 🤖 CI

- Run lint, typecheck, test and build on prs and main pushes ([11ae595](https://github.com/0xSiddhant/bifrost/commit/11ae595))

### ❤️ Contributors

- 0xSiddhant <contactsiddhant2155@gmail.com>

