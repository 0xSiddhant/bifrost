---
name: context-sync
description: Audit and update Bifrost's .agent knowledge files against the actual codebase so AI context never rots. Use at every release point, after any plan merges with deviations, or when the owner says the docs feel stale.
---

# Context Sync — keep `.agent/` truthful

Goal: `.agent/context/*.md` and `.agent/rules/*.md` must describe the code as it exists, not as it was planned. Claude Code treats these as ground truth at session start; drift causes contradictions and re-derived decisions.

## Procedure

1. Work on a branch (`chore/context-sync-<date>`); this always lands via PR to `develop`.
2. For each file — `context/architecture.md`, `context/tech-stack.md`, `context/project-structure.md`, `rules/coding.md`, `rules/git.md` — diff its claims against reality:
   - module list vs `server/src/modules/` + the manifest
   - core services vs `server/src/core/`
   - dependency versions vs lockfile (React, Fastify, etc.)
   - DB tables vs Drizzle schemas/migrations
   - event names vs `core/bus/events.ts`
   - env keys vs `.env.example`
   - scripts table in README vs `package.json`
3. Also check the public mirrors: `docs/ARCHITECTURE.md`, `docs/THEME-SPEC.md` (vs the shipped ajv schema), root `README.md` feature list.
4. Update files to match reality. **Direction of truth: code wins**, unless the divergence violates a logged decision — in that case report it as a regression instead of documenting it.
5. Anything that was a real decision drift (not just stale prose) gets a new dated row in `.agent/memory/decisions.md`. Never edit or delete existing rows.
6. Do NOT touch plan files (they are historical specs) or session notes.
7. Output a divergence table in the PR body: file · claim · reality · action taken.
