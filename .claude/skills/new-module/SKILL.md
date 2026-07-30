---
name: new-module
description: Scaffold a new Bifrost feature module (server vertical slice + client feature) that respects the boundary rules. Use whenever a plan or the owner introduces a new module, before writing any feature logic.
---

# New Module — scaffold a vertical slice

Read `.agent/context/architecture.md` first. The three rules are law: feature-first slices; modules import only `core` (cross-module = event bus only); the profile manifest decides what loads.

## Server (`server/src/modules/<name>/`)

1. `module.ts` implementing the `FeatureModule` contract `{ name, register(app, deps) }` (see `server/src/core/module.ts`; `name` doubles as commit scope and capability name) — copy the shape from an existing module (e.g. `qr-tool` for simple, `file-transfer` for full).
2. Subfolders as needed: `routes/` (HTTP only), `usecases/` (business rules — depend on the repository *interfaces* in the module's `ports.ts`, never Drizzle/fs directly), `services/` (concrete impls).
3. New tables go in the central `server/src/core/db/schema.ts` (drizzle.config reads only that file) with a doc comment naming the owning module — then follow the `db-migration` skill.
4. New events: add typed names + payloads to `core/bus/events.ts` — dot-namespaced `<module>.<event>`. Never import another module to "notify" it.
5. Register in `MANIFEST` in `server/src/app.ts` (`local`, `cloud`, or both); `/api/capabilities` exposes it automatically from the manifest.
6. Config: new env keys go in `.env.example` with inline docs + the zod schema; runtime-mutable values go in the `settings` table instead.

## Client (`client/src/features/<name>/`)

7. Feature slice with route-level code splitting; nav renders from `/api/capabilities`, never hardcoded. The client folder name may be a page codename that differs from the server module name (existing mappings: `clipboard`→`hermes`, `qr-tool`→`sigil`, `presence`→`wardens`) — record the mapping in architecture.md's module registry.
   - **New top-level route root?** Add its first segment to `RESERVED_ROOTS` in `server/src/core/reserved-roots.ts` (and the assertion list in `reserved-roots.test.ts`) in the same change — otherwise a Portkey go-link slug could shadow the new page (`rules/coding.md` → Routing). Applies to any new server route outside `/api/` too. Nested/param routes under an existing root need no entry.
8. Styling via tokens only — zero hardcoded colors/sizes (grep for hex before finishing).
9. Shared logic goes in `client/src/core/`, never imported across feature folders.

## Finish

10. **Log the failure paths as you write them** (`rules/coding.md` → Errors & logging): every new failure path gets a `warn`/`error`/`fatal` line where it is handled, with `{ err, ...identifiers }`; every deliberately silent `catch` gets a comment saying why silence is correct. A module is not done until this is true — retrofitting it later means re-deriving what each swallow was hiding. Client-side code in the matching feature slice logs through `core/log.ts`, never `console.*`.
11. Unit tests for every usecase (mock the interfaces) + at least one `fastify.inject` route test.
12. Run the `verify` skill. Confirm the boundaries lint passes — an accidental cross-module import must fail the build.
13. Update `.agent/context/architecture.md` module registry + `project-structure.md`, and add a session note to `progress.md`.
