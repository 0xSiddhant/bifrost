# PLAN-43 — Per-tab editor drafts: isolated recovery across Ollivanders

## Goal

Replace the shared, one-draft-per-feature localStorage slots with isolated tab/workspace drafts so opening the same editor in multiple tabs cannot overwrite another tab's work. A tab silently restores only its own matching draft after reload; a blank tab may be offered one eligible draft from a tab known to have closed, and accepting transfers it exactly once. Preserve the last recoverable draft for each feature, prune only the exact closed-tab draft when another durable draft for that feature remains, and retain rather than guess whenever browser lifecycle or storage state is uncertain. Apply the same recovery contract to Runestone, Edda, Groot, Atlas and Variant, including unsaved changes to saved documents and Variant's separate JSON/text workspaces.

## Gate

PLAN-42 merged before implementation. **Documentation-only exception:** PLAN-42 and PLAN-43 are submitted together in one PR at the owner's direction; this does not waive the implementation gate.

## Verified against the codebase, not assumed

- **The collision is in the shared cache contract.** `client/src/core/draftCache.ts` debounces writes by 500 ms, flushes on unmount and `pagehide`, and calls each feature's `save`/`clear` callbacks. Runestone, Edda, Groot and Atlas all call this hook, and each `features/<tool>/draft.ts` writes to one fixed localStorage key for the whole origin. Two tabs using the same feature therefore write the same record.
- **Restore is currently scratch-only and prompt-based.** Each editor reads one shared draft when its scratch route opens. It offers it only while blank; Runestone and Groot also use `core/draftReturn.ts` to silently restore after an in-app feature hand-off. `useDraftCache` skips saved-document routes (`isScratch === false`), so unsaved edits to a saved document are not protected. Variant has no draft cache; its JSON and text pane states are separate, and its URL can identify saved Runestones.
- **Clear/save paths are feature-wide today.** The editors call `clearDraft()` on save, new-document or discard actions. Those calls must become scoped to the current tab and workspace; a save or discard in one tab must never remove another tab's draft.
- **Storage is per same-origin browser profile, not per device.** `localStorage` is shared by tabs on the same origin; the browser `sessionStorage` namespace is scoped to a top-level browsing context and survives reloads. The implementation must empirically test duplicate-tab behavior because some browsers copy a tab's initial `sessionStorage`, which can duplicate a cached tab ID.
- **`pagehide` is not a close guarantee.** The current hook itself uses it for flushes on both reload/navigation and other page-lifetime changes. A page can also be frozen or discarded under memory pressure without a dependable final callback. `visibilitychange` to hidden and a missed heartbeat do not prove that the user closed a tab.
- **Draft values and semantics differ by editor.** Runestone/Groot/Edda/Atlas hold title and text, while Atlas's blank value includes a plist skeleton. Saved editors compare against a server-loaded snapshot. Variant has two independent workspaces (JSON and text), two panes in each, and compare results derived only after an explicit Compare action. Cross-feature seeds (`runestoneSeed`, `eddaSeed`, `grootSeed`, `atlasSeed`, `variantSeed`) represent a fresh user-requested hand-off and must take precedence over a stale restore offer.
- **The shared-draft rule was explicitly decided.** `decisions.md` (2026-10-10) says the cache mirrors the buffer, blank edits preserve the offered draft, and the restore prompt appears only for an earlier visit while blank. The 2026-08-10 decision keeps silent in-session return only for Runestone and Groot. This plan replaces the shared storage/restore ownership model, not the existing blank-buffer safeguard or the in-session return behavior.
- **There is no server/API surface for drafts.** This is local browser recovery for the hub and standalone builds; no new route, server storage, database migration or cross-device synchronization is involved.

## Scope

**In:**

- Stable tab identity and non-colliding localStorage records, keyed by tab, editor feature and workspace (scratch or saved-document identity).
- Automatic same-tab reload recovery for Runestone, Edda, Groot, Atlas and Variant, including both Variant workspaces; saved-document edits restore as unsaved local work and are never silently sent to the server.
- A one-time, user-confirmed transfer from a known-closed tab when the current tab has no matching draft.
- Safe close cleanup: remove only the closing tab's exact feature/workspace record when another durable record for that feature remains; retain the final recoverable record.
- Conservative browser lifecycle handling, migration from the current singleton draft keys, explicit error handling, tests, and directly related documentation.

**Out:**

- Server-side, cross-device, account-based or cloud draft synchronization.
- Automatically saving recovered local changes to a saved document on the server.
- Persisting derived UI such as Variant's old compare results; restore source panes/options and require a fresh Compare.
- Deleting drafts by age, storage pressure, visibility change, failed heartbeat, invalid metadata or an unconfirmed close.
- General storage refactors unrelated to the five editor/workbench features above.

## Decisions & reasoning

### One durable slot per tab, feature and workspace

Give each top-level browser tab a stable opaque ID stored in `sessionStorage`; keep the draft payloads in `localStorage`, which is already the chosen best-effort draft store. Use separate namespaced keys rather than one shared serialized registry, so writes from independent tabs cannot overwrite each other's payload or lose each other's index updates. A draft envelope records its schema version, tab ID, feature, workspace identity, payload, and save time; validate the envelope before using or deleting it.

The workspace identity is `scratch` or the stable saved-document identity, not merely the feature. Navigating between two saved documents in one tab must not overwrite one document's unsaved edits with the other's. Variant stores both its JSON and text workspaces together under that tab's Variant slot, including each pane's text/label/source and relevant options; compare results are discarded and recomputed only after the user presses Compare.

### Same-tab recovery is silent; cross-tab recovery is offered and single-use

On startup, a tab first checks its own tab/feature/workspace slot. A valid matching draft restores into that editor without a prompt, which is the common reload/offload-recovery path. It remains unsaved: a saved-document route keeps the server snapshot as the baseline, restores the local working copy as dirty, and never writes it to the API automatically. If the server document changed since the saved draft's baseline, keep both versions and offer explicit **Keep local draft** / **Use server version** actions instead of replacing either.

If there is no own matching draft, show at most one **Restore draft from another tab?** prompt for an eligible record whose source tab is known to have closed. Select the first eligible record in deterministic key order, and leave the source untouched when the user dismisses. On acceptance, transfer rather than clone: establish a single-use claim, write and verify the destination record, then remove the source. If destination persistence fails, release the claim and preserve the source; if source removal fails, mark the transfer consumed so it cannot be offered twice. A hand-off seed always wins over a cross-tab offer.

The tab ID must remain unique even when the browser duplicates a tab and copies its `sessionStorage`. Verify this behavior in supported Chromium and WebKit browsers and implement a collision handshake before enabling writes; a collision must allocate a fresh ID without overwriting either tab's draft.

### A close signal is evidence, not proof by itself

No browser API reliably distinguishes "tab closed" from every reload, navigation, BFCache transition or process eviction. `pagehide`, `beforeunload`, visibility changes and heartbeat expiry alone must never trigger deletion or transfer. Before implementation, spike the lifecycle/identity signals in Chromium and WebKit, including reload, in-app navigation, BFCache, tab close, duplicate-tab, and simulated page freeze/discard.

Only treat a tab as known closed when the protocol has positive close evidence and a cross-tab claim/cleanup lock confirms that the tab has not reclaimed its identity. If the spike cannot distinguish closure safely, keep that record unclaimed and recoverable; disable automatic cross-tab transfer/cleanup for that case rather than risk data loss. No age-only garbage collection.

### Cleanup preserves a last copy and fails closed under races

Serialize close cleanup per feature with a mechanism whose cross-tab exclusion has been verified in both supported browser engines. Under that lock, re-read and validate durable records, then delete only the closing tab's exact workspace record if at least one other valid record for that feature remains. If this is the last record, keep it for the existing restore flow. Concurrent tab closures must not each observe a peer and collectively delete every record.

If locking, storage access, schema validation or the peer check fails, do not delete. Saving or clearing a workspace affects only the current tab's key; no code path may implement a feature-wide `localStorage.clear()` or remove other tab IDs' entries. Storage quota and access errors are visible through the editor's existing notification/logging patterns, and never trigger cleanup as a fallback.

### Migrate legacy singleton drafts without choosing a winner silently

The existing keys (`bifrost.runestone.draft`, `bifrost.edda.draft`, `bifrost.groot.draft`, `bifrost.atlas.draft`) may contain the last writer from several tabs, so the data cannot reliably be assigned to its original tab. Treat each as one legacy recoverable draft, not as the current tab's own draft. Under the verified per-feature migration lock, preserve it until a new-format destination has been written and read back; then mark the legacy item migrated/consumed exactly once. If multiple tabs race, at most one receives it, and all others continue with their own isolated state. On any failure, leave the original key intact. Variant has no legacy draft.

### Preserve per-editor behavior while sharing only the storage mechanism

Keep the storage/indexing and tab-lifecycle mechanism in `client/src/core/`; features must not import one another. Each editor supplies its own typed serialization, matching workspace key, blank predicate, and restore/apply behavior. Existing seeds take precedence, Atlas's plist skeleton remains blank, and Runestone/Groot's in-session return remains silent. On explicit save, clear, or discard, delete only the current tab/workspace's draft after the action succeeds; a failed server save keeps it.

## API contracts

None. Draft recovery is entirely client-side; it adds no server routes or API changes.

## Task checklist

- [ ] **Storage identity, claims and safe cleanup**
  - [ ] Add a `client/src/core/` tab-scoped draft store with versioned envelopes, per-tab/per-feature/per-workspace keys, schema validation, and exact-key read/write/remove operations.
  - [ ] Add a stable per-tab ID backed by `sessionStorage`; spike and implement duplicate-tab collision detection in Chromium and WebKit before allowing either tab to write under a duplicated ID.
  - [ ] Implement cross-tab signaling and a verified per-feature lock/claim protocol for transfer, singleton migration and cleanup. If a browser cannot provide safe exclusion, fail closed: do not transfer or delete.
  - [ ] Implement the close-cleanup rule with a serialized peer recheck, preserving the last durable feature draft and leaving drafts untouched when close status is uncertain.
  - [ ] Migrate the four existing singleton keys exactly once, preserving the original until the new-format record is verified and retaining it on any failed or concurrent migration.
  - [ ] Surface storage/lock failures through `client/src/core/log.ts` and the editor notice pattern; a failed persistence or cleanup step must not be reported as success.
- [ ] **Shared hook and editor integration**
  - [ ] Replace feature-provided singleton `save`/`clear` callbacks in `client/src/core/draftCache.ts` with a typed tab/workspace adapter while preserving the 500 ms mirror, unload flush and blank-buffer safeguards.
  - [ ] Hydrate matching same-tab records before the debounce can write an initial blank/default buffer over them; preserve existing React StrictMode idempotence.
  - [ ] Update `client/src/features/runestone/`, `edda/`, `groot/` and `atlas/` to identify scratch and saved-document workspaces and restore matching local edits as unsaved, never auto-saving them.
  - [ ] Preserve the server-loaded baseline for saved-document drafts. If the remote content/modified timestamp no longer matches the stored baseline, keep the local copy and surface a conflict with explicit Keep local / Use server actions; do not overwrite either copy without user choice.
  - [ ] Update the Variant workspace in `client/src/features/variant/VariantPage.tsx` to persist and restore both JSON and text pane state independently, excluding stale derived comparison results.
  - [ ] Preserve seed priority, Runestone/Groot in-session return, Edda/Atlas blank behavior and Atlas's plist skeleton behavior.
  - [ ] Scope save, clear, New, discard and successful-transfer cleanup to the current tab/workspace. Keep a draft when a server save fails.
- [ ] **Tests and docs**
  - [ ] Replace `client/src/core/draftCache.test.tsx`'s single-slot assumptions with multi-tab, multi-workspace tests; add tests for editor-specific serialization/workspace adapters and the shared store/identity/claims.
  - [ ] Add tests for two simultaneous editors saving different text, same-tab reload restoration, no-own-draft prompt, single-use transfer, transfer write failure, simultaneous restore, simultaneous close cleanup, and last-record retention.
  - [ ] Add tests for duplicate sessionStorage IDs, React StrictMode double effects, pagehide/BFCache/offload ambiguity, malformed/legacy records, localStorage quota/security errors, stale server baselines and seeds overriding prompts.
  - [ ] Add Playwright journeys using two pages in the same browser context for each editor family: edit distinct content in both, reload one, verify both remain distinct, close one, verify the peer and last-draft rules, and attempt competing restores.
  - [ ] Update `docs/testing.md` with the multi-tab recovery test procedure and the supported-browser lifecycle limitations; update the README's editor description only if needed to explain tab-isolated recovery.

## Acceptance criteria

1. Two tabs editing the same feature/workspace never overwrite or clear each other's local draft. Saving, clearing or discarding in one tab affects only that tab's matching workspace record.
2. A tab reload/offload that retains its tab identity restores only its own valid matching draft automatically, including saved-document unsaved edits, and does not show a redundant restore prompt.
3. If a tab has no matching draft, a different tab's content is never injected automatically. At most one eligible, known-closed draft is offered; dismissing leaves it intact, and accepting transfers it once without allowing another tab to restore the same source.
4. Transfer writes and verifies the destination before removing the source. On any storage/lock failure or interrupted transfer, at least one recoverable copy remains, and failed saves never clear a draft.
5. Closing a tab removes only its own closed feature/workspace draft when another durable draft for that feature remains. The final durable draft is preserved, including when multiple tabs close concurrently.
6. Uncertain lifecycle states—browser process kill, memory offload, hidden/frozen tabs, BFCache, reload, or unavailable close evidence—never cause a draft to be deleted or treated as a transferable known-closed draft. No TTL-only deletion is implemented.
7. Duplicate tabs cannot share a tab ID and cannot collide while writing; if uniqueness cannot be proven, cross-tab mutation is disabled and existing records remain untouched.
8. Legacy singleton records migrate at most once without being removed before a new record is verified. Concurrent startup or a failed migration leaves the legacy data recoverable.
9. Runestone, Edda, Groot, Atlas and Variant all restore tab-specific content. Variant preserves both workspaces and their pane contents; derived compare results require a new explicit Compare.
10. Restoring a saved-document edit never auto-saves it. If the server baseline changed, both versions remain recoverable and the user explicitly chooses Keep local or Use server.
11. Existing blank-buffer restore behavior, seed precedence, Runestone/Groot in-session returns and Atlas skeleton handling remain correct.
12. Unit/component and Chromium/WebKit multi-tab journeys pass; the project verification gate passes with no silent storage-error or deletion fallback.
13. Drafts remain local to the same-origin browser profile and are never synchronized to the server or another device.

## Test checklist

### Unit

- [ ] Tab identity remains stable across reload and is regenerated on duplicate-tab collision; collisions never write to an existing tab's key.
- [ ] Per-tab/per-feature/per-workspace keys isolate writes and deletes; corrupt or unsupported envelopes are ignored without being deleted.
- [ ] Transfer claims are single-use under concurrent requests; source removal waits for destination read-back; failed writes/release preserve source data.
- [ ] Cleanup serializes peers and never removes the last valid record, including two concurrent close attempts; no close proof means no cleanup.
- [ ] Legacy migration is idempotent and race-safe, and the singleton remains until its destination is verified.
- [ ] Hook tests pin debounce, latest-value flush, StrictMode, blank/offered behavior, seed precedence and workspace-scoped clear.
- [ ] Saved-document restore keeps dirty text and the baseline; mismatches surface a conflict without discarding either version.
- [ ] Variant restores both JSON/text panes and options without restoring stale compare results.

### Browser integration

- [ ] Chromium and WebKit: open two same-origin tabs on the same editor, type different drafts, wait past debounce, reload one tab, and verify both records/content remain independent.
- [ ] Chromium and WebKit: same-tab route navigation, saved-document route edits, Variant JSON/text switching, and pagehide/BFCache return do not cross-restore or clear workspaces.
- [ ] Chromium and WebKit: close one of two tabs, close all but one, and close two concurrently; only the correct closed-tab record is removed and a final recoverable draft remains.
- [ ] Chromium and WebKit: a new tab sees at most one eligible Restore offer; dismiss/accept and simultaneous acceptance preserve single-use ownership.
- [ ] Simulate storage quota/blocked storage, duplicate tab identity and missing close events; the app reports persistence trouble and preserves all readable records.
- [ ] Upgrade a browser profile containing each legacy singleton key and verify the original remains until its isolated replacement is durable.
- [ ] Run the project `verify` skill and `live-verify` the built application with real multiple browser tabs before implementation is handed off.
