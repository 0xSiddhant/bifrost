# PLAN-17 — Send/Receive flow + in-app notifications

## Goal

Turn the Send page from a fire-and-forget chute into a short-lived staging area: after a file lands, its card offers **Move to downloads · Preview · Rename · Delete**. Moving publishes the file to everyone on the LAN and announces it with a transient banner. Uploads stop being stamped with a timestamp they never needed — names stay clean and are disambiguated only on an actual collision.

Underneath it, Bifrost gains the thing it has never had: a **reusable in-app notification system** any feature can call.

## Gate

PLAN-16 merged. **Declared exception: two PRs with a hard owner checkpoint between them** (the PLAN-07 / PLAN-12 precedent).

| PR | Branch | Ships |
| --- | --- | --- |
| **17a** | `feat/plan-17a-notifications` | `core/notify` — the notification system alone, plus one real adoption to prove the API |
| **17b** | `feat/plan-17b-send-receive` | Everything else: card actions, move flow, naming change, rename/delete/preview, the broadcast |

> ⛔ **HARD GATE: the owner must approve the notification UI and flow before any of 17b begins.** Owner instruction, verbatim: *"once i approved the notification ui and flow then continue to implementation of other points."* Iterate on 17a until approved. Archive this plan file at the 17b PR.

## Decisions & reasoning

### This plan supersedes two logged decisions — say so out loud

- **`decisions.md:14` (2026-07-12): _"no read route for uploads/ … write-only by construction"_** and **`decisions.md:17`: _"Admin sees upload metadata only; file management stays in Finder"_**. Preview, rename, delete, and move all require addressing a file in `uploads/` by name, which is exactly what those decisions forbade. `architecture.md:20` ("Upload (write-only) + download (read-only)") and the Send page's own copy ("*a write-only vault — nothing here can be read back*") both need updating. This is a deliberate owner reversal, not drift; per CLAUDE.md it must be logged in `decisions.md` with the new reasoning, and the UI copy must stop claiming something untrue.
- **The "temporary visibility" property is client-side only and is _not_ a security boundary.** The owner's framing — *"visibility is temporary, once user refresh the page the upload list will disappear"* — describes React state, not the API. Once `POST /api/files/:name/move` exists, **anyone on the LAN can call it for any stored name**, refresh or no refresh. Two honest options:
  1. **LAN trust (recommended, matches the rest of the app):** accept it. Everything in `downloads/` is already world-readable on the LAN, and the blast radius of "someone else publishes your upload" on a household network is small. Cheapest, no new concepts.
  2. **Per-upload capability token:** the upload response returns a short-lived opaque token per accepted file; the four action routes require it. Preserves "write-only for everyone but the uploader" exactly. Costs a token store and expiry handling.
  **Owner decision required at the 17a checkpoint** — it changes 17b's route signatures, so it must be settled before 17b starts.
- **The extension blocklist rationale weakens and must be re-read.** `.env.example:22` justifies `UPLOAD_EXT_BLOCKLIST` as belt-and-suspenders because "uploads are never executed or served regardless". Once uploads can be previewed and moved into the served `downloads/` folder, the second half stops being true. The blocklist stays (it is now doing real work, not redundant work) and the comment gets corrected.

### Drop the `upload_audit` table (17b)

- **It is near-total duplication of `audit_events`.** `audit-recorder.ts:43` already records every `file.uploaded` with `ts`, `ip` (the uploader hint), and a `summary` carrying the original name and size. Four of `upload_audit`'s five columns are therefore stored twice; the only unique one is `storedName` — which, once this plan removes the timestamp prefix, converges with `originalName` anyway. A table, a repository, a port, a recorder, and a reconciler are being maintained for a column that is about to stop being interesting.
- **It has already drifted from the filesystem, and the owner's screenshot shows it.** The Heimdall Uploads list renders `Screenshot 2026-07-24 at 4.59.22/4.59.37/4.59.56 PM.png` and `IMG_1153.png`, none of which are in `storage/uploads/` any more — rows for files deleted outside the app. The section header claims *"Metadata for everything that has been sent"*, which is accurate and precisely the problem: it is answering a history question while looking like a file list. Reading the directory cannot drift.
- **`.DS_Store` is listed as a user upload** ("unknown device", 6.0 KB) because `reconcile()` skips only `.gitkeep`. Dot-file filtering is needed regardless, and belongs with the directory listing.
- **This plan breaks the recorder anyway.** `upload-audit-recorder.ts:56` parses `<timestamp>-<sanitized>` to recover both halves of a stored name; dropping the prefix invalidates it. The choice is repair or delete — delete is clearly right.
- **Where the three dashboard figures go.** `GetStatsUseCase` uses the table for `uploads.total`, `uploads.today`, and the 24h `activity[]` sparkline. These repoint to **`audit_events`** — same database, schema already in `core/db/schema.ts`, so it is a shared table rather than a cross-module import. Note in the code that `audit-log` conceptually owns that table, so the coupling is deliberate and visible.
- **Net effect: two sections with two honest meanings.** Heimdall → Uploads becomes "what is on disk right now" (name · size · mtime, from the filesystem). Heimdall → History stays "what has happened", already served by `audit_events`. Today's Uploads section is a confused blend of both.
- **The Send page list vanishes on refresh — plain React state, no `sessionStorage`.** Owner decision. Component state already gives exactly this; `sessionStorage` would make the list *survive* a refresh until the tab closes, which is more persistence than intended. The durable signal after a move is the notification and the file's presence in Downloads, not a restored card list.

### Notifications (17a)

- **What exists today is not a system.** `core/ui/Toast.tsx` is a presentational `<div role="status">` with a `kind` prop — no store, no queue, no timer, no positioning, no cross-page life. Five pages (Loki, Runestone, Variant, Upload, plus Heimdall patterns) each hand-roll their own `notice` state. The owner's condition is therefore met: build the system first.
- **`Toast` stays; the two things are different.** `Toast` is **inline and in-flow** — it sits inside a page's layout and persists until that page's state changes. Notifications are **global, stacked, transient, and self-dismissing**. Forcing the five existing call sites to migrate would be churn for its own sake; they migrate only where the notice is genuinely transient. New surfaces prefer `notify`.
- **`client/src/core/notify/`** — a provider mounted **once in `App.tsx` outside `<Routes>`** so notifications survive route changes, plus a store and an imperative `notify` handle usable from non-React code (the SSE layer needs it):
  - `notify.info|ok|error(message, opts?)`, `opts = { timeout, dedupeKey, title?, onDismiss? }`
  - Top-right stack, newest on top, **max 4 visible** with an overflow count — a bulk move of 20 files must not paper the screen
  - `dedupeKey` collapses repeats into one entry with a counter instead of stacking duplicates
  - Auto-dismiss with a **visible progress indicator** and a cross to dismiss early; hovering or focusing pauses the timer (dismissing a banner you are still reading is the classic failure)
  - `prefers-reduced-motion` drops the slide/swipe animations; the progress indicator becomes a static bar
  - `aria-live="polite"` for info/ok, `assertive` for errors; the cross is a real focusable button with a label
  - Errors default to **no auto-dismiss** — an error that vanishes before it is read is worse than none
  - **⚠️ Non-dismissing errors + a hard cap of 4 can deadlock the stack.** Four unresolved errors fill it permanently and every later `ok`/`info` vanishes behind an overflow count with no way to surface. The cap therefore applies **per kind**: errors evict oldest-error-first, and at least one slot stays reserved for transient notifications. A "dismiss all" control appears once more than one error is stacked
- **17a must include one real adoption**, not just a demo page: wire upload/download failures (an owner requirement anyway) through `notify.error` so the API is proven by use before the checkpoint.

### Naming (17b)

- **Drop the unconditional timestamp; let the existing collision handler do the work.** `upload-files.ts:52` publishes `${now()}-${safeName}`, so *every* file is stamped even when nothing collides. But `fs-file-storage.publish()` **already** probes with an exclusive `open(target,'wx')` and appends `-1`, `-2`, … on `EEXIST`. Passing `safeName` unchanged therefore delivers the owner's rule — clean names, suffix only on real collision — by *deleting* code, not adding it. The dedupe loop is reused verbatim at move time against `downloads/`.
- **Interpretation flagged:** the owner wrote *"only append when there is any duplicate name file present in the download folder"*. At upload time the file lands in `uploads/`, so the collision check there is against `uploads/`; at move time it is against `downloads/`. Both use the same helper. If the intent was instead "never disambiguate at upload, only at move", say so — it is a one-line difference.
- **Uniquifier shape:** keep `publish()`'s existing `name-1.ext` style rather than inventing a second scheme. One convention, already tested.
- **⚠️ The dedupe loop is unbounded, and its own comment says it is safe only because of the prefix this plan deletes.** `fs-file-storage.ts:54-57` reads *"Timestamp prefixes make collisions rare; still, rename() overwrites silently"* above `for (let attempt = 1; ; attempt += 1)` — no cap. With clean names, a folder holding `report.pdf … report-40.pdf` costs 41 `open()` syscalls on the *next* `report.pdf`, growing without limit in the upload hot path. **Cap the loop** (50 attempts) and fall back to a short random suffix (`report-a7f3.pdf`) beyond it. This is a pre-existing latent issue that this plan *activates* — call it out in the PR body so it reads as a deliberate fix.
- **⚠️ `publish()` can leave a zero-byte placeholder, which breaks this plan's own kill-test invariant.** It does `open(target,'wx')` → `close()` → `rename(tmp, target)`; a crash between the close and the rename leaves an **empty file** at the final name. Criterion 15 demands "never truncated", so the sequence must become crash-safe — reserve the name, then rename, and on startup sweep zero-byte files younger than the last clean shutdown, or restructure so the rename *is* the reservation. Also pre-existing, also activated here because 17b reuses this path for every move.

### Move (17b)

- **Move = publish into `downloads/` via the same tmp-then-rename discipline as upload.** Never copy directly into `downloads/` under the final name.
- **`fs.rename` across filesystems throws `EXDEV`.** `uploads/` and `downloads/` both live under `storage/` today, but every storage path is independently env-configurable, so they *can* land on different volumes. Implement rename with a **copy + fsync + unlink fallback**, and cover it with a test that forces the error path rather than trusting the happy path.
- **The half-copied-file problem is already solved** — `decisions.md:13` chose chokidar with `awaitWriteFinish` precisely to debounce partial files, so the watcher will not announce a `download.added` mid-copy. Worth stating so nobody re-solves it.
- **Move is not idempotent and the UI will race it.** A stale card (second tab, double tap, back button) can request a move for a file already moved or deleted. Routes answer **404** when the source is gone and **409** when a move for that name is already in flight; the client turns both into a card state, never a crash.
- **The card animation is a state machine, not a timeout.** `moving → moved → dismissing → gone`. The "you'll find this in Downloads" confirmation renders on `moved`, the swipe-out runs on `dismissing`, and removal happens on `animationend` — **not** on a `setTimeout` that can fire while the tab is backgrounded and desynchronise from the animation. `prefers-reduced-motion` skips straight to `gone` after a readable pause.

### The broadcast (17b)

- **New bus event `file.published`** → SSE, carrying `{ name, size, publishedAt, originDeviceId }`. Every other module already follows this bus→SSE shape; this adds no new mechanism.
- **⚠️ Two events now fire for one published file, and they race.** `file.published` is emitted the instant the rename completes, but chokidar is *also* watching `downloads/` and emits `download.added` **after** its `awaitWriteFinish` debounce. So the banner can appear seconds before the file shows up in the Downloads list — tap it immediately and the list is empty. Ownership must be explicit: **`file.published` owns the banner only; `download.added` remains the sole source of truth for the Downloads listing.** Nothing may banner on `download.added`, or every published file notifies twice. If the gap proves visible in live-verify, the fix is to delay the banner until the matching `download.added` arrives rather than to merge the events.
- **Excluding the uploader is a client-side filter, and that is fine.** SSE connections already carry a `deviceId` (`core/sse/index.ts:11`, from `?deviceId=`), so the payload includes `originDeviceId` and each client skips the banner when it matches its own. The event still *reaches* the uploader's browser — this is a UX nicety, not isolation, and must not be described as the latter. Two tabs on one device share a `deviceId`, so both correctly stay quiet.
- **⚠️ `originDeviceId: null` must show the banner to everyone, not suppress it for everyone.** `core/sse/index.ts:11` documents `deviceId` as *"null if the client didn't send one"*. A naive `originDeviceId === myDeviceId` check makes `null === null` true, so every client lacking a deviceId silently swallows the notification — the failure is invisible and looks like "notifications don't work sometimes". The filter is explicitly: **suppress only when both ids are non-null and equal.**
- **Bulk moves collapse.** Publishing 20 files fires 20 events; the banner uses a shared `dedupeKey` so it reads "20 files available for download", not twenty stacked banners.

### The other four actions (17b)

- **Rename** opens a modal (`core/ui/Modal.tsx` exists) with the current name pre-filled. The new name goes through `sanitizeFilename` — a name that sanitises to something different is shown back before saving, never silently altered. On collision the suffix is appended and **only the acting user** sees a notification saying so (a local `notify.info`, not the broadcast).
- **Delete is permanent and needs a confirm step** — there is no trash. The confirm dialog names the file.
- **Preview reuses the `previews` module's renderer, which today only reads `downloads/`** (`previews/module.ts:18` constructs `FsDownloadInspector(config.storage.downloads)`). Extending it to uploads means either a second inspector instance or a source parameter — decide at implementation, but keep the **realpath prefix check** that the download reader already enforces, or path traversal walks straight out of the folder.
- **⚠️ Inline SVG preview from `uploads/` is same-origin script execution.** `core/http/mime.ts:32-34` already guards HTML with an explicit comment — *"Never text/html: an inline-served page would run same-origin scripts"* — but line 14 maps `.svg` → `image/svg+xml`, and SVG carries `<script>`. Today that only exposes `downloads/`, which the **host** populates via Finder; `uploads/` is writable by **anyone on the LAN**, so extending inline preview there is a real step up in risk, and `UPLOAD_EXT_BLOCKLIST` covers only `.exe/.bat/.cmd/.msi`. Fix in the mime layer, not the blocklist: serve `.svg` from uploads as `text/plain`, or render previews inside a sandboxed frame. Applying it in `mime.ts` closes the same hole for `downloads/` at no extra cost.
- Actions are **disabled while a move is in flight** for that card, so delete-during-move cannot race.

## API contracts

| Method & path | Purpose |
| --- | --- |
| `POST /api/files/:storedName/publish` | Move `uploads/` → `downloads/`, dedupe on collision. 404 gone · 409 in flight · 200 `{ finalName, renamed }` |
| `PATCH /api/files/:storedName` | Rename within `uploads/`; body `{ name }`. 200 `{ finalName, renamed }` · 422 invalid |
| `DELETE /api/files/:storedName` | Permanent delete from `uploads/` |
| `GET /api/files/:storedName/preview` | Preview payload for an upload (mirrors the downloads preview contract) |
| SSE `file.published` | `{ name, size, publishedAt, originDeviceId }` → banner on every other device |

All four are **local profile only** — they inherit `file-transfer`'s existing exclusion from cloud.

## Tasks

### 17a — Notification system

- [x] `client/src/core/notify/`: store, `<NotificationHost/>`, imperative `notify` handle usable outside React
- [x] Mount once in `App.tsx` outside `<Routes>`; verify a notification survives a route change
- [x] Stack cap 4 + overflow count; `dedupeKey` collapsing with a repeat counter
- [x] **Per-kind cap so non-dismissing errors cannot deadlock the stack**: errors evict oldest-error-first, ≥1 slot reserved for transient kinds, "dismiss all" once >1 error is stacked
- [x] Auto-dismiss with visible progress + cross; **pause on hover/focus**; errors do not auto-dismiss
- [x] `prefers-reduced-motion` path; `aria-live` polite/assertive split; focusable, labelled dismiss button
- [x] Theme-aware styling using the existing token system — no hardcoded colours
- [x] **Real adoption:** route upload and download failures through `notify.error` (an owner requirement in its own right)
- [x] Unit tests: timer pause/resume, dedupe counter, stack cap, reduced-motion branch
- [x] `live-verify` + screenshots for the owner checkpoint
- [x] Update `.agent/memory/progress.md` in the 17a PR (`git.md` step 7)
- [ ] ⛔ **Stop. Owner approves UI + flow, and picks LAN-trust vs capability-token, before 17b starts**

### 17b — Send/Receive flow

- [ ] Drop the `${now()}-` prefix in `upload-files.ts`; extract `publish()`'s EEXIST dedupe loop into a shared helper used by both upload and move
- [ ] **Cap the dedupe loop** at 50 attempts → short random suffix beyond it; it is currently unbounded and only safe because of the prefix being removed
- [ ] **Make name reservation crash-safe** so `open(wx)` + `rename` can no longer strand a zero-byte placeholder (criterion 15 depends on it)
- [ ] **`.svg` served from uploads must not be `image/svg+xml`** — fix in `core/http/mime.ts` (closes the same hole for `downloads/`) or sandbox the preview frame
- [ ] `PublishUploadUseCase`: tmp → rename with **EXDEV copy+unlink fallback**, dedupe against `downloads/`, emit `file.published`
- [ ] Rename / delete / preview usecases + routes; realpath prefix check on every one
- [ ] `file.published` in `core/bus/events.ts` → SSE broadcast in `file-transfer/module.ts`
- [ ] Card actions on `UploadPage`: Move · Preview · Rename · Delete, disabled while a move is in flight
- [ ] Rename modal with sanitisation preview; collision → suffix + local notification
- [ ] Delete confirm dialog naming the file
- [ ] Card state machine `moving → moved → dismissing → gone`, removal on `animationend`, reduced-motion path
- [ ] Client subscribes to `file.published` for the **banner only** — `download.added` stays the sole source for the Downloads listing, and nothing banners on it (or every file notifies twice)
- [ ] Self-filter suppresses **only when both device ids are non-null and equal**; a `null` origin shows to everyone
- [ ] Shared `dedupeKey` so a bulk move collapses to one banner
- [ ] Update the Send page copy — it currently promises a write-only vault
- [ ] **Drop `upload_audit`** via the `db-migration` skill: delete the table, `DbUploadAuditRepository`, `UploadAuditRepository`, `UploadRecord`, `UploadAuditRecorder`, and `ListUploadsUseCase`. Verify on **both an upgraded and a fresh DB**
- [ ] Repoint `GetStatsUseCase`'s `uploads.total` / `uploads.today` / `activity[]` at `audit_events`, with a comment that `audit-log` owns the table
- [ ] Rebuild Heimdall → Uploads as a **filesystem listing** — a new `ListUploadFilesUseCase` over the shared `core` directory walker (PLAN-16 lifts it there), returning name · size · mtime; retitle it away from "everything that has been sent"
- [ ] **Dot-file filtering belongs in that shared walker, not the listing** — `fs-stats-reader` counts `.DS_Store` toward storage totals too (6.0 KB in the owner's screenshot). One helper, both call sites
- [ ] Keep the Send page queue in plain component state — it must vanish on refresh; no `sessionStorage`
- [ ] `.env.example:22`: correct the blocklist comment now that uploads can be served
- [ ] `architecture.md:20` + `decisions.md`: log the supersession of the write-only and metadata-only decisions with reasoning
- [ ] `context-sync`; update `.agent/memory/progress.md` (`git.md` step 7); archive this plan file

## Acceptance criteria

Criteria **6, 7, 11, 21, 22** gate **17a** — they are its definition of done for the owner checkpoint. The rest gate **17b**.

1. A file uploaded with no name clash lands as `report.pdf` — **no timestamp**. A second `report.pdf` lands as `report-1.pdf`.
2. Moving publishes to `downloads/`; a name already there gets the same `-1` treatment, and the response reports `renamed: true` so the UI can say so.
3. After a move the card shows the confirmation, swipes out, and is removed — with the tab **backgrounded during the animation**, it still removes correctly on return (proves no `setTimeout` desync).
4. Every other device shows a top-right banner naming the file; **the uploader's own device does not**, including a second tab on that device.
5. Moving 20 files at once produces **one** collapsed banner, not 20.
6. Banner auto-dismisses on its timer, the cross dismisses early, and **hovering pauses it**; an error banner does not auto-dismiss at all.
7. A notification raised on one page is still visible after navigating to another.
8. Rename to an existing name appends the suffix and notifies **only the acting user**; a name that sanitises differently is shown back before saving.
9. Delete asks for confirmation, then the file is gone from `uploads/` and the card disappears.
10. Preview renders for an upload without exposing anything outside `uploads/` — a traversal attempt in `:storedName` is rejected.
11. Upload and download failures surface as error banners.
12. **Stale-card matrix:** move-then-move → 409; move-then-delete → 404; both render as card state, never an unhandled rejection.
13. **Forced `EXDEV`** (uploads and downloads on different volumes) still completes the move via the copy fallback, leaving no partial file behind.
14. `prefers-reduced-motion` removes the swipe and slide animations while every state still resolves.
15. Kill test: `SIGTERM` mid-move leaves the file **either** fully in `uploads/` **or** fully in `downloads/` — never both, never neither, never truncated.
16. The Send page no longer claims uploads cannot be read back, and `decisions.md` records the supersession.
17. Heimdall → Uploads lists **exactly** what is in `storage/uploads/` — no ghost rows for deleted files, and **no `.DS_Store`**. Deleting a file outside the app and reloading reflects it immediately.
18. `uploads.total`, `uploads.today`, and the activity sparkline still render, now sourced from `audit_events`, and match what History reports.
19. A DB carrying `upload_audit` upgrades cleanly with the table gone; a fresh DB never creates it. Both verified per the `db-migration` skill.
20. Uploading, then refreshing the Send page, leaves an **empty queue** while the files remain in `storage/uploads/` — the list is state, not storage.
21. **(17a)** Four undismissed errors do **not** hide a subsequent success notification — the reserved slot and per-kind eviction hold, and "dismiss all" clears them.
22. **(17a)** A notification raised from a client with **no `deviceId`** is still shown; suppression happens only when both ids are non-null and equal.
23. A folder already holding `report.pdf` through `report-49.pdf` accepts a 51st upload **without an unbounded scan**, falling back to a random suffix.
24. `SIGTERM` between name reservation and rename leaves **no zero-byte file** in `uploads/` or `downloads/` (the sharper form of criterion 15).
25. An uploaded `.svg` containing `<script>` does **not** execute when previewed — served as inert content or sandboxed.
26. The banner never fires twice for one file, and the Downloads listing still updates from `download.added` alone.
27. Storage totals and the Uploads listing **both** exclude dot-files — `.DS_Store` is absent from each, not just the listing.

## Tests

- [ ] Unit: dedupe helper (no clash → clean name; clash → `-1`, `-2`; extension preserved), sanitise-on-rename corpus
- [ ] Unit: notification store — timer pause/resume, dedupe counter, stack cap, dismissal ordering, **per-kind eviction under 4 stacked errors**, **null-deviceId shows rather than suppresses**
- [ ] Unit: dedupe helper caps its attempts and falls back to a random suffix — assert the loop cannot run unbounded
- [ ] Integration: `.svg` from uploads is not served as `image/svg+xml`
- [ ] Integration: publish/rename/delete/preview happy paths + 404/409/422 matrix + traversal rejection
- [ ] Integration: `EXDEV` forced via a mocked `rename` → copy fallback path
- [ ] Integration: `file.published` reaches SSE with `originDeviceId` intact
- [ ] Kill test: `SIGTERM` mid-move, asserted against the "exactly one location" invariant
- [ ] Client: card state machine transitions; `originDeviceId` self-filter; reduced-motion branch
- [ ] Migration: upgraded DB (with rows) and fresh DB both end without `upload_audit`; stats usecase returns the same figures from `audit_events` before and after
- [ ] Integration: Heimdall uploads listing reflects a file deleted from disk out-of-band, and excludes dot-files
- [ ] Live-verify: two browsers (one phone on the LAN), move a file, confirm the banner appears on one and not the other
