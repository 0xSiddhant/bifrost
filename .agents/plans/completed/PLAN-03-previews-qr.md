# PLAN-03 — In-browser Previews + QR Tool

## Goal

Downloads become browsable, not just downloadable: preview images, PDFs, video/audio (seekable), and rendered markdown in the browser. Plus the `qr-tool` module: paste any text/URL → QR for other devices to scan; also produces the server-URL QR consumed by the boot log and later Heimdall.

## Scope

**In:** `previews` module (server range-streaming + client viewers), `qr-tool` module (both profiles).
**Out:** editing files, thumbnails/transcoding (backlog), Heimdall QR *page* (PLAN-05 — the component ships here).

## Decisions & reasoning

- **HTTP Range support is the core of this plan.** Video scrubbing on iOS Safari *requires* correct `206 Partial Content` + `Accept-Ranges: bytes`; without it, `<video>` won't seek and may not play at all. Implement single-range parsing (multi-range not needed for browsers), correct `Content-Range`, and 416 handling on the existing download stream endpoint with `?inline=1` disposition.
- **Preview types by extension + sniffed mime** (`file-type` lib on first bytes — extensions lie): images (native `<img>`), video/audio (native elements + range), PDF (`<embed>`/`<object>` — native on all target platforms; pdf.js only if native proves broken on Android), markdown (`marked` + DOMPurify — sanitize because folder contents are trusted-ish but defense in depth is free), text/code (pretty `<pre>` with highlight.js, capped at 1 MB).
- **QR generation is client-side** (`qrcode` npm lib) — no server round-trip, works offline, nothing logged. The reusable `<QrCard text size>` component is the deliverable other modules consume.
- Preview opens as a modal route (`/downloads/:id/preview`) so deep links work and back-button closes it.

## API contracts

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/downloads/:id/content?inline=1` | Inline stream w/ ranges | `206` + `Content-Range` on `Range` header; correct mime |
| `GET /api/downloads/:id/meta` | Preview capability | `{ previewable: bool, kind: image\|video\|audio\|pdf\|markdown\|text\|none, mime }` |

## Task checklist

- [ ] Range parsing util + exhaustive tests (open-ended, suffix, out-of-bounds → 416)
- [ ] Mime sniffing service; `kind` resolver
- [ ] Client viewers: ImageViewer (pinch/zoom-friendly), MediaPlayer, PdfViewer, MarkdownViewer (sanitized), TextViewer; modal route + keyboard nav (esc, arrows between files)
- [ ] FileRow gains preview affordance for previewable kinds
- [ ] `qr-tool` module: page with text input → live QR, download-as-PNG, size presets; shared `<QrCard>`; server-URL QR helper
- [ ] Register `qr-tool` in both `local` and `cloud` manifests

## Acceptance criteria

1. A 500 MB video scrubs smoothly on iPhone Safari and Android Chrome (network tab shows 206s, not full downloads).
2. Images, PDFs, and markdown render correctly on all target devices; unsupported types show a clean "download only" state.
3. QR generated from pasted text scans successfully from another phone; works with host Wi-Fi internet off.
4. Markdown containing `<script>` renders inert.

## Test checklist

- [ ] Unit: range parser corpus, kind resolver (lying extensions)
- [ ] Integration: Range request → 206/416 correctness via inject
- [ ] Manual device pass: video seek iOS/Android, PDF Android, pinch-zoom image iPad
