# Changelog


## v1.2.0

[compare changes](https://github.com/0xSiddhant/bifrost/compare/v1.1.0...v1.2.0)

### 🚀 Enhancements

- **client:** Add favicon and installable PWA support ([#28](https://github.com/0xSiddhant/bifrost/pull/28))
- **core:** Add eddas table, config, and bus events ([642ce9a](https://github.com/0xSiddhant/bifrost/commit/642ce9a))
- **edda:** Add server module with crud, public raw api, and audit ([4ee6cda](https://github.com/0xSiddhant/bifrost/commit/4ee6cda))
- **client:** Add markdown renderer core and editor markdown mode ([e8bc8d5](https://github.com/0xSiddhant/bifrost/commit/e8bc8d5))
- **edda:** Add editor, live preview, and pensieve library pages ([5a8c072](https://github.com/0xSiddhant/bifrost/commit/5a8c072))
- **core:** Add eval-free javascript transform toolkit ([0404c2a](https://github.com/0xSiddhant/bifrost/commit/0404c2a))
- **core:** Add editor js-mode, undo/redo, and shared panel controls ([641d2f5](https://github.com/0xSiddhant/bifrost/commit/641d2f5))
- **loki:** Add module, config, workbench page, regex, and hub card ([57ad8bb](https://github.com/0xSiddhant/bifrost/commit/57ad8bb))
- **runestone:** Add copy-as-js, panel font, and undo/redo ([20c72b7](https://github.com/0xSiddhant/bifrost/commit/20c72b7))
- **variant:** Seed loki before/after diffs and add panel controls ([602f9d7](https://github.com/0xSiddhant/bifrost/commit/602f9d7))
- **loki:** Add execution config, settings routes, and events ([96b6c9f](https://github.com/0xSiddhant/bifrost/commit/96b6c9f))
- **core:** Capture the repl completion value of a run ([d057597](https://github.com/0xSiddhant/bifrost/commit/d057597))
- **loki:** Add the calcifer worker sandbox, output panel, and run ui ([832a2d3](https://github.com/0xSiddhant/bifrost/commit/832a2d3))
- **heimdall:** Add the loki execution settings card ([b8e33d1](https://github.com/0xSiddhant/bifrost/commit/b8e33d1))
- **core:** Show match count in the editor find panel ([a6bbd3b](https://github.com/0xSiddhant/bifrost/commit/a6bbd3b))
- **themes:** Add gryffindor + slytherin and a 10-slot card palette ([7448c6d](https://github.com/0xSiddhant/bifrost/commit/7448c6d))
- **screensaver:** Add nótt idle particle screensaver ([#32](https://github.com/0xSiddhant/bifrost/pull/32))

### 🩹 Fixes

- **screensaver:** Restore the 60s idle default ([220940e](https://github.com/0xSiddhant/bifrost/commit/220940e))

### 💅 Refactors

- **client:** Unify hub cards into one shared portal component ([497ab0f](https://github.com/0xSiddhant/bifrost/commit/497ab0f))

### 📖 Documentation

- Log the v1.1.0 release and the tag-push fix ([d55c874](https://github.com/0xSiddhant/bifrost/commit/d55c874))
- **edda:** Sync .agent context and memory for plan-11 ([389d59a](https://github.com/0xSiddhant/bifrost/commit/389d59a))
- **edda:** Record pr #29 in progress tracker ([#29](https://github.com/0xSiddhant/bifrost/issues/29))
- Review plan-12 (loki) and log its decisions ([1b19425](https://github.com/0xSiddhant/bifrost/commit/1b19425))
- Complete plan-11, log plan-12 part a ([5ad1a9b](https://github.com/0xSiddhant/bifrost/commit/5ad1a9b))
- Record multi-tab sse rca and shared-sse backlog item ([e260d04](https://github.com/0xSiddhant/bifrost/commit/e260d04))
- Log plan-12 part b (calcifer), find-counter, and fixes ([ea57a75](https://github.com/0xSiddhant/bifrost/commit/ea57a75))
- Record the loki pr number ([ace4c0e](https://github.com/0xSiddhant/bifrost/commit/ace4c0e))
- Add plans 13-15 and reconcile the backlog ([6688a82](https://github.com/0xSiddhant/bifrost/commit/6688a82))
- **themes:** Add theme skill and sync design, spec, and memory ([a68b52a](https://github.com/0xSiddhant/bifrost/commit/a68b52a))

### 🏡 Chore

- Register edda commit scope ([63d32b6](https://github.com/0xSiddhant/bifrost/commit/63d32b6))
- **loki:** Allow the loki commit scope ([cfe0775](https://github.com/0xSiddhant/bifrost/commit/cfe0775))

### 🤖 CI

- Push the release tag as an explicit ref ([6528825](https://github.com/0xSiddhant/bifrost/commit/6528825))
- Attribute release commits to the github-actions bot ([c6b35c6](https://github.com/0xSiddhant/bifrost/commit/c6b35c6))

### ❤️ Contributors

- 0xSiddhant <contactsiddhant2155@gmail.com>
- Siddhant Kumar <contactsiddhant2155@gmail.com>

## v1.1.0

[compare changes](https://github.com/0xSiddhant/bifrost/compare/v1.0.0...v1.1.0)

### 🚀 Enhancements

- **clipboard:** Make links in muninn text entries tappable ([af51e0b](https://github.com/0xSiddhant/bifrost/commit/af51e0b))
- **themes:** Add olympus greek mythology built-in theme ([e01dce6](https://github.com/0xSiddhant/bifrost/commit/e01dce6))
- **presence:** Add greek character pool for device aliases ([83d98b2](https://github.com/0xSiddhant/bifrost/commit/83d98b2))
- **core:** Add runestone doc-size cap to config ([0d8085b](https://github.com/0xSiddhant/bifrost/commit/0d8085b))
- **core:** Add relic-name generator service ([bfe0dc6](https://github.com/0xSiddhant/bifrost/commit/bfe0dc6))
- **runestone:** Register module exposing the doc cap ([f383f4e](https://github.com/0xSiddhant/bifrost/commit/f383f4e))
- **client:** Add core json utils and relic-name mirror ([2a3c888](https://github.com/0xSiddhant/bifrost/commit/2a3c888))
- **client:** Add shared codemirror json editor component ([2fe01b1](https://github.com/0xSiddhant/bifrost/commit/2fe01b1))
- **runestone:** Editor page with tree view and draft survival ([dd9dd54](https://github.com/0xSiddhant/bifrost/commit/dd9dd54))
- **client:** Expand olympus relic collection to parity ([a99d5ce](https://github.com/0xSiddhant/bifrost/commit/a99d5ce))
- **core:** Add runestone saved and deleted bus events ([d1afc33](https://github.com/0xSiddhant/bifrost/commit/d1afc33))
- **runestone:** Add runestones table and migration ([791444c](https://github.com/0xSiddhant/bifrost/commit/791444c))
- **runestone:** Slug service, repository, and usecases ([f036006](https://github.com/0xSiddhant/bifrost/commit/f036006))
- **runestone:** Crud routes, sse fanout, and kill test ([2a35023](https://github.com/0xSiddhant/bifrost/commit/2a35023))
- **audit-log:** Record runestone saves and deletes ([dc45639](https://github.com/0xSiddhant/bifrost/commit/dc45639))
- **runestone:** Editor save flow, slug urls, creative 404 ([89df1c3](https://github.com/0xSiddhant/bifrost/commit/89df1c3))
- **runestone:** Library page with live refresh ([04b8b80](https://github.com/0xSiddhant/bifrost/commit/04b8b80))
- **runestone:** Public json data endpoint at /runestone/api/:slug ([19ab58f](https://github.com/0xSiddhant/bifrost/commit/19ab58f))
- **runestone:** Rename library to mimir, add api chip per row ([58b0fe9](https://github.com/0xSiddhant/bifrost/commit/58b0fe9))
- **core:** Add greek entries to the relic-name bank ([db8621c](https://github.com/0xSiddhant/bifrost/commit/db8621c))
- **themes:** Add diff token group with derived defaults ([9481bd2](https://github.com/0xSiddhant/bifrost/commit/9481bd2))
- **client:** Add structural json diff engine and text normalizers ([baee863](https://github.com/0xSiddhant/bifrost/commit/baee863))
- **variant:** Register capability-only module in both profiles ([8fcc8a0](https://github.com/0xSiddhant/bifrost/commit/8fcc8a0))
- **client:** Extend json editor with diff decorations and pane hooks ([126d006](https://github.com/0xSiddhant/bifrost/commit/126d006))
- **variant:** Two-pane compare page with rail, drawer, and pickers ([e7be50d](https://github.com/0xSiddhant/bifrost/commit/e7be50d))
- **client:** Auto-close brackets and quotes in the json editor ([13678c2](https://github.com/0xSiddhant/bifrost/commit/13678c2))
- **variant:** Let the compare area use the desktop width ([984af4e](https://github.com/0xSiddhant/bifrost/commit/984af4e))
- **variant:** Diff only on the compare cta in text mode too ([020e84e](https://github.com/0xSiddhant/bifrost/commit/020e84e))
- **variant:** Separate mode workspaces and display-only labels ([90b3583](https://github.com/0xSiddhant/bifrost/commit/90b3583))
- **variant:** Editable panes in both modes, results drop on edit ([7ed68b0](https://github.com/0xSiddhant/bifrost/commit/7ed68b0))
- **core:** Online-safe backup + restore with rotation ([76bfe5a](https://github.com/0xSiddhant/bifrost/commit/76bfe5a))
- **ops:** Pm2 process definition + pm2/launchd run docs ([84686da](https://github.com/0xSiddhant/bifrost/commit/84686da))
- **ops:** Dockerfile + compose for the linux target ([feaaf71](https://github.com/0xSiddhant/bifrost/commit/feaaf71))
- **ops:** Optional grafana + loki + alloy observability stack ([d9b49ac](https://github.com/0xSiddhant/bifrost/commit/d9b49ac))
- **ops:** One-command run scripts (pm2, launchd, observability) ([f739eb7](https://github.com/0xSiddhant/bifrost/commit/f739eb7))
- **presence:** Prune devices idle over 7 days on demand ([1034fea](https://github.com/0xSiddhant/bifrost/commit/1034fea))
- **heimdall:** Convert admin panel to a modal overlay ([83238ce](https://github.com/0xSiddhant/bifrost/commit/83238ce))
- **core:** Log tap, build stamp, and runtime log-level plumbing ([922ebb6](https://github.com/0xSiddhant/bifrost/commit/922ebb6))
- **heimdall:** Add about and logs sections ([063132f](https://github.com/0xSiddhant/bifrost/commit/063132f))
- In-editor find, tree collapse-all, and runestone width revamp ([#21](https://github.com/0xSiddhant/bifrost/pull/21))
- **client:** Category nav with ollivanders and diagon alley hubs ([468517c](https://github.com/0xSiddhant/bifrost/commit/468517c))
- **client:** Move join bifrost to midgard, slim sigil to a qr maker ([93c8472](https://github.com/0xSiddhant/bifrost/commit/93c8472))
- **client:** Card tone-gradient system and midgard redesign ([e688c90](https://github.com/0xSiddhant/bifrost/commit/e688c90))

### 🩹 Fixes

- **variant:** Keep fresh compare results from being marked stale ([c293e05](https://github.com/0xSiddhant/bifrost/commit/c293e05))
- **variant:** Bound compare cost on large documents ([51547df](https://github.com/0xSiddhant/bifrost/commit/51547df))
- **variant:** Keep invalid-json compare in json mode (+ docs sync & lore renames) ([#18](https://github.com/0xSiddhant/bifrost/pull/18))
- **core:** Dedicated bootstrap entry so pm2 fork mode boots the server ([01293ee](https://github.com/0xSiddhant/bifrost/commit/01293ee))
- **ops:** Ascii ellipsis in run scripts (set -u unbound variable) ([9167e42](https://github.com/0xSiddhant/bifrost/commit/9167e42))

### 💅 Refactors

- **client:** Move copy helper into core for shared use ([88e780d](https://github.com/0xSiddhant/bifrost/commit/88e780d))
- **client:** Move tree view and runestone api client into core ([b60cf08](https://github.com/0xSiddhant/bifrost/commit/b60cf08))

### 📖 Documentation

- **ops:** Cloud-profile deployment checklist ([8ae62ae](https://github.com/0xSiddhant/bifrost/commit/8ae62ae))
- **ops:** Run/observability steps + release-skill automation update ([28d692f](https://github.com/0xSiddhant/bifrost/commit/28d692f))
- **ops:** Sync context + rules with plan-09 tooling ([dde3295](https://github.com/0xSiddhant/bifrost/commit/dde3295))
- **docs:** Archive plan-09, set plan-10 in-review, log decisions ([466d156](https://github.com/0xSiddhant/bifrost/commit/466d156))
- **docs:** Log plan-10 tranche 2 (about + logs) ([beb9b00](https://github.com/0xSiddhant/bifrost/commit/beb9b00))
- Log the nav category reorg ([5c8ff91](https://github.com/0xSiddhant/bifrost/commit/5c8ff91))
- Sync context and design docs for category nav and tones ([1b03ded](https://github.com/0xSiddhant/bifrost/commit/1b03ded))
- Refresh readme screenshots for the new design ([#23](https://github.com/0xSiddhant/bifrost/pull/23))

### 🏡 Chore

- **docs:** Archive completed plans 00-06 ([99f3c1e](https://github.com/0xSiddhant/bifrost/commit/99f3c1e))
- **docs:** Add claude code project skills ([8d1ceb0](https://github.com/0xSiddhant/bifrost/commit/8d1ceb0))
- **docs:** Record olympus world in agent memory ([705b76b](https://github.com/0xSiddhant/bifrost/commit/705b76b))
- **ci:** Add runestone to commitlint scopes ([e343ba4](https://github.com/0xSiddhant/bifrost/commit/e343ba4))
- **docs:** Record plan-07 part a progress and decisions ([bffee11](https://github.com/0xSiddhant/bifrost/commit/bffee11))
- **docs:** Record plan-07 part b progress and decisions ([5cdd223](https://github.com/0xSiddhant/bifrost/commit/5cdd223))
- **docs:** Record runestone public api and mimir rename ([ccecd57](https://github.com/0xSiddhant/bifrost/commit/ccecd57))
- **ci:** Add variant to commitlint scopes ([47cc9a0](https://github.com/0xSiddhant/bifrost/commit/47cc9a0))
- **docs:** Record plan-08 progress and decisions ([6c26ee7](https://github.com/0xSiddhant/bifrost/commit/6c26ee7))
- **docs:** Record plan-08 feedback round ([cae8928](https://github.com/0xSiddhant/bifrost/commit/cae8928))
- **docs:** Record explicit-compare requirement ([858de5d](https://github.com/0xSiddhant/bifrost/commit/858de5d))
- **docs:** Record workspace-separation feedback ([17e24dc](https://github.com/0xSiddhant/bifrost/commit/17e24dc))
- **docs:** Record editable-panes feedback round ([a5e6774](https://github.com/0xSiddhant/bifrost/commit/a5e6774))
- **docs:** Record plan-09 tranche 1 progress + decision ([efeaf6f](https://github.com/0xSiddhant/bifrost/commit/efeaf6f))
- **docs:** Mark plan-09 implemented (all 8 items) ([bc6d4c4](https://github.com/0xSiddhant/bifrost/commit/bc6d4c4))

### ✅ Tests

- **core:** Scripted restart-resilience suite ([15f4809](https://github.com/0xSiddhant/bifrost/commit/15f4809))

### 🤖 CI

- **ops:** Release automation + docker build job + backup smoke ([d40d377](https://github.com/0xSiddhant/bifrost/commit/d40d377))

### ❤️ Contributors

- Siddhant Kumar <contactsiddhant2155@gmail.com>
- 0xSiddhant <contactsiddhant2155@gmail.com>
- Claude <noreply@anthropic.com>

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

