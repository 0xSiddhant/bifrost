# PLAN-02 — File Transfer (upload + download + live watch)

## Goal

The core product: any device uploads files into a write-only folder on the host Mac; any device sees a live list of the downloads folder and can download; dropping a file into `storage/downloads/` via Finder appears on every open client instantly.

## Scope

**In:** `file-transfer` module (server + client feature), SSE-driven live list, all upload security, download-all-as-zip (stretch).
**Out:** previews (PLAN-03), history UI (PLAN-06 — but events are emitted now).

## Decisions & reasoning

- **Upload path:** `@fastify/multipart` (busboy) streams each file to `storage/tmp/<uuid>` → on stream end, usecase finalizes with atomic `rename()` to `storage/uploads/<timestamp>-<sanitized>`. Flat memory at 2 GB; crash mid-upload leaves only tmp junk (swept at boot).
- **Limits enforced twice:** early reject on `Content-Length` when present; hard per-file byte counter aborts the stream at `MAX_UPLOAD_SIZE_MB`. Also `MAX_FILES_PER_UPLOAD` and extension blocklist from config. Rejections return structured errors so the UI can mark just the offending file.
- **Write-only by construction:** no static route, no read/list endpoint for `uploads/` exists in the codebase. Files written 0644. Only `bus.emit('file.uploaded', meta)` leaves the module (audit-log consumes later).
- **Sanitization:** strip path separators, `..`, null/control chars, leading dots; enforce max name length; NFC-normalize unicode.
- **Watcher:** chokidar on `downloads/` with `awaitWriteFinish: { stabilityThreshold: 1500 }` so half-copied files never flash into the list; `ignoreInitial: false` — the initial scan *is* the boot reconciliation.
- **Download serving:** `GET /api/downloads/:id/content` streams via `fs.createReadStream` after a realpath-prefix check confines the resolved path to `downloads/`. IDs come from the server's listing (not raw client filenames) to kill traversal by design.
- **Rate limiting:** `@fastify/rate-limit` on the upload route (per-IP) — cheap DoS insurance even on a LAN.

## API contracts

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/files` | Multipart upload, N files | 201 → `{ accepted: [...], rejected: [{name, reason}] }`; 413 on oversize |
| `GET /api/downloads` | List downloads | `[{ id, name, size, mtime, ext }]`, sorted mtime desc |
| `GET /api/downloads/:id/content` | Stream one file | `Content-Disposition: attachment`; 404 if gone |
| `GET /api/downloads/archive` *(stretch)* | Zip of selected/all | `archiver`, streamed |
| SSE events | `download.added` / `download.removed` / `download.changed` | payload = listing entry |

## Task checklist

**Server**
- [ ] `modules/file-transfer/`: module.ts, routes, `UploadFilesUseCase`, `ListDownloadsUseCase`, `GetDownloadStreamUseCase`, `FileStorageRepository` (fs impl), `DownloadWatcherService` (chokidar)
- [ ] Sanitizer util + exhaustive unit tests (traversal corpus: `../`, `..\\`, `%2e%2e`, unicode dots, 255-char names)
- [ ] tmp sweep on boot; byte-counter abort; blocklist check; per-IP rate limit
- [ ] Events added to `core/bus/events.ts`; watcher → bus → sse-hub wiring

**Client**
- [ ] Upload feature: dropzone + file picker, multi-file queue, per-file progress (XHR progress events), per-file error states, cancel
- [ ] Downloads feature: live list bound to SSE with fetch-on-reconnect resync, sort (name/size/date) + client-side search, human sizes, type icons
- [ ] Offline/SSE-reconnecting banner behavior

## Acceptance criteria

1. Upload 5 mixed files at once from a phone; each shows independent progress; all land in `uploads/` with sanitized timestamped names, mode 0644.
2. A 2.1 GB file is rejected cleanly (UI error, no partial file in `uploads/`); a 1.9 GB file succeeds with flat server memory (verify RSS while streaming).
3. `curl` attempts to read `uploads/` via every route pattern → 404; traversal attempts on the download route → 400/404, path never escapes `downloads/`.
4. Drop / rename / delete a file in Finder → all open clients update within ~2s without refresh.
5. Kill test: SIGINT mid-upload → restart → no file in `uploads/`, tmp swept, downloads list correct.

## Test checklist

- [ ] Unit: sanitizer corpus, usecase limit/blocklist logic (mocked repo)
- [ ] Integration: multipart happy path + oversize + blocklisted ext via `fastify.inject`
- [ ] Integration: watcher event → SSE broadcast (temp dir fixture)
- [ ] Manual: iPhone Safari, Android Chrome (via IP/QR), macOS Safari, Windows-ish viewport
