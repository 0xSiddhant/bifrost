# CLAUDE.md — Bifrost

All project knowledge lives in `.agent/`. Read it before writing any code.

## Required reading order (every session)

1. `.agent/context/architecture.md` — module system, dependency rules, deployment profiles
2. `.agent/context/tech-stack.md` — chosen tools and why
3. `.agent/context/project-structure.md` — where files go
4. `.agent/rules/git.md` — branching, commits, PR flow (non-negotiable)
5. `.agent/rules/coding.md` — code conventions and boundaries
6. `.agent/memory/progress.md` — what phase we're in, what's done
7. `.agent/memory/decisions.md` — decision log; never re-litigate a logged decision silently
8. The active plan file in `.agent/plans/` (see progress.md for which one)

## Working rules

- Implement exactly one plan file at a time, in order. Do not start a plan whose gate (see `plans/README.md`) is not cleared.
- If a plan file explicitly overrides a rule in `rules/`, the plan file wins for that plan only.
- After completing any task, update `.agent/memory/progress.md`. After making any non-trivial decision not covered by a plan, append it to `.agent/memory/decisions.md` with date and reasoning.
- Never modify plan files without being asked. Ask the user when a plan is ambiguous instead of guessing.
- Keep all storage paths, limits, and secrets in `.env` — never hardcode.
