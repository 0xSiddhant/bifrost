# PLAN-15 — Portkey (LAN go-links)

## Goal

Short, memorable, human-chosen URLs for everything on the network: `bifrost.local/go/router`, `/go/nas`, `/go/standup` → instant redirect. A management page to create/edit them, hit counts, and a QR per link. Touch a small enchanted object, get transported — the name finally lands on its true feature.

## Gate

After PLAN-14 merged. Single PR.

## Decisions & reasoning

- **Slugs are user-chosen words, not generated ids** — the entire point is memorability (`/go/router`, not `/go/x7k2f9`). Rules: lowercase kebab `[a-z0-9-]{1,32}`, uniqueness (409 with "already enchanted → view it"), reserved-word guard (existing route roots + `api`, `go`, `edda`, `runestone`, …, maintained as one list in core).
- **Redirect = 302, always** (never 301 — targets like router IPs change; browsers cache 301s brutally). Hit count incremented async post-redirect (a slow DB write must never delay the hop). Unknown slug → the creative-404 pattern: "This portkey was never enchanted" + **"Enchant it now"** (management form pre-filled with the slug) — the Runestone/Edda move, third verse.
- **Open-redirect stance: local profile ONLY, permanently.** A public go-links service is a textbook open-redirect/phishing primitive; on the LAN it's a convenience. Targets validated to `http(s)` only (no `javascript:`/`file:`), but deliberately **allowed to be any host** — pointing at the router, the NAS, localhost ports, and the internet alike is the use case.
- **Table `portkeys`:** slug (pk), url, note, hits, author_device_id, created_at, last_used_at. QR per link via the shared `<QrCard>` (scan on a phone → lands through the redirect — QRs for things that move, without reprinting).
- SSE `portkey.*` + audit as usual.

## API contracts

| Method & path | Purpose |
|---|---|
| `GET /go/:slug` | 302 to target; async hit++; unknown → creative 404 page |
| `GET /api/portkey` | List with hits + last-used; `q` search |
| `POST /api/portkey` | `{ slug, url, note? }`; 409 taken; 422 bad slug/scheme/reserved |
| `PATCH /api/portkey/:slug` | Edit url/note (slug immutable — it's the identity; delete+recreate to rename) |
| `DELETE /api/portkey/:slug` | Remove |
| SSE `portkey.saved/deleted` | Live management list; audit subscribes |

## Tasks

- [ ] Reserved-roots list in core (single source, also asserted by an Edda/Runestone-style guard test); slug + scheme validators
- [ ] Table + migration; repo/usecases (create/edit/delete/list, resolve+async-hit); `/go/:slug` route registered before the SPA fallback; creative 404 with pre-filled enchant flow
- [ ] Management UI: table/cards (slug · target · note · hits · last used · QR button · edit/delete), create bar with live slug validation, search; mobile pass
- [ ] Nav via capabilities — a capability-gated **card on a category hub** (the flat nav became 3 tabs on 2026-07-21; owner picks the hub, likely Diagon Alley/utilities) with its own `--tone-*` card; local manifest only

## Acceptance criteria

1. `/go/router` 302s to the saved target from every device; the redirect adds no perceivable latency (hit write is async — verified ordering in code + timing in live-verify).
2. Creating `go`/`api`/an existing route root as a slug → 422 with the reason; duplicate slug → 409 offering the existing entry; `javascript:` target → 422.
3. Unknown slug shows the enchant-it-now 404 with the slug pre-filled; completing it and re-hitting the URL redirects.
4. Hit counts + last-used update within a heartbeat on the open management page; QR scanned from a phone lands through the redirect.
5. Kill test mid-create-burst: no torn rows; a slug either resolves fully or 404s — never half-exists.

## Tests

- [ ] Unit: slug validator corpus (unicode, uppercase, length, reserved), scheme guard, async-hit ordering
- [ ] Integration: 302 flow, 409/422 matrix, route-precedence over SPA fallback via inject
- [ ] Manual: phone-scan QR hop, router/NAS/localhost target sanity
