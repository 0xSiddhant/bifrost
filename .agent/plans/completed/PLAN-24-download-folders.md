# PLAN-24 — Download folders (folder uploads, browsing, zip download)

## Goal

Downloads stops being a single flat folder. A sender can upload straight into a named folder (created automatically if it doesn't exist yet); that folder and its contents are **instantly live for everyone** — no staging, no Move tap, matching the plain-file Send flow's staging model only when *no* folder is chosen. The Receive page shows root-level items (files and folders, exactly as today plus folder rows) and, inside a folder, its files — one level deep, no folders-within-folders. A folder page offers **Download folder as .zip**, streamed on demand.

## Gate

PLAN-23 merged. Single PR, no parts — the surgery is real but confined to one already-mature module (`file-transfer`) with no new module, no DB migration, and no cross-cutting UI system to build first (unlike PLAN-17a's notification-system prerequisite).

## Scope

**In:**
- `POST /api/files?folder=<name>` — files upload straight into `downloads/<name>/`, creating the folder if missing, skipping `uploads/` staging entirely.
- `DownloadEntry` gains `type: 'file' | 'folder'` and `parent: string | null`; the downloads watcher recurses **exactly one level**.
- `GET /api/downloads` keeps returning one flat, SSE-synced list — root files, folder rows, and each folder's files, all in one array — the client filters by `parent` for whichever view is open. No second listing endpoint.
- `GET /api/downloads/:id/archive` — a folder id streams a zip of that folder's files (`archiver`, no full-buffer in memory).
- Client: a folder destination picker on Send (type a new name or pick an existing one); a folder row + child folder page on Receive; a zip-download button on the folder page.
- Existing plain-file Send flow (`uploads/` staging, Move/Rename/Delete/Preview) is **completely unchanged** when no folder is chosen.

**Out (explicitly, so it isn't rediscovered mid-implementation):**
- Nesting beyond one level. A folder created inside a folder via Finder simply isn't traversed — chokidar's own `depth: 1` makes this a structural non-event rather than something the app has to detect and reject.
- Any delete/rename/move action on folders or on individual files already in `downloads/` — Receive stays read-only, exactly as it is today; only Finder can remove a folder.
- Moving an *already-staged* upload into a folder (extending PLAN-17b's Move action). Folder is a destination chosen at upload time only.
- A standalone "New folder" button on the Receive page. A folder is created only by naming it as an upload destination (owner decision, this session).
- Multi-select / whole-library zip (PLAN-99's older "Download-all-as-zip" idea). This plan only adds **one folder → one zip**; the broader backlog item stays open.

## Decisions & reasoning

### This plan supersedes a logged decision — say so out loud

`decisions.md` (2026-07-12): *"chokidar with `awaitWriteFinish` for `downloads/` watch"* — the same entry, and `architecture.md`'s watcher comment (*"depth 0 keeps the listing flat — subfolders are out of scope"*), both describe a deliberately flat store. This plan deliberately reverses the depth choice, the same way PLAN-17b reversed the write-only decision: logged as a supersession, not silent drift.

### Folder uploads skip staging entirely

The owner's framing — *"it will be default available for download"* — and the confirmed answer this session both point the same way: a folder upload is not a Send-page staging action, it is closer to "the app writes into `downloads/` instead of Finder doing it." Concretely:

- `POST /api/files?folder=<name>` streams straight to `downloads/<name>/` via the same tmp-file-then-`placeFile` discipline every other write in this module uses (`writeTmp` → dedupe-safe hard-link → `chmod 0644` → discard tmp). **No new crash-safety mechanism is needed** — `placeFile`'s link-then-no-window guarantee and `MAX_DEDUPE_ATTEMPTS` cap are inherited unchanged.
- The plain Send flow (no `folder` param) is **byte-for-byte unchanged**: still lands in `uploads/`, still needs an explicit Move. The two flows share `sanitizeFilename` and `UploadFilesUseCase`'s per-file validation (size cap, extension blocklist) but diverge only in where the accepted bytes are finally placed.
- **No undo.** A folder upload has no staging card, no Rename/Delete-before-publish. This is the explicit trade the "skip staging" answer makes; flagging it here so a later reviewer doesn't read its absence as an oversight.

### A new, narrow port — not a graft onto `FileStorageRepository` or `UploadsStore`

`FileStorageRepository`'s own doc comment says *"Uploads-side storage"*; `UploadsStore`'s methods all take a name **already resident in `uploads/`** (rename/delete/publish-by-moving an existing file), not a fresh tmp path. Neither shape fits "place a brand-new tmp file into a possibly-new folder under `downloads/`." A third, single-method port avoids blurring either contract:

```ts
export interface FolderPublisher {
  /** Creates `folder` at the top level of downloads/ if missing, then hard-links
   *  the tmp file into it under `desiredName`, deduping on collision via the
   *  same placeFile() helper every other write uses. Rejects if `folder`
   *  already names something that isn't a directory. */
  publish(tmpPath: string, folder: string, desiredName: string): Promise<{ finalName: string; folder: string }>;
}
```

`services/fs-folder-publisher.ts` (`FsFolderPublisher`) implements it, constructed with `downloadsDir` alone. `UploadFilesUseCase` gains an **optional** constructor dep `folderPublisher?: FolderPublisher`, used only when the caller passes `context.folder`. `FileStorageRepository`/`FsFileStorageRepository` and every test that constructs them **stay untouched**.

**`mkdir` vs. an existing entry:** `fsp.mkdir(dir, { recursive: false })` throws `EEXIST` both when the folder already exists (fine, reuse it) and when a *file* of that exact name already exists (a real conflict — you cannot have `downloads/Photos` be both a file and a directory). `FsFolderPublisher` distinguishes the two with a `stat` after the `EEXIST`: a directory is silently reused, anything else is rejected with a clear 409-mapped error (`"Photos" is a file, not a folder`) rather than mkdir's opaque `EEXIST` reaching the client. **This also closes the concurrent-create race for free:** two devices sending files to the same brand-new folder name at nearly the same instant race the `mkdir` itself, one wins and one gets `EEXIST` — but the loser's follow-up `stat` finds a directory either way, so both requests reuse it and neither errors. The logic doesn't need to know or care which case it's in.

**Folder names are silently sanitized and reported back, not hard-rejected.** This mirrors how a plain upload's *filename* is already silently sanitized today (`UploadFilesUseCase.execute` calls `sanitizeFilename(file.name)` unconditionally, no round-trip) — **not** PLAN-17b's stricter rename rule (*"never silently alter a name someone typed"*), because a folder name typed into the picker is closer to an incidental upload detail than to an explicit rename target. The response's `accepted[].folder` reports the actual folder used; the client shows it if it differs from what was typed, the same soft-feedback shape Rename already uses for collision suffixes.

**Not atomic across the pair, and that's fine.** A crash between `mkdir` succeeding and the first `placeFile` completing leaves an **empty folder** with no file in it. That's a benign state — not a partial or zero-byte file, just an empty directory a person can delete in Finder if they ever notice it — so no boot-sweep reconciliation is added for it, unlike the real hazard `sweepPublishedDuplicates` exists for.

### Listing stays one flat, SSE-synced feed — no second endpoint

`DownloadEntry` gains two fields:

```ts
export interface DownloadEntry {
  id: string;
  name: string;
  size: number;      // folders: 0 — the client sums matching children's sizes, so the figure is never a second source of truth
  mtime: number;      // folders: the directory's own mtime (APFS updates it when its contents change — no per-child aggregation needed)
  ext: string;        // folders: ''
  type: 'file' | 'folder';
  /** Folder name this entry lives in, or null at the root. Folders are always root — one level of nesting, so a folder's own `parent` is always null. */
  parent: string | null;
}
```

`GET /api/downloads` and the three SSE events (`download.added` / `.changed` / `.removed`) are **unchanged in shape** — every existing consumer that only reads `id`/`name`/`size`/`mtime`/`ext` keeps compiling; `type` and `parent` are additive. `useDownloads.ts` needs **zero changes** — it already just accumulates whatever the feed sends. `DownloadsPage` filters `parent === null` for the root view; a new folder page filters `parent === folder.name`. One fetch, one SSE subscription, two views — not two hooks, avoiding a second live-sync mechanism for what is, at household LAN scale, a feed of tens to a few hundred entries (the same bound Pensieve's design already accepted).

**Why not pre-aggregate folder size/count server-side:** it would be a second source of truth that has to stay consistent with the same per-file add/remove events the client already receives; deriving it client-side from the one feed can't drift.

### The watcher: `depth: 0` → `depth: 1`, plus directory events

`DownloadWatcherService` moves from `depth: 0` to `depth: 1` — chokidar's own depth limit is what enforces "one level only" structurally, not application code checking a path's segment count. At `depth: 1` chokidar also traverses (but does not further recurse into) the immediate contents of first-level subdirectories, and emits `addDir`/`unlinkDir` for those subdirectories themselves. Two new handlers are added alongside the existing `add`/`change`/`unlink`:

- `addDir` → upsert a `type: 'folder'` entry, **skipping the root `downloads/` directory's own initial `addDir`** (chokidar fires one for the watched root itself).
- `unlinkDir` → remove that folder's entry. Chokidar already fires per-file `unlink` for a directory's contents when the directory itself is removed (standard behavior on `rm -rf`), so no cascade code is needed — the existing `remove()` handler cleans up the child file entries on its own as those events land, in whatever order they arrive.
- The existing per-file `upsert()` gains `parent`: `path.dirname(file) === downloadsDir ? null : path.basename(path.dirname(file))`.
- The dot-file `ignored` predicate extends to directories too (a `.trash`-style folder, or the `.bifrost-inflight-*` staging prefix `placeFile`'s EXDEV fallback already uses) — today it only tests `stats?.isFile()`.

**Folder rename/delete via Finder needs no special-case code.** Chokidar reports a Finder rename as `unlinkDir(old)` + `addDir(new)` + the matching per-child `unlink`/`add` pairs — the same shape a file rename already produces, handled by code that already exists.

### Zip download: `GET /api/downloads/:id/archive`, not a separate `/folder/` path

The id already resolves to a `DownloadEntry` with `type`; a second path segment encoding "this is a folder" would be redundant with the id's own resolved kind, and this keeps the family symmetric with `/:id/content` (bytes) → `/:id/archive` (zip, valid only when the resolved entry's `type` is `'folder'`; a file id here is a clean 400, not a coerced empty zip).

- **New dependency: `archiver`** (`server/package.json`), not the `zip` CLI `core/backup` already shells out to via `spawnSync`. Backup's zip is a rare, synchronous, whole-process operation; a folder-download can be requested by several devices at once, on demand, for folders that may hold large media — `archiver` streams incrementally into the HTTP response with no full-archive buffering and no blocking `spawnSync` call in the request path. Logged as a new tech-stack entry.
- `DownloadRegistry` replaces `resolveName(id)` with `resolveEntry(id): DownloadEntry | null` — one richer lookup serving both existing content-serving (`GetDownloadStreamUseCase` derives the relative path as `entry.parent ? \`${entry.parent}/${entry.name}\` : entry.name`) and the new archive path (needs `entry.type` and `entry.name` directly). `FsDownloadReader.confine()` needs **no change** — `path.join(downloadsDir, 'Photos/img.jpg')` plus the existing realpath-prefix check already generalizes to one level of nesting for free.
- **The realpath check and the `archiver` wiring both belong in the service layer — not the usecase, and not the route.** `coding.md`'s layering rule is explicit: usecases never touch `fs` directly, and a route stays HTTP-only. So the confine-check joins `DownloadReader` as a new method, and the archiver mechanics get their own small service, exactly mirroring how `respondWithFile` already stays fs-free by only ever receiving a ready `DownloadContent` (stream + size) from a usecase:
  - `DownloadReader` gains `confineFolder(name: string): Promise<string>` — the same realpath-prefix pattern `confine()` already runs, asserting `isDirectory()` instead of `isFile()`. Implemented by reusing `FsDownloadReader`'s existing private `confine()`.
  - A new port `FolderArchiver` + `services/fs-folder-archiver.ts` (`FsFolderArchiver`): `stream(folderPath: string, files: string[]): Readable` builds the `archiver('zip')` instance, calls `archive.file(path.join(folderPath, name), { name })` per entry **(never `archive.directory()`** — the explicit per-file list is what keeps a two-levels-deep Finder addition, which the watcher never indexed, from silently riding along into the zip), wires `archive.on('warning', …)` to log-and-continue (a file deleted mid-zip) and `archive.on('error', …)` to log and forward onto the returned stream's own `'error'` event, and calls `finalize()`. This is where `path`/`fs` knowledge and the `archiver` dependency actually live.
  - `usecases/archive-folder.ts` (`ArchiveFolderUseCase`) depends on `DownloadRegistry` (existing) + `DownloadReader` (its new method) + `FolderArchiver` — it 404s an unknown id, 400s a `type !== 'folder'` entry, calls `reader.confineFolder(entry.name)` for the safe absolute path, filters `registry.list()` for `parent === entry.name` to get the current file names, and returns `{ stream, zipName: \`${entry.name}.zip\` }` — a stream-plus-name shape, deliberately matching `GetDownloadStreamUseCase.open()`'s existing `{ ...content, name }`. The route only ever sees this pair, sets headers (`content-type: application/zip`, `content-disposition` via the existing `dispositionFilename` helper — **no `content-length`**, since a streamed zip's final size isn't known until `finalize()` completes, so the response is chunked like any other generated-on-the-fly stream), and pipes it into `reply.send()`. No absolute path and no `archiver` object ever reaches route code.
  - **`resolve()` also protects `/:id/content`, not just `/:id/archive`.** Once `resolveEntry` can return a folder, `GetDownloadStreamUseCase.resolve()`/`.open()` check `entry.type !== 'file'` up front and 404 explicitly — today a folder id passed to `/content` would *accidentally* end up 404 anyway (`FsDownloadReader.stat()`'s existing `isFile()` assertion throws, caught by the generic error path), but relying on an assertion in a different layer to produce the right error for a different-shaped request is fragile, not a design; making it explicit is one `if`.
  - The same "snapshot, not a guarantee" reasoning applies in the read direction: the file list `ArchiveFolderUseCase` gathers is current as of request time — a file that lands mid-zip just isn't in it, which is ordinary eventual consistency, not a bug to guard against. An empty folder (zero matching entries) produces a valid, empty zip rather than an error — no special-casing needed.
- No new rate limiting: `file-transfer` is local-profile only and the LAN-trust decision (PLAN-17b) already accepts that anyone reachable on the network can read every downloadable byte; a zip stream doesn't change that trust boundary, only the packaging.

### Previews must learn to look one level down too

`FsDownloadInspector.findNameById` (previews module, `services/fs-file-inspector.ts`) does its own **on-demand flat `readdir`** over `downloads/` to resolve an id back to a name — a deliberate independence from file-transfer's registry (decisions.md, 2026-07-14: *"keeps module isolation intact — ids are deterministic, so both modules derive the same id without talking"*). That independence is worth keeping, but the scan itself needs to walk one level of subdirectories (skipping dot-prefixed ones) and test `downloadIdFor(\`${dirName}/${childName}\`)` the same way the watcher now does, or a file inside a folder can never be previewed. `confine()` needs no change — same reasoning as `FsDownloadReader` above.

### Receive: a folder's zip is reachable two ways — a direct icon on the root row, and an explicit button once inside

Owner requirement, this session: zip download must work **from outside the folder** (the root list, no navigation) as a default one-click action, *and* **from inside it** (after navigating in) as an explicit button. Both hit the exact same `GET /api/downloads/:id/archive` — this is a client placement decision, not a second backend mechanism:

- **Root list, folder row:** mirrors `FileRow`'s existing Preview+Download icon pair rather than inventing a new interaction. A folder row gets its own **Download-as-.zip icon** (same visual language as a file row's Download icon) as the direct, no-navigation action; the row's body/name is the separate, existing "open" affordance that navigates to `/downloads/folder/:id`. Two icons, two unambiguous actions — not one icon doing double duty depending on where you tap.
- **Folder page:** a prominent **"Download folder as .zip"** button/CTA is the explicit, always-visible action once you're already looking at the folder's contents — useful precisely because you're there anyway and may only now decide you want everything, not just the one file you opened it for.
- **Per-file download stays exactly as it is today, at both levels.** A file's own Preview+Download icons are unchanged whether it sits at the root or inside a folder — this plan adds a *folder-level* zip option, it does not touch or replace individual-file download in any way.

### Folder-name resolution: append, never duplicate — worth restating plainly

This is already what `FolderPublisher.publish` above does, restated here because it is a hard requirement, not an implementation detail: **a folder name that already exists on disk is reused — its files gain a new sibling, the folder's own identity (and every file already in it) is untouched.** A folder name that does not exist yet is created once, atomically via `mkdir`. There is no code path that creates a second folder for a name that already resolves to a directory; the only way to get two folders is two different names (including two names that sanitize differently — see below). `sanitizeFilename`'s existing NFC-normalization keeps a typed name and an existing folder's stored name comparing equal across trivial unicode variation; it does **not** collapse doubled internal spaces or other non-separator differences, the same accepted precedent as ordinary file-name collisions today (`"Vacation  Photos"` and `"Vacation Photos"` are, correctly, two different names) — flagged so it isn't rediscovered as a bug later.

### Client: reuse the existing staged-upload state machine, don't invent a second one

A folder-mode queue item never needs the `done` (awaiting Move) state — it goes `queued → uploading → moved` directly, landing on the **same** `moved` terminal state, confirmation copy, swipe-out animation, and `animationend`-driven removal the Move flow already has (`UploadPage.tsx`'s `ItemStatus` machine). Concretely: a new `uploadFileToFolder(file, folder, onProgress)` in `features/file-transfer/api.ts` mirrors `uploadFile()` (same XHR/FormData/progress mechanics, `folder` riding the query string) but resolves `{ finalName, folder }`; `begin()` branches on whether a folder destination is active and calls the matching upload function, and on success sets `status: 'moved'` immediately (skipping `done`/`moving`) instead of `status: 'done'`. This is a small branch inside existing code, not a parallel flow.

**Folder destination picker:** a free-text field with a `<datalist>` of existing folder names (drawn from the same `entries` feed `useDownloads` already fetches, filtered to `type === 'folder'`) — new name or existing name, one control, no new dropdown component. When no folder is set, the page behaves exactly as it does today.

**The adjustment is surfaced after the fact, not previewed before submitting — this correction matters, so it's worth being explicit.** An earlier pass of this plan described *both* "silently sanitized, not hard-rejected" (the Decisions section above) *and* "sanitize-preview feedback before the upload starts, mirroring Rename's never-silently-alter rule" (this section) — two different flows that can't both be true. A live pre-submit preview would need the sanitizer's own regex logic mirrored into the client, and `server/` and `client/` are separate npm workspaces with no shared package between them — duplicating a security-relevant string sanitizer across two trees, kept in sync by hand, is exactly the kind of drift this codebase avoids elsewhere (`core/xml`/`core/yaml` are deliberately client-only single-source concepts for the same reason). The corrected design instead reuses a pattern **already shipped**: PLAN-17b's Rename collision suffix is never previewed either — it happens, and *only the acting user* is told via a local `notify.info` afterward. Folder-name adjustment follows the identical shape: the upload proceeds regardless, and if `accepted[].folder` differs from what was typed, the client fires one local notification (`notify.info`, dedupe-keyed on the typed name) naming the folder actually used — once per batch, since every file in one folder-mode upload shares the same destination and would otherwise fire the identical notice N times.

### Client: banner reuses `file.published`, doesn't invent a second notification path

`FilePublishedEvent` gains an optional `folder?: string`. `UploadFilesUseCase`'s folder branch emits `file.published` (banner) *in addition to* the existing `file.uploaded` (audit trail — the file did, after all, get uploaded) exactly as the Move flow already does both. `usePublishedBanner.ts`'s message branches on `event.folder` (*"12 files added to Vacation Photos"* vs. today's *"12 files are ready in Receive"*), and its dedupe key becomes `file-published:${folder ?? 'root'}` so a folder-upload wave and a concurrent plain Move don't collapse into one confusing count — everything else (self-filter on `originDeviceId`, the null-origin-shows-to-everyone rule, the pending counter reset on dismiss) is inherited unchanged.

**Two audit lines per folder upload is expected, not a bug.** `file.uploaded` logs *"uploaded X"*; the watcher's own `download.added` (firing because the file now genuinely exists in `downloads/`, regardless of who wrote it) logs *"download available: X"* a moment later. This is the *exact* double-line shape a staged-then-Moved file already produces today — noted here so it isn't mistaken for new duplication.

### No `RESERVED_ROOTS` change

The client's new folder page is `/downloads/folder/:folderId` — a nested/param route under the already-reserved `downloads` root (the rule in `rules/coding.md` explicitly exempts these: *"Nested/param routes under an already-reserved root… need no entry — only new first segments do"*). The server's new route sits under the already-reserved `/api/` prefix. Checked, not skipped.

### No DB migration

Everything here is filesystem state, an in-memory watcher registry, and bus events — no new table, no schema change. The `db-migration` skill is not needed for this plan.

## API contracts

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/files?folder=<name>` | Upload straight into `downloads/<name>/`, creating it if missing | Same multipart body as today; `folder` querystring is the only addition. 201 → `{ accepted: [{ name, storedName, size, folder }], rejected: [...] }` (folder present only in this mode). 409 if `folder` names an existing non-directory |
| `GET /api/downloads` | Root + folder + nested-file listing, one flat array | `DownloadEntry[]` now carries `type` and `parent`; unchanged sort (mtime desc), unchanged SSE events |
| `GET /api/downloads/:id/archive` | Zip of a folder's files | 400 if the id resolves to a file, not a folder; streamed, `content-type: application/zip` |
| SSE `download.added` / `.changed` / `.removed` | Unchanged shape, now sometimes describing a folder (`type: 'folder'`) or a nested file (`parent` set) | |
| SSE `file.published` | Gains optional `folder` | Banner text and dedupe key branch on its presence |

## Task checklist

**Server**
- [ ] `core/bus/events.ts`: `DownloadEntry` gains `type`/`parent`; `FilePublishedEvent` gains `folder?`
- [ ] `modules/file-transfer/ports.ts`: new `FolderPublisher` interface; `DownloadRegistry.resolveName` → `resolveEntry(id): DownloadEntry | null`; `DownloadReader` gains `confineFolder(name): Promise<string>`; new `FolderArchiver` interface (`stream(folderPath, files): Readable`)
- [ ] `services/download-watcher.ts`: `depth: 1`, `addDir`/`unlinkDir` handlers (skip the watched root's own `addDir`), `parent` on file upserts, dot-prefix filter extended to directories
- [ ] `services/fs-folder-publisher.ts` (new): `FsFolderPublisher` — `mkdir` (EEXIST → stat → reuse-if-dir / reject-if-file), `placeFile` into it, `chmod 0644`, discard tmp
- [ ] `usecases/upload-files.ts`: optional `folderPublisher` dep; `context.folder?: string`; folder branch sanitizes the name (silent, reported back), calls `FolderPublisher.publish`, emits `file.uploaded` **and** `file.published` (`folder` set, `originDeviceId` from `x-bifrost-device`)
- [ ] `services/fs-folder-archiver.ts` (new): `FsFolderArchiver` — owns the `archiver('zip')`/`path`/`fs` wiring, `warning`/`error` handling; the only place `archiver` is imported outside `module.ts`'s construction
- [ ] `usecases/archive-folder.ts` (new): `ArchiveFolderUseCase` — resolve id → 404 unknown / 400 not-a-folder, `reader.confineFolder(name)` for the safe path (never raw `fs`), filter the registry for children, return `{ stream, zipName }` — no filesystem path ever reaches the route
- [ ] `usecases/get-download-stream.ts`: adapt to `resolveEntry`; explicit `entry.type !== 'file'` → 404, not an incidental fallthrough
- [ ] `usecases/list-downloads.ts`: unaffected (still sorts the full registry) — confirm with a test rather than assume
- [ ] `routes/files.ts`: read `?folder=`, schema-validate it (same illegal-character pattern as upload names), thread through `x-bifrost-device`
- [ ] `routes/downloads.ts`: `GET /api/downloads/:id/archive` — headers only (`content-type`, `content-disposition` via `dispositionFilename`, no `content-length`), pipes the usecase's stream into `reply.send()`
- [ ] `module.ts`: construct `FsFolderPublisher` and `FsFolderArchiver`, wire both into their usecases
- [ ] `server/package.json`: add `archiver` (+ types if not bundled)
- [ ] `modules/previews/services/fs-file-inspector.ts`: `FsDownloadInspector.findNameById` walks one level of subdirectories

**Client**
- [ ] `core/api.ts`: `DownloadEntry` gains `type`/`parent`
- [ ] `features/file-transfer/api.ts`: `uploadFileToFolder(file, folder, onProgress)`; `folderArchiveUrl(id)`
- [ ] `UploadPage.tsx`: folder destination field (`<datalist>` from existing folder names in the live feed); `begin()` branches to the folder upload path; folder-mode items skip `done`, land straight on `moved`; if the resolved `folder` differs from what was typed, one local `notify.info` per batch (dedupe-keyed on the typed name) — never a pre-submit preview
- [ ] `DownloadsPage.tsx`: filter to `parent === null`; render folder rows (icon, name, aggregate count/size computed from the same `entries`, mtime) alongside file rows; the row body navigates to `/downloads/folder/:id`; the row's aside gets its **own Download-as-.zip icon** (mirrors `FileRow`'s existing Preview+Download pair) so a zip needs no navigation
- [ ] New `DownloadFolderPage.tsx` (or equivalent): breadcrumb, files with `parent === folder.name` each keeping their normal Preview+Download icons, a prominent **"Download folder as .zip"** button/link (same endpoint the root row's icon calls), its own nested preview-modal route reusing `PreviewModal`
- [ ] `App.tsx`: `/downloads/folder/:folderId` route
- [ ] `app/usePublishedBanner.ts`: branch message + dedupe key on `event.folder`
- [ ] `useDownloads.ts`: confirm it needs literally no change (additive fields only) — pin with a test rather than assume

**Docs**
- [ ] `architecture.md`: module registry row for `file-transfer`; "Live download" data-flow paragraph; watcher depth comment
- [ ] `tech-stack.md`: add `archiver` row
- [ ] `decisions.md`: log the depth-0 supersession + the design calls above, dated
- [ ] `context-sync` pass once implemented; update `.agent/memory/progress.md` (`git.md` step 7); archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. Uploading with no folder chosen behaves **exactly** as today — lands in `uploads/`, needs Move, nothing about this plan changes that path.
2. Uploading with a new folder name creates `downloads/<name>/` **once** and the file lands inside it, live in Receive within the SSE round-trip, with **no** staging card and no Move step.
3. Uploading into a folder name that already exists on disk **appends** the file to that folder — no second, duplicate folder is ever created, and every file already there is untouched. A within-folder name collision gets the same `-1` suffix treatment root uploads already use.
4. A folder name that would sanitize differently is **never blocked** — the upload proceeds, and the sender (only) sees one local notification naming the folder actually used, once per batch rather than once per file. There is no pre-submit preview.
5. Attempting to upload into a name that already exists as a plain root **file** (not a folder) is rejected with a clear error, not a mangled mkdir failure.
6. Two devices sending files to the same brand-new folder name at nearly the same time both succeed — one wins the `mkdir` race, the other reuses the directory it just created; neither errors and no duplicate folder results.
7. Receive's root view shows files and folders together; opening a folder shows only that folder's files, with a working "back to Receive" path.
8. A folder created directly in Finder (with files dropped into it one level deep) appears in Receive with no app interaction — the existing Finder-drop story, now folder-aware.
9. A file placed **two levels deep** via Finder does not appear anywhere in the app — silently absent, not an error, matching the one-level-only scope.
10. "Download folder as .zip" produces a zip containing exactly that folder's current files, correctly named inside the archive, server memory stays flat while streaming a folder of large files (verify RSS, mirroring PLAN-02's criterion 2 for uploads). An empty folder produces a valid, empty zip rather than an error.
11. A folder's zip is reachable **two ways**, both producing the identical archive: a direct download icon on its row in the **root** list (no navigation required), and the explicit "Download folder as .zip" button once **inside** the folder page.
12. Individual file download (and preview) keeps working unchanged, both for root files and for files inside a folder — this plan only adds a folder-level zip option alongside it, never in place of it.
13. Requesting `/archive` on a **file** id (not a folder) is a clean 400, not a wrong or empty zip; requesting `/content` on a **folder** id is a clean 404, not an incidental one.
14. A traversal attempt against a folder id's resolved path — same corpus PLAN-02 already exercises for downloads — never escapes `downloads/`.
15. Every other device gets a banner naming the folder when files land in it; the uploader's own device does not (same origin-suppression rule as PLAN-17b, including the null-origin-shows-to-everyone case).
16. A bulk folder upload (10+ files) collapses to **one** banner for that folder, not one per file, and doesn't merge with an unrelated concurrent plain-file Move's banner.
17. Deleting a folder's last file via Finder, then the folder itself, removes both from Receive with no orphaned entries — verified by watching the SSE stream, not just the eventual listing.
18. Kill test: `SIGKILL` mid folder-upload leaves no partial or zero-byte file in `downloads/<folder>/`, and at worst an empty folder — never a corrupt one.
19. Existing per-file preview/download actions on files still work identically for root files; the same actions work for files inside a folder (id resolution now walks one level for previews too).
20. `architecture.md` and `decisions.md` no longer describe the downloads watcher as flat/depth-0 without qualification.
21. No route, usecase, or service imports `archiver` or touches a raw filesystem path outside `services/` — `ArchiveFolderUseCase` and the `/archive` route only ever handle a stream and a name.

## Test checklist

- [ ] Unit: `FsFolderPublisher` — creates a missing folder, reuses an existing directory, rejects a same-named existing file, dedupes on collision via `placeFile`
- [ ] Unit: `DownloadWatcherService` — `addDir`/`unlinkDir` produce correct `type`/`parent`; root's own initial `addDir` is skipped; dot-prefixed directories are ignored; a file two levels deep is never registered
- [ ] Unit: `UploadFilesUseCase` folder branch — emits both `file.uploaded` and `file.published` (with `folder`), sanitizes silently, reports the actual folder used
- [ ] Unit: `ArchiveFolderUseCase` — 404 unknown id, 400 non-folder id, an empty folder still resolves to a stream, and it depends only on `DownloadRegistry`/`DownloadReader`/`FolderArchiver` interfaces (mockable — no real `fs` in the test)
- [ ] Unit: `FsDownloadReader.confineFolder` — rejects an escaping resolved path and a name that isn't a directory, mirroring `confine()`'s existing corpus
- [ ] Integration (`fastify.inject` where the zip's streamed nature allows, otherwise a real listen): `POST /api/files?folder=` happy path, collision suffixing, existing-file-name conflict → 409-mapped error
- [ ] Integration: `GET /api/downloads/:id/archive` — correct entries, correct names inside the zip, 400 on a file id, a deleted-mid-stream file logs a warning rather than corrupting the archive
- [ ] Integration: `FsDownloadInspector.findNameById` resolves a nested file's id; preview content route serves it
- [ ] Kill test: `SIGKILL` mid `FsFolderPublisher.publish`, asserting the "no partial file, empty folder at worst" invariant
- [ ] Client: `UploadPage` folder-mode item goes `queued → uploading → moved` with no `done`/`moving` stop, reusing the existing swipe-out `animationend` mechanics
- [ ] Client: `usePublishedBanner` — folder-present vs. absent message text, per-folder dedupe key, self-filter still holds
- [ ] Client: `DownloadsPage` root view filters folders correctly; folder page filters its children correctly; both stay live off one shared `useDownloads` feed (no duplicate SSE subscription)
- [ ] Live-verify: two browsers — upload a folder of several files from one, watch the banner and the live folder listing appear on the other; download the folder as a zip and confirm its contents; drop a Finder-made folder with files one level deep and confirm the same live behavior; a real phone on the LAN is owner-manual per this project's usual pattern
