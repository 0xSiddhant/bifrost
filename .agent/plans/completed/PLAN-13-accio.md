# PLAN-13 — Accio (read-later / bookmark shelf)

## Goal

A shelf at `/accio` where any device saves a URL to *keep* — title, tags, one tap to open or copy — distinct by intent from Hermes (Hermes *passes* things between devices ephemerally; Accio *summons* them back later).

## Gate

After PLAN-12 merged. Small single-PR module; every pattern already exists (library CRUD ×4 precedents, SSE refresh, `X-Bifrost-Device` author, audit pickup).

## Decisions & reasoning

- **Own module + `accio_links` table** (id 6-char, url, title, tags JSON array, author_device_id, created_at). No folders/nesting — tags only; flat + filterable beats a bookmark-manager tree for a household shelf.
- **Title is best-effort, never blocking:** client may submit a title; if absent, the server tries a 3s-timeout fetch of the URL's `<title>` *after* saving (row appears instantly, title patches in via SSE when found). LAN-without-internet degrades gracefully to the bare URL. No favicon storage (external fetches per render — not worth it; a letter-tile from the hostname instead).
- **Hermes synergy:** URL-shaped Hermes entries gain an **"Accio it"** action — copies the entry into the shelf. Implemented in the hermes feature calling Accio's public API via HTTP (or bus event server-side) — never a cross-feature import.
- **Local profile** registration (family bookmarks are not a cloud feature); revisit only with real auth.

## API contracts (`/api/accio`)

| Method & path | Purpose |
|---|---|
| `GET /api/accio?q=&tag=&sort=` | List; search matches title+url; tag filter |
| `POST /api/accio` | `{ url, title?, tags? }` → 201 row; async title enrichment; 422 invalid URL |
| `PATCH /api/accio/:id` | Edit title/tags |
| `DELETE /api/accio/:id` | Remove |
| SSE `accio.saved/updated/deleted` | Live shelf + title patch-in; audit subscribes |

## Tasks

- [ ] Table + migration (db-migration skill); repo port + impl; usecases (save w/ URL validation + normalization, enrichTitle service with timeout + single retry, list/edit/delete); routes; events
- [ ] Shelf UI: add bar (paste-and-go), cards with hostname tile · title · tags · relative time · open/copy/edit/delete, tag chip filter row, search, empty state ("Nothing summoned yet")
- [ ] Hermes "Accio it" on URL entries; nav via capabilities — surfaced as a capability-gated **card on a category hub** (the flat nav became 3 tabs — Midgard/Ollivanders/Diagon Alley — on 2026-07-21; owner picks the hub, likely Diagon Alley or beside Hermes on Midgard) with its own `--tone-*` card; mobile pass

## Acceptance criteria

1. Saving a bare URL from a phone shows the row instantly on a second device; title appears within seconds when the site is reachable, and never blocks when it isn't.
2. Tag filter + search compose; edit round-trips; delete confirms and live-removes elsewhere.
3. "Accio it" on a Hermes URL entry lands it on the shelf with source device as author.
4. Invalid/unsupported schemes (`javascript:` etc.) are 422-rejected server-side.
5. Kill test mid-save-burst: no torn rows.

## Tests

- [ ] Unit: URL validation/normalization corpus (schemes, unicode hosts, trailing junk), title extraction (entities, missing title, huge pages truncated)
- [ ] Integration: CRUD + enrichment patch event + 422s via inject; audit rows
- [ ] Manual: two-device shelf session, offline-internet title degradation
