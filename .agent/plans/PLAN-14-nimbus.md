# PLAN-14 — Nimbus (LAN speed test)

## Goal

A page at `/nimbus` that measures the *actual* path that matters in this house — device ↔ the Bifrost Mac over Wi-Fi/LAN: download throughput, upload throughput, latency — with per-device history so "why is the iPad slow in the bedroom" becomes answerable. Named for the fast broom; internet speed tests measure your ISP, Nimbus measures your air.

## Gate

After PLAN-13 merged. Single PR.

## Decisions & reasoning

- **Methodology (honesty first — this is approximate by design, stated on-page):**
  - *Latency:* 10 sequential tiny `GET /api/nimbus/ping` round trips → report **median** (mean lies under one Wi-Fi retry spike).
  - *Download:* server streams `bytes` of pseudo-random data (pre-generated buffer cycled — never `/dev/urandom` per request, never compressible zeros: gzip would fake the numbers; route sets `content-encoding: identity` + no-store) while the client times chunk arrivals via `fetch` reader → live Mbps.
  - *Upload:* client posts a generated blob; the server **discards the stream** (counts bytes, writes nothing to disk) and returns bytes+duration.
  - Warmup: a small untimed transfer first (TCP slow-start would otherwise punish short tests). Test size selectable (10/50/`NIMBUS_MAX_TEST_MB=100` env cap); one test at a time per server — a concurrent-test guard returns 409 with "another broom is flying," since parallel tests corrupt each other's numbers.
- **History:** `nimbus_results` table (device_id, direction-agnostic row: down_mbps, up_mbps, latency_ms, test_mb, created_at). Device identity from `X-Bifrost-Device` + presence names → history grouped per device with a sparkline; retention pruned with the audit policy.
- **No third-party libs** — the whole tool is streams + timers we own.
- **Local profile only**, self-evidently.
- **UI creativity mandate:** the start control is a broom that *flies* across a progress track during the test; live gauge for the active phase (ping → down → up), then a result card (three big numbers) and the device history below. Mobile-first — this tool will be used while *walking around the house*; giant numbers, thumb-sized start, works one-handed.

## API contracts (`/api/nimbus`)

| Method & path | Purpose |
|---|---|
| `GET /ping` | 204, no body — RTT probe |
| `GET /down?mb=` | Streams N MB incompressible data; identity encoding; 409 if a test is running |
| `POST /up` | Body discarded server-side; returns `{ bytes, ms }`; size-capped 413 |
| `POST /results` / `GET /results?device=` | Save + per-device history |
| SSE `nimbus.completed` | Other open pages see fresh history |

## Tasks

- [ ] Server: random-buffer streamer with backpressure, discarding upload sink, single-flight guard, ping route, results table + migration + repo/usecases, env cap in zod + `.env.example`
- [ ] Client: test orchestrator (warmup → ping ×10 → down → up), live Mbps from reader timings, cancel mid-test (abort controllers both directions)
- [ ] UI: broom progress, phase gauge, result card, per-device history + sparkline, approximate-methodology note, 409 "broom busy" state
- [ ] Nav via capabilities — a capability-gated **card on a category hub** (the flat nav became 3 tabs on 2026-07-21; owner picks the hub, likely Diagon Alley/utilities) with its own `--tone-*` card; audit event on completion

## Acceptance criteria

1. Results are plausible and stable: three consecutive runs on the same stationary device vary < ~15%; wired Mac reports dramatically higher than a far-room phone (sanity check recorded in live-verify).
2. Download numbers are compression-proof (verified: response bytes ≈ requested bytes on the wire, identity encoding present).
3. A second device starting mid-test gets the 409 state, not corrupted numbers; cancel aborts both directions cleanly and the server guard releases.
4. Upload writes nothing to disk (storage byte-count unchanged after a 100 MB up test); memory stays flat during both directions (streamed, never buffered whole).
5. History persists per device with presence names; sparkline renders ≥2 entries; kill test mid-result-save leaves no torn rows.
6. Fully usable one-handed at 390×844 while walking.

## Tests

- [ ] Unit: median latency calc, Mbps math, guard state machine, buffer cycling
- [ ] Integration: down byte-count + headers, up discard + 413 over cap, 409 concurrency, results CRUD via inject
- [ ] Manual (live-verify): real two-device run with RSS watch during 100 MB both ways; walking-range test for the fun of it
