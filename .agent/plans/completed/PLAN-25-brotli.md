# PLAN-25 — Brotli (compress/decompress + cross-tool content hand-off)

## Goal

An Ollivanders page wrapping Node's built-in Brotli codec — compress arbitrary text or a file, decompress a `.br` back to its original bytes, both streamed with hard size caps. Every structured-text editor already on Ollivanders (Runestone, Edda, Loki, Groot, Atlas) gains a **"Compress with Brotli"** button that hands its current buffer straight to the new page and compresses it immediately. On decompress, if the result looks like a format one of those editors already understands, an **"Open in `<tool>`"** button appears — wired through a new, extensible content-format registry, so a future format is one registry entry, the same "one array element, no page change" shape PLAN-19 and PLAN-23 already proved twice for the Pensieve.

## Gate

PLAN-24 merged. Single PR, no parts.

## Scope

**In:**
- New `brotli` server module: `POST /api/brotli/compress`, `POST /api/brotli/decompress` — both raw-body, both streamed end to end, both profiles (`local` and `cloud`).
- New `features/brotli/BrotliPage.tsx`: paste/type text or drop a file to compress; drop a `.br` file to decompress; before/after size and ratio; download the result.
- New Ollivanders card, `/brotli` route, `RESERVED_ROOTS` entry.
- Outbound hand-off: one new `core/brotliSeed.ts` (fan-in from five sources) + a button on each of Runestone, Edda, Loki, Groot, Atlas that seeds the current buffer and **auto-compresses on arrival**.
- Five page capabilities, each reusing an existing mechanism rather than inventing one: a Fast/Balanced/Best quality selector; a client-side gzip size comparison (via the browser's own `CompressionStream`, no server round-trip); "Copy as base64" on both compress and decompress output; "Send to Hermes" onto the existing clipboard board; a small technical footer stating the actual quality and window-size used.
- Inbound hand-off: a new `client/src/core/contentFormat/` registry (JSON, XML, YAML, Markdown detectors, each capability-gated), reusing the existing `core/runestoneSeed.ts` and adding matching `atlasSeed.ts` / `eddaSeed.ts` / `grootSeed.ts`, plus a one-time mount-read in each of those four editors.
- `.claude/skills/new-module/SKILL.md`: a checklist line so a future structured-text module registers itself in the detector, the same way PLAN-22 added the offline-mode line there.
- `architecture.md`: module registry row + a short data-flow paragraph for both hand-off directions.

**Out (explicitly):**
- Any saved-document library entry. This is a workbench (Loki/Variant/Nimbus's class), not a document store — no Pensieve row, no DB table, no slug.
- Multi-file / batch compression. One input, one output, per request.
- A client-side (WASM) codec. Settled in the discussion that led to this plan: browsers' `CompressionStream`/`DecompressionStream` API doesn't support Brotli at all (only gzip/deflate), and a WASM codec would fatten Diagon Alley's shared one-chunk toolbox for every other tiny tool — server-side via Node's built-in `zlib` is free and is the reference codec besides.
- Registering `brotli` in the offline-mode warm-load registry — **checked against `new-module/SKILL.md`'s own checklist, not skipped**. That step exists for "a page or tool that keeps working with no server round-trip once its code is loaded" (`offlineWarmLoad.ts`'s own contract); Brotli's entire function is a server round-trip — there is no client-side codec to warm ahead of the bridge going away (see "Server does the codec work" above). Warming its chunk would let the *page shell* open offline, then fail the instant Compress or Decompress is pressed, which is a worse experience than the page not being warmed at all and simply falling to `RouteBoundary`'s existing "the bridge is down" panel like any other un-warmed route.
- A lore name. Considered and **declined by the owner this session** (Reducio/Skíðblaðnir/Cornucopia were proposed, none landed) — plain "Brotli" is the final name: module id, page title, nav card, route.

## Decisions & reasoning

### Server does the codec work; the client stays pure UI — recapping the pre-plan discussion

Settled before this plan was written, restated here because it's the reason the module exists in this shape rather than as a Diagon Alley tool: the Compression Streams API's supported formats are `gzip`/`deflate`/`deflate-raw` only, in every current browser — Brotli is not one of them. Node's `zlib` module has had `brotliCompressSync`/`brotliDecompressSync` (and their stream equivalents, `createBrotliCompress`/`createBrotliDecompress`) since Node 11.7, backed by Google's own `libbrotli` — the same reference implementation every browser and the standalone `brotli` CLI use, so output is byte-format-standard and universally decodable, and vice versa. Server-side is not a workaround here; it's strictly better than the alternative (a bundled WASM codec) on every axis that matters for this app — bundle size, correctness, and zero new client dependency.

### Raw streaming body in both directions — extends Nimbus's precedent, doesn't invent a new one

Nimbus's upload sink (`nimbus/routes/nimbus.ts`) already establishes the pattern this module needs: a custom `application/octet-stream` handling that never buffers the body, just streams and counts. Brotli's routes read `request.raw` directly rather than going through Fastify's body parser at all — the same reasoning `respondWithFile` already applies on the way *out* (a route only ever pipes a stream into `reply.send()`, never materializes one in memory), now applied on the way *in* too. One `pipeline()` per route: `request.raw → [byte-counting Transform] → zlib transform → reply.send()`.

### The `PLAN-24` layering lesson, applied here from the start

PLAN-24's self-review caught a usecase touching `fs` directly and a route touching `archiver` directly — both forbidden by `coding.md`'s "usecases never touch infrastructure directly, routes stay HTTP-only" rule, both fixed by moving the actual mechanism into a service the usecase depends on through an interface. Applying that lesson here without needing a second correction:

```ts
export interface BrotliCodec {
  /** Compresses `input` at `quality` (a real Brotli quality level, 4/9/11 —
   *  the route maps the fast/balanced/best enum before this is ever called);
   *  the returned stream errors if the source exceeds maxInputBytes. */
  compress(input: Readable, quality: number, maxInputBytes: number): Readable;
  /** Decompresses `input`; the returned stream errors if the OUTPUT would exceed
   *  maxOutputBytes (the decompression-bomb guard, see below) — or if the input
   *  is not valid Brotli at all, which zlib reports as an ordinary stream error,
   *  indistinguishable at this layer from any other decode failure. */
  decompress(input: Readable, maxOutputBytes: number): Readable;
}
```

`services/node-brotli-codec.ts` (`NodeBrotliCodec`) is the only place `zlib`'s Brotli API is imported — it owns both counting Transforms and the `zlib.createBrotliCompress()`/`createBrotliDecompress()` calls. `usecases/compress-content.ts` / `usecases/decompress-content.ts` are thin: read the configured caps, call the codec, log start/failure, return the stream. `routes/brotli.ts` never sees `zlib` or a byte counter — it reads `request.raw`, does the cheap content-length pre-check (compress only, see below), validates/maps `?quality=`, calls the usecase, and pipes the result into `reply.send()` with `content-type: application/octet-stream`. No `Content-Disposition` from the server at all — see "no server-side filenames" below.

**Decode failures need an honest answer, and it depends on timing — the same shape PLAN-24's archive-error handling already had to accept.** Feeding non-Brotli (or truncated) bytes to `/decompress` is a completely ordinary case — the wrong file dropped, a corrupted `.br` — not an edge case to wave away. If the decode fails **before any output has been written** (a bad header, garbage input), the route can still send a clean `422 INVALID_BROTLI`. If it fails **after streaming has already begun** (a `.br` file that starts valid and is truncated partway through), headers are already flushed and there is no HTTP status left to send — the connection is destroyed and the failure is logged, the exact situation the archive-zip route already has to live with. Both paths are covered; neither is silently swallowed.

### Decompression-bomb protection is load-bearing, not optional

Brotli (like gzip) can have an extreme compression ratio — a small compressed input can expand into an enormous output. This is a known vulnerability class (a "decompression bomb"), and it is the one genuinely new risk this plan introduces that no existing module carries: every other module accepting arbitrary bytes (uploads, `_MAX_DOC_KB`-capped documents) bounds the bytes it *stores*, never bytes it *manufactures*. `NodeBrotliCodec.decompress()`'s output-counting Transform sits immediately after `createBrotliDecompress()`; the instant it would exceed `maxOutputBytes` it **destroys the pipeline outright** — deliberately not the upload path's "keep draining" behavior, because draining a bomb further to let a multi-file batch continue cleanly (the reason that behavior exists for uploads) has no equivalent benefit here: there is one stream, and continuing to decompress it past the cap is the exact thing being defended against.

**Memory safety is unconditional; a clean HTTP status is not, and claiming otherwise would be the same overstatement PLAN-24's zip-stream error handling had to avoid.** This is a streaming pipeline by design (that's what keeps memory flat in the first place), so real decompressed bytes are flushed to the client as they're produced — by the time the counter trips, some output may already be on the wire, headers already sent, with no HTTP status left to change. In practice this resolves in the guard's favor for the actual threat: a genuine bomb's whole point is an extreme ratio, so the cap is typically blown past within the first chunk or two, well before anything meaningful has streamed out, which is exactly when a clean `413` is still possible. The other case — a legitimately huge, non-malicious decompression that only gradually exceeds the cap after real bytes were already sent — ends the same way the mid-stream decode failure above does: the connection is destroyed and the failure is logged. Both outcomes bound memory identically; only the client-visible ending differs, and it's stated honestly rather than promised uniformly.

**There is no cheap pre-check for decompress**, unlike compress — the compressed size tells you nothing about the decompressed size, which is precisely the shape of the risk. The streaming output counter is the only guard, and it has to be unconditional.

**Two new env caps**, both validated at boot like every other limit in this codebase:

```
# Max size of the input to /api/brotli/compress, in megabytes
BROTLI_MAX_INPUT_MB=256

# Max size Brotli is allowed to DEcompress a body into, in megabytes — the
# decompression-bomb guard. A small .br file can expand far past its own
# size; this bounds the expansion regardless of the input's declared size.
BROTLI_MAX_OUTPUT_MB=512

# Per-IP requests allowed per minute, to EACH of the two Brotli routes
# (compress and decompress are limited independently, not a shared budget)
BROTLI_RATE_LIMIT_PER_MIN=30
```

`@fastify/rate-limit` configured per-route (the same `config: { rateLimit: {...} }` shape the upload route already uses) — compress and decompress each get their own independent budget rather than a shared counter, since a shared bucket needs its own keyed store and nothing here calls for that complexity.

**A client disconnecting mid-request must not leak a running codec stream.** Nimbus's download guard already establishes the pattern (`reply.raw.on('close', ...)` releasing its lease on an aborted download); both Brotli routes destroy their pipeline the same way on an early close, so an abandoned compress or decompress doesn't keep a zlib stream alive for no reader.

**Given both caps hold, `both` profile is the right call, not `local`-only.** The residual per-request cost is bounded exactly the way `ATLAS_MAX_DOC_KB`/`GROOT_MAX_DOC_KB` already bound Ollivanders' other both-profile editors — this module is closer to that class (a stateless, byte-capped transform) than to `file-transfer`'s class (arbitrary file storage/hosting, permanently local-only by a separate, unrelated decision). Loki's own "both profile, but the risky capability is UI-gated to local" precedent was considered and rejected here: Loki gates a whole *capability* (arbitrary code execution) that has no safe bound to cap; Brotli's risk is a size, and a size has a cap.

### The server never inspects content — bytes in, bytes out, always

Extends the same posture Groot and Atlas already state explicitly for their own formats ("the server never parses YAML" / "the server never parses XML and knows nothing about plists"): Brotli's routes and services know nothing about what's inside the bytes they move, before or after. All content-format sniffing happens **client-side**, on bytes the client already holds after a successful decompress — the previews module already established the base heuristic this reuses (a null-byte scan to decide text vs. binary, `previews/services/fs-file-inspector.ts`'s sibling logic). **That reuse has to include the sampling, not just the check** — `FsFileInspector.looksLikeText()` tests a bounded `TEXT_SAMPLE_BYTES` (4096-byte) prefix, never the whole file, precisely because scanning an entire large blob for one byte value is wasted work once a small prefix has already answered the question. Brotli's client-side version samples the same way; a decompressed output approaching `BROTLI_MAX_OUTPUT_MB` never triggers a full-blob scan. Only once that sample says "text" does the new detector below run at all.

### No server-side filenames

Neither route sets `Content-Disposition`. The client already has the bytes via `fetch`, so it names and saves the download itself (Blob + a temporary `download`-attribute anchor — the same mechanism `DownloadsPage`'s existing anchors already use for individual files) — compress keeps the source name with `.br` appended (or `compressed.br` for pasted text with no filename); decompress strips a trailing `.br` if present, else offers a generic name based on the client's own text/binary read. This avoids reaching for `file-transfer/routes/file-response.ts`'s `dispositionFilename` helper across a module boundary (which modules may never import from each other) for a case simple enough not to need it at all.

### Outbound hand-off: one new seed, five call sites, auto-runs on arrival

`core/brotliSeed.ts` follows `runestoneSeed.ts`/`variantSeed.ts`'s exact shape — a one-shot `sessionStorage` bridge, read-and-cleared once on mount, route-level only, no cross-feature import:

```ts
export interface BrotliSeed {
  text: string;
  /** Which tool sent it — shown on the Brotli page ("sent from Runestone"). */
  sourceLabel?: string;
}
```

**Exactly these five, not every Ollivanders card.** Pensieve and Variant are deliberately excluded, not overlooked: Pensieve is a *listing* over saved documents (Runestone/Edda/Groot/Atlas rows), not an editor with a current buffer — there is no single "the content" for it to send, only a list of other tools' documents, each of which can already be opened and sent from its own editor. Variant holds *two* texts (left/right panes) for comparison, not one document — "compress the content" is ambiguous the moment there are two, and forcing a pick (or compressing a diff) is solving a problem nobody asked for. The five that get the button are exactly the five that are single-buffer editors: Runestone, Edda, Loki, Groot, Atlas.

Each of the five gets a small "Compress with Brotli" button in its existing action row, calling `putBrotliSeed({ text: currentBufferText, sourceLabel: 'Runestone' })` then navigating to `/brotli`. **Unlike Groot→Runestone's pre-fill-and-wait**, Brotli auto-compresses the instant a seed is found on mount — matching Loki→Variant's immediacy (that hand-off shows the diff right away, not after an extra click) and matching the owner's own phrasing this session ("move the content to brotli page and **show with compression**"). The user still sees and can re-run it; nothing is hidden, it just isn't gated behind a redundant confirmation for content they already chose to send. Auto-compress on arrival always runs at the default Balanced quality; **changing the quality selector afterward re-compresses immediately too**, for the same reason — once a result is already on screen, picking a different setting and having to press a second button to see it is the inconsistency, not the auto-run.

**Loki is the one editor here without a single obvious buffer, and that needed an actual decision, not a guess.** Runestone/Edda/Groot/Atlas each hold exactly one document (a tree or preview pane is a *view* of that same buffer, never a second one) — Loki is structurally different, with distinct input and output panes, because transforming one into the other is its whole job. Its "Compress with Brotli" button sends the **output** pane, not the input: the input is equally reachable without ever opening Loki, so the thing worth carrying onward is specifically the result Loki was used to produce.

The button is disabled (not merely inert) when the source buffer — Loki's output pane included — is empty or whitespace-only; there is nothing wrong with compressing zero bytes, but offering to send nothing is a false affordance.

### Inbound hand-off: a content-format registry, built exactly like `core/library/registry.tsx`

`client/src/core/contentFormat/` mirrors the Pensieve's kind registry deliberately — same shape, same reason: a fourth (or fifth, or sixth) format should be one array element, not a redesign.

```ts
export type ContentFormatKind = 'json' | 'xml' | 'yaml' | 'markdown';

export interface ContentFormatEntry {
  kind: ContentFormatKind;
  label: string;        // chip text: "JSON"
  toolName: string;     // button copy: "Open in Runestone"
  module: string;       // capability gate — same `hasModule` check Ollivanders itself uses
  route: string;        // '/runestone'
  icon: ReactNode;       // reuses the SAME icons the library registry already uses for these kinds
  test(text: string): boolean;
  seed(text: string): void; // wraps that tool's own put*Seed
}
```

`detectFormat(text, registry)` tries each entry's `test()` **in registry order** and returns the first match, or `null`. `availableFormats(registry, hasModule)` filters by capability, mirroring `availableKinds()` exactly. Icons are reused as-is from `core/ui/icons` (`BracesIcon` for JSON, `GlobeIcon` for XML, `TreeIcon` for YAML, `DocFileIcon` for Markdown) — the same four the library registry already uses for the same four kinds, no new icon needed.

**Only Runestone has a seed today.** `atlasSeed.ts`, `eddaSeed.ts`, `grootSeed.ts` are three new files, each mechanically identical to `runestoneSeed.ts`'s ~25 lines, each read once on that editor's mount effect (matching how Runestone already reads its own).

### Detection tests are real structural checks, not "did it parse" — the honest version of "smart"

The owner's own framing was explicit: a button should appear only "if its content is **of any specific type which our page support**" — not as an always-on guess. That rules out treating any format as an always-true fallback, Markdown included, and shapes every test below:

- **JSON** — a bare `JSON.parse` try/catch, root must be a non-null object or array. Deliberately **not** `core/json`'s `validateJson` — that function exists to produce rich diagnostics for the editor's lint gutter, not a boolean, and pulling in its jsonc-parser machinery for a one-line structural check is the wrong-sized tool. A bare scalar (`"hello"`, `42`, `true`) does not match — technically valid JSON, but never what "open this in Runestone" should fire for.
- **XML** — reuses `core/xml`'s `parseXml(text)` directly: `issue === null` is **already** the namespace-scoped `parsererror` check PLAN-23 built and pinned (a real bomb-response parsererror grafted under a healthy-looking root vs. a document genuinely named `parsererror`), so this inherits that correctness for free instead of re-solving it. XML's own grammar requires a root element to parse at all, so unlike JSON there's no "bare scalar" case to additionally exclude.
- **YAML** — `validateYaml(text).length === 0` **and** the parsed root is a mapping or sequence (`isMap`/`isSeq` on the document's `.contents`, the same node-type discrimination `core/yaml`'s own tree view already does) — not a bare scalar. This is the weakest of the three real signals and worth being honest about: a chat log formatted as `Name: message` per line is structurally a YAML mapping and will match. Accepted as a residual false-positive rate rather than solved, the same way YAML's own advisory rail accepts the Norway Problem rather than "fixing" a document that was written correctly.
- **Markdown** — genuinely new code, since nothing in this codebase currently answers "does this look like Markdown" as a boolean (Markdown's grammar is permissive enough that "did it parse" is meaningless — nearly everything parses). A small heuristic construct-counter: headings (`^#{1,6}\s`), fenced code blocks, list markers (`^[-*+]\s` / `^\d+\.\s`), links (`[text](url)`), bold/italic markers — matches only once **at least two distinct construct kinds** are present (a lone stray asterisk in a sentence isn't enough; a document with a heading and a list is). Weaker evidence than JSON/XML, comparable honesty to YAML's.
- **Order: JSON → XML → YAML → Markdown**, rigid to fuzzy, first match wins. This specifically resolves one real overlap: JSON is valid YAML 1.2, so JSON-shaped content would also pass the YAML test — checking JSON first means genuinely JSON-shaped content is offered "Open in Runestone" (the more specific, correct read) rather than "Open in Groot."
- **No match → no button.** Plain prose, a log file, binary-looking text that slipped past the null-byte check — nothing is offered, which is the honest answer and exactly what was asked for.

### One size cap governs both rendering and detection, not two unjustified numbers

Running three real parsers (plus the Markdown scan) against a large decompressed blob on the main thread risks the same tab-freezing failure Variant's own compare budgets exist to prevent (a documented incident: "two 200 KB mostly-different docs froze the tab") — but detection was never the only expensive thing in play. Rendering the blob into an editable/scrollable text view at all has its own real cost, so splitting this into a "detection cap" and a separate, larger "display cap" would be two numbers with no clean independent justification for either. One threshold instead (proposed: 8 MB of decompressed text): **below it**, the content is shown as text and detection runs; **above it**, the page offers a download only — no inline view, no detection attempt, nothing partially rendered. Consistent with Variant's and Atlas's own precedent of stating a bound by reasoning rather than by exact benchmark, revisited if live-verify shows otherwise.

**"Copy as base64" and "Send to Hermes" need their own guard, and it's a different one.** Neither runs a parser — a base64 encode is cheap compared to three parse attempts — so the display/detection threshold above is the wrong number to reuse here. The real cost is different: base64-encoding and then clipboard-writing (or POSTing) a multi-hundred-megabyte string is still slow enough on the main thread to be felt, and for "Send to Hermes" specifically, attempting that encode only to have the server answer 413 against `CLIPBOARD_MAX_TEXT_KB` afterward is pure waste. Both actions get their own generous size guard — large enough that it essentially never fires for the base64/clipboard use case Bifrost's other text tools actually see, small enough to refuse a compressed-output-sized blob outright rather than let the tab hang trying. Exact figure is an implementation call, not pinned here, for the same reason the display cap isn't pinned to a benchmark.

### Five page capabilities, added at the owner's request — each reuses something that already exists

None of these needed new architecture; each slots into a mechanism this plan (or the codebase) already has.

- **Quality selector — Fast / Balanced / Best.** Reopened from an earlier "fixed default" call once the page itself was in scope for extra capability, not just plumbing. A `quality` querystring on `/api/brotli/compress` (`'fast' | 'balanced' | 'best'`), validated server-side against that exact enum and mapped internally to Brotli quality **4 / 9 / 11** — the client never sends a raw 0–11 number, so there's nothing to sanity-check beyond "is this one of three strings." **Default is Balanced (9), not Node's own library default of 11** — quality 11 is meaningfully slower on large inputs, and defaulting to the slowest setting on a tool whose whole point is a quick round-trip is the wrong default; the fastest correctness-preserving option earns the label "Best," not the automatic one. Decompression takes no quality parameter — Brotli decompression is symmetric regardless of what quality compressed the input, so nothing about it changes.
- **Compare against gzip — entirely client-side, zero extra server round-trip.** The same discussion that put Brotli's codec on the server also established that browsers' `CompressionStream` **does** support gzip natively. So the comparison runs the original input through `new CompressionStream('gzip')` in the browser alongside the server's Brotli call, and shows both sizes and percentages side by side — genuinely informative for a dev tool (it's *why* Brotli exists, shown rather than asserted) at no infrastructure cost. Feature-detected (`typeof CompressionStream !== 'undefined'`) and hidden, not broken, where it's unavailable — the same posture the SHA-256 Diagon Alley tool already takes for `crypto.subtle`'s secure-context gate. The gzip bytes are kept, not discarded, so "Download .gz" is a free second button once they exist.
- **"Copy as base64"** on both compress and decompress output, via the existing `core/copy.ts` `copyText` (async Clipboard API with the execCommand fallback already built for plain-LAN-http — no new copy mechanism). This is the answer to "I don't want a file, I want a string" — pasting a compressed blob into a config value or an env var.
- **"Send to Hermes"** — puts the result onto the existing synced clipboard board (`POST /api/clipboard`). **Brotli's own `features/brotli/api.ts` calls that endpoint directly**, the same way `core/api.ts`'s generic `apiSend` helper already backs many independent features' calls to shared REST endpoints — it does **not** import `features/hermes/api.ts`'s `addClipboard`, which would be a real cross-feature import and a build-failing boundary violation. The two features independently call one public endpoint; they share no code. Compressed output goes over as base64 text (composing directly with the base64 feature above — the same encoded string, one more place to put it); decompressed *text* output (past the null-byte check) goes over as plain text, since forcing it through base64 first would just make it less readable for no reason. It shares the same client-side size guard "Copy as base64" gets (see "One size cap governs both rendering and detection" below) — refusing outright beats attempting a doomed encode-then-413 round trip against Hermes's own `CLIPBOARD_MAX_TEXT_KB`, though that server-side cap is still the real backstop if the client's guard ever disagrees with it.
- **A small technical footer** stating the actual parameters used — quality level and window size ("Quality 9 (Balanced) · standard window, not large-window"). This module deliberately never enables Brotli's large-window extension (an HTTP-compression-specific option not universally supported by every decoder — the one interop caveat raised in the discussion that led to this plan), so the footer is stating a fixed policy, not a runtime value; no new API field needed. It's also the plan's honest answer to its own opening question, shown inside the tool itself rather than only argued in this document: the "is this universal" guarantee is a checkable fact on the page, not a claim to take on faith.

## API contracts

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/brotli/compress?quality=fast\|balanced\|best` | Raw body in → Brotli-compressed bytes out | `content-type: application/octet-stream` both ways; `quality` optional, defaults to `balanced` (level 9), validated against the three-value enum and mapped server-side to Brotli quality 4/9/11; 413 over `BROTLI_MAX_INPUT_MB` (content-length pre-check, then a streaming counter as the real enforcement) |
| `POST /api/brotli/decompress` | Raw `.br` body in → original bytes out | Output bounded to `BROTLI_MAX_OUTPUT_MB` — the decompression-bomb guard; a clean `413` when caught before any output streamed (the common case for a real bomb), otherwise the connection is destroyed with the failure logged; `422` on bytes that aren't valid Brotli, same before/after-streaming split |
| `GET /api/brotli/config` | Exposes the two caps to the client | Mirrors `GET /api/files/config`'s reason for existing: limits live in `.env`, the UI reads them rather than hardcoding a menu |
| `POST /api/clipboard` | Existing Hermes endpoint — "Send to Hermes" calls it directly | Not a new route; `features/brotli/api.ts` calls it independently of `features/hermes/api.ts` (no cross-feature import) |

Both `brotli` routes are local **and** cloud profile. Gzip comparison and both copy actions touch no server route at all.

## Task checklist

**Server**
- [x] `core/config`: `brotliMaxInputMb`, `brotliMaxOutputMb`, `brotliRateLimitPerMin` in the zod schema; `.env.example` entries
- [x] `modules/brotli/ports.ts`: `BrotliCodec` interface
- [x] `modules/brotli/services/node-brotli-codec.ts`: `NodeBrotliCodec` — both counting Transforms, both `zlib.createBrotli*` calls; the only file importing `zlib`'s Brotli API; decode failures before any output surface as a distinguishable error the route can map to 422, decode failures after streaming has begun surface as a plain stream error the route destroys the connection over
- [x] `modules/brotli/usecases/compress-content.ts` + `decompress-content.ts`: thin orchestration over the codec interface; log start/failure with `{ err, bytes }`; compress takes a validated quality level (4/9/11), decompress takes none
- [x] `modules/brotli/routes/brotli.ts`: `request.raw` streaming in both directions, content-length pre-check on compress only, `?quality=` schema-validated against `fast|balanced|best` and mapped to 4/9/11, `/config` route, `@fastify/rate-limit` (compress and decompress independently budgeted, not shared), `reply.raw.on('close', …)` destroying the pipeline on client disconnect (Nimbus's download-guard pattern), pre-stream decode failure → 422, mid-stream decode failure → destroyed connection + logged
- [x] `modules/brotli/module.ts`: wire codec → usecases → routes; register in `MANIFEST` (`local` **and** `cloud`)
- [x] `core/reserved-roots.ts` + `reserved-roots.test.ts`: add `brotli`

**Client — Brotli page**
- [x] `core/api.ts` or `features/brotli/api.ts`: `compressContent`/`decompressContent` (raw `fetch` bodies, not JSON), `fetchBrotliConfig`
- [x] `core/brotliSeed.ts` (new): `BrotliSeed { text, sourceLabel? }`, `put`/`take`, mirroring `runestoneSeed.ts` exactly
- [x] `features/brotli/BrotliPage.tsx`: text input + file dropzone (compress), file dropzone (decompress); before/after size + ratio; client-side download naming (no server `Content-Disposition`); reads-and-clears a `BrotliSeed` on mount and **auto-compresses immediately** if one is present
- [x] Client-side pre-check against `BROTLI_MAX_INPUT_MB` (read from `/api/brotli/config`) before a compress request is even sent — mirrors `UploadPage.tsx`'s existing `addFiles()` pre-check against `maxUploadSizeMb` exactly, same shape, same reason (fail fast, no wasted upload)
- [x] Quality selector (Fast/Balanced/Best radio or segmented control) on the compress side only, defaulting to Balanced, riding the `?quality=` param; **changing it after a result exists re-compresses immediately**, matching seed-arrival's own auto-run
- [x] `core/compressionSupport.ts` (or similar, new): feature-detect `CompressionStream`; a client-side `gzipSize(bytes): Promise<{ size: number; blob: Blob }>` wrapper around `new CompressionStream('gzip')`, reading the whole compressed stream into one `Blob`
- [x] Compare panel: Brotli size/ratio vs. gzip size/ratio side by side, "Download .gz" using the already-computed gzip `Blob`; hidden (not broken) when `CompressionStream` is unsupported
- [x] "Copy as base64" on both compress and decompress output, via `core/copy.ts`'s `copyText`; hidden/disabled above the same size guard "Send to Hermes" uses (see Decisions)
- [x] `features/brotli/api.ts`: `sendToHermes(text)` — its own direct call to `POST /api/clipboard`, independent of `features/hermes/api.ts`; base64 for compress output, plain text for decompress-text output; client-side size guard before attempting, and a 413 (payload still over Hermes's own cap) surfaces the same way an oversized Hermes paste already does
- [x] Technical footer: fixed copy stating quality level used and that window size is standard (never large-window) — no new server field, this module's own policy
- [x] Decompress result: bounded-prefix null-byte binary check first (reuse `TEXT_SAMPLE_BYTES`-style sampling from `previews/services/fs-file-inspector.ts`'s reasoning — never scan the whole blob); above the unified display/detection size threshold, offer a download only with no inline view attempted; below it, if text, run `detectFormat` and show the matched entry's "Open in `<tool>`" button, or nothing if unmatched
- [x] `app/pages/OllivandersPage.tsx`: new `TOOLS` entry, **appended** (colour-follows-position — inserting mid-list would silently recolour every card after it, the same reasoning Groot's and Atlas's own entries already state), `ArchiveFileIcon` (existing icon, no new one needed)
- [x] `App.tsx`: `/brotli` route

**Client — outbound hand-off (5 editors)**
- [x] `RunestonePage.tsx`, `EddaPage.tsx`, `GrootPage.tsx`, `AtlasPage.tsx`: one "Compress with Brotli" button each in the existing action row, calling `putBrotliSeed` with the editor's buffer + navigate; disabled when that buffer is empty/whitespace-only
- [x] `LokiPage.tsx`: same button, sends the **output** pane, not the input — the one editor here with two candidate buffers, resolved in Decisions

**Client — inbound hand-off (content-format registry)**
- [x] `core/atlasSeed.ts`, `core/eddaSeed.ts`, `core/grootSeed.ts` (new): mechanically identical to `runestoneSeed.ts`
- [x] `RunestonePage.tsx`, `AtlasPage.tsx`, `EddaPage.tsx`, `GrootPage.tsx`: mount-effect reading-and-clearing their own seed (Runestone's may already partially exist for Groot's hand-off — confirm, don't duplicate)
- [x] `client/src/core/contentFormat/types.ts` + `registry.ts`: `ContentFormatEntry`, `LIBRARY`-style array, `detectFormat`, `availableFormats` — JSON/XML/YAML tests reuse `core/json`/`core/xml`/`core/yaml`; Markdown test is new
- [x] `client/src/core/contentFormat/markdownHeuristic.ts` (new, pure, unit-testable in isolation): the construct-counter

**Skills & docs**
- [x] `.claude/skills/new-module/SKILL.md`: new bullet under the client section (beside the existing "Pure-client page? → offline-mode registry" one) — a structured-text module registers itself in `client/src/core/contentFormat/registry.ts`
- [x] `architecture.md`: module registry row for `brotli`; a short paragraph in Key Data Flows covering both hand-off directions and the decompression-bomb guard
- [x] `tech-stack.md`: note Brotli is Node's built-in `zlib`, not a new dependency (worth stating explicitly, since every other recent addition to that table *was* a new package)
- [x] `decisions.md`: log the server-vs-WASM call, the bomb-guard cap choice, and the registry-mirrors-library-registry decision, dated
- [x] `context-sync` pass once implemented; update `.agent/memory/progress.md`; archive this plan file into `completed/` in the implementation PR

## Acceptance criteria

1. Compressing a real file and decompressing the result byte-for-byte reproduces the original — verified against a file also round-tripped through the standalone `brotli` CLI, so "universal" is proven, not assumed.
2. A `.br` file produced by the standalone `brotli` CLI (or a browser's own `Accept-Encoding: br` handling) decompresses correctly here, and vice versa.
3. An input past `BROTLI_MAX_INPUT_MB` is rejected before the server does meaningful compression work (content-length pre-check), and a chunked request with no declared length is still caught by the streaming counter.
4. A crafted small `.br` file that would decompress past `BROTLI_MAX_OUTPUT_MB` is aborted **before** memory grows unbounded — proven with a real bomb file, not just a code read; peak memory during the attempt stays bounded regardless of whether the abort produced a clean 413 or a destroyed connection.
5. Clicking "Compress with Brotli" on Runestone/Edda/Loki/Groot/Atlas navigates to `/brotli` with that tool's current buffer already compressed and shown — no extra click required.
6. Pensieve and Variant show **no** "Compress with Brotli" button anywhere on their pages — checked by reading both files, not just by never having added one.
7. Decompressing a JSON document offers "Open in Runestone"; clicking it opens Runestone with that content, without a page reload losing anything already open elsewhere (route/session-level hand-off, no cross-feature import).
8. The same for a valid XML document → Atlas, a YAML mapping/sequence → Groot, and a Markdown document with at least two real constructs → Edda.
9. A bare JSON scalar (`"hello"`), a chat-log-shaped plain-text file, and a prose paragraph with one stray asterisk each do **not** trigger a false "Open in…" offer — or if the YAML chat-log case does (the documented residual fuzziness), it's the one deliberately accepted case, not a surprise.
10. Content that matches none of the four formats shows the decompressed text/download with **no** "Open in…" button at all.
11. A decompressed binary file (a null byte present) never runs format detection and never renders as text — download only.
12. A decompressed blob past the detection size threshold still displays/downloads correctly; detection is skipped, not attempted-and-frozen.
13. `/brotli` works identically on `DEPLOY_PROFILE=cloud` as on `local` — both routes reachable, caps enforced the same way.
14. No route or usecase in the `brotli` module imports `zlib`'s Brotli API directly — only `NodeBrotliCodec` does.
15. Neither Brotli route sets `Content-Disposition`; the client names every downloaded file itself.
16. `new-module/SKILL.md` names the content-format registry as a step for a future structured-text module — verified by reading the file, not just claiming the task is done.
17. `brotli` is **absent** from both `offline-mode`'s `TARGETS` (server) and `offlineWarmLoad.ts`'s loader map (client) — a cold, un-warmed `/brotli` with the bridge down shows `RouteBoundary`'s existing "the bridge is down" panel, the same as any other un-warmed route, never a page that opens and then fails on the first click.
18. Compressing the same input at Fast/Balanced/Best produces three different, all-correct (round-trip-verified) outputs, generally trading size for speed; Balanced, not Best, is what a fresh page load defaults to.
19. The gzip comparison shows real numbers for a real input, computed with **no additional server request** (verified by watching the network panel) — and the comparison panel is simply absent, not broken or erroring, in a context where `CompressionStream` doesn't exist.
20. "Copy as base64" round-trips: decoding the copied string reproduces the exact compressed (or decompressed) bytes.
21. "Send to Hermes" puts a real entry on the clipboard board, readable from a second device/tab exactly like any other Hermes entry; an oversized payload fails with Hermes's own existing error, not a new one invented for this feature.
22. The technical footer's stated quality matches what was actually requested, and its window-size claim is true — verified by inspecting the real compressed bytes' Brotli stream header, not just trusting the label.
23. `features/brotli/api.ts` calls `/api/clipboard` directly; `features/hermes/api.ts` is not imported anywhere under `features/brotli/` — a real grep, not an assumption, since this is exactly the boundary rule `eslint-plugin-boundaries` exists to enforce.
24. Feeding garbage bytes to `/decompress` fails cleanly with `422 INVALID_BROTLI` when the failure happens before any output was produced; a `.br` file that decodes correctly for a while and is then truncated instead ends the connection (checked via a real truncated fixture, not just a code read) — both logged, neither silently swallowed.
25. Compressing on Loki sends the **output** pane's content, verified with input and output deliberately different in the test — a same-content fixture would hide this bug entirely.
26. The "Compress with Brotli" button is disabled, not just inert, on an empty document in each of the five editors.
27. After a result is already showing, switching Fast → Best re-compresses immediately with no separate button press.
28. A decompressed 400 MB text-shaped blob (comfortably under `BROTLI_MAX_OUTPUT_MB`, comfortably over the display/detection threshold) offers a download and attempts **neither** an inline view nor format detection — the tab stays responsive throughout, checked, not assumed.
29. "Copy as base64" and "Send to Hermes" both refuse a compressed-output-sized-and-larger blob outright, before attempting the encode — not after a visible stall.
30. A client that closes the connection mid-compress or mid-decompress leaves no dangling zlib stream running server-side (checked via a process-level check during a forced-abort integration test, not inferred from the code alone).

## Test checklist

- [x] Unit: `NodeBrotliCodec` — round-trip correctness against Node's own `zlib.brotliCompressSync`/`brotliDecompressSync` as an oracle; input cap aborts mid-stream; output cap aborts a real bomb file mid-stream without buffering past the cap (assert on peak memory or on bytes-read-before-abort, not just the final error)
- [x] Integration: `POST /api/brotli/compress` + `/decompress` happy path via `fastify.inject` with a raw body; 413 matrix (declared-oversize, undeclared/chunked-oversize, bomb-shaped decompress); 422 on garbage input; a truncated-mid-stream `.br` fixture ends the connection rather than hanging or 500ing; a forced client-abort mid-request leaves no dangling stream
- [x] Unit: `detectFormat` — one true-positive and one true-negative per kind, the JSON-vs-YAML ordering case, the bare-scalar JSON exclusion, the two-construct Markdown threshold
- [x] Unit: `markdownHeuristic` in isolation — a real README-shaped fixture matches, a plain paragraph does not, a single stray `*` does not
- [x] Client: `BrotliPage` — seed arrival auto-compresses; decompress → detect → "Open in…" wiring for each of the four kinds; no-match case renders no button; a blob over the display/detection threshold shows a download-only state with no parser or editor ever invoked (spy/assert, not just eyeball)
- [x] Client: `looksLikeText`-equivalent — samples only the bounded prefix, verified against a large fixture where the only null byte sits well past the sample window (must still read as "text", proving the scan didn't silently read further than intended)
- [x] Client: quality selector — each of the three settings reaches the server as the right `?quality=` value and the response round-trips correctly; changing it after a result exists triggers exactly one new compress call, not zero and not a duplicate
- [x] Client: gzip comparison — feature-detection branch (mocked `CompressionStream` present/absent), size numbers match a known-good gzip of a fixed fixture, zero network calls made for it
- [x] Client: "Copy as base64" — round-trip test (base64-decode the copied string, compare bytes)
- [x] Client: `sendToHermes` — posts to `/api/clipboard` with the right encoding (base64 vs. plain text) per source; a static import-boundary check (or the existing lint) confirms no `features/hermes/*` import under `features/brotli/`
- [x] Client: each of the five outbound buttons calls `putBrotliSeed` with the tool's actual current buffer, not a stale snapshot; Loki's specifically sends the output pane with input and output set to different fixture values; each of the five is disabled on an empty buffer
- [x] Client: each of the four inbound seeds is read-and-cleared exactly once (a second mount/refresh does not re-apply it)
- [x] Live-verify: a real file round-tripped through the app and through the OS `brotli` CLI compare byte-identical; each of the five "Compress with Brotli" buttons and each of the four "Open in…" buttons exercised in a real browser
