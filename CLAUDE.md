# CLAUDE.md — Bifrost

All project knowledge lives in `.agents/`.

## Required reading (every session, before writing any code)

1. `.agents/context/architecture.md` — module system, dependency rules, deployment profiles
2. `.agents/context/tech-stack.md` — chosen tools and why
3. `.agents/context/project-structure.md` — where files go
4. `.agents/rules/git.md` — branching, commits, PR flow (non-negotiable)
5. `.agents/rules/coding.md` — code conventions and boundaries
6. The top of `.agents/memory/progress.md` — the plan status table and the newest recent-activity entries
7. The active plan file in `.agents/plans/`, if there is one (the status table says which)

`.agents/memory/decisions.md` is the decision log and too long to read whole: search it for the module or topic you are touching before making or changing a design call, and never re-litigate a logged decision silently.

`.agents/memory/history.md` is the archive of older sessions and the full detail behind `progress.md` entries. It is too long to read whole, so search it by module, plan number, branch or file name whenever the history of what you're touching matters: the owner refers to earlier work, you're changing or debugging code an earlier session built or fixed, a `progress.md` or `decisions.md` entry points at detail it doesn't include, or you need to know how something was tested or live-verified before.

## Working rules

- Implement exactly one plan file at a time, in order. Do not start a plan whose gate (see `plans/README.md`) is not cleared.
- If a plan file explicitly overrides a rule in `rules/`, the plan file wins for that plan only.
- After completing any task, update `.agents/memory/progress.md`. After making any non-trivial decision not covered by a plan, append it to `.agents/memory/decisions.md` with date and reasoning.
- Never modify plan files without being asked. Ask the user when a plan is ambiguous instead of guessing.
- Keep all storage paths, limits, and secrets in `.env` — never hardcode.
- **`npm audit` must report 0 vulnerabilities, and a finding is fixed before any other work**: from `npm install`, CI, the daily `audit.yml` or anywhere else. The procedure is in `.agents/rules/coding.md` ("Dependencies").
- Project skills live in `.claude/skills/`. `.agents/skills` is a symlink to that directory so Codex and other AGENTS.md-aware tools discover the same skills. Create or edit a project skill only in `.claude/skills/`; do not duplicate it or add a per-skill symlink under `.agents/`. Prefer invoking a matching skill over an ad-hoc procedure; run `verify` before every PR.
