# CLAUDE.md — Bifrost

All project knowledge lives in `.agents/`. Read it before writing any code.

## Required reading order (every session)

1. `.agents/context/architecture.md` — module system, dependency rules, deployment profiles
2. `.agents/context/tech-stack.md` — chosen tools and why
3. `.agents/context/project-structure.md` — where files go
4. `.agents/rules/git.md` — branching, commits, PR flow (non-negotiable)
5. `.agents/rules/coding.md` — code conventions and boundaries
6. `.agents/memory/progress.md` — what phase we're in, what's done
7. `.agents/memory/decisions.md` — decision log; never re-litigate a logged decision silently
8. The active plan file in `.agents/plans/` (see progress.md for which one)

## Working rules

- Implement exactly one plan file at a time, in order. Do not start a plan whose gate (see `plans/README.md`) is not cleared.
- If a plan file explicitly overrides a rule in `rules/`, the plan file wins for that plan only.
- After completing any task, update `.agents/memory/progress.md`. After making any non-trivial decision not covered by a plan, append it to `.agents/memory/decisions.md` with date and reasoning.
- Never modify plan files without being asked. Ask the user when a plan is ambiguous instead of guessing.
- Keep all storage paths, limits, and secrets in `.env` — never hardcode.
- Project skills live in `.claude/skills/` (verify, release, context-sync, new-module, live-verify, db-migration). `.agents/skills` is a symlink to that directory so Codex and other AGENTS.md-aware tools discover the same skills. Create or edit a project skill only in `.claude/skills/`; do not duplicate it or add a per-skill symlink under `.agents/`. Prefer invoking a matching skill over an ad-hoc procedure; run `verify` before every PR.
