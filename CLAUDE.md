# CLAUDE.md — Bifrost

Project guidance lives in `.agents/`. **The code is the source of truth.** These files are guidance: the rules, a map, why things are the way they are, and where the project stands. When a file and the code disagree, trust the code and fix the file.

## Read at the start of every session (about 70 KB in all)

1. `.agents/context/architecture.md`: module system, dependency rules, processes, builds
2. `.agents/context/tech-stack.md`: chosen tools and why
3. `.agents/context/project-structure.md`: where files go
4. `.agents/rules/git.md`: branching, commits, PR flow (non-negotiable)
5. `.agents/rules/coding.md`: code conventions and boundaries
6. `.agents/memory/progress.md`: where the project stands, open owner checks
7. `.agents/memory/decisions.md`: the decisions still in force. Never reverse one silently.
8. The active plan file in `.agents/plans/`, if there is one (`progress.md` says which)

The detail of earlier work is in git, not here: commit messages, PR descriptions, and old versions of these files (`git log -p -- .agents/memory/decisions.md`; deleted files such as finished plans: `git log --diff-filter=D --name-only -- .agents/`).

## Working rules

- Implement exactly one plan file at a time, in order. Do not start a plan whose gate (see `plans/README.md`) is not cleared.
- If a plan file explicitly overrides a rule in `rules/`, the plan file wins for that plan only.
- **Keep `.agents/` short.** When work changes where the project stands (a plan's status, a release, an owner check), update that line in `progress.md`. When you make a decision a later change could undo without knowing it, add one line to `decisions.md` (date, decision, why), replacing any line it supersedes. Never log steps, test runs or session stories: commits and PR descriptions hold those.
- Never modify plan files without being asked. Ask the user when a plan is ambiguous instead of guessing.
- Keep all storage paths, limits, and secrets in `.env`; never hardcode.
- **`npm audit` must report 0 vulnerabilities, and a finding is fixed before any other work**: from `npm install`, CI, the daily `audit.yml` or anywhere else. The procedure is in `.agents/rules/coding.md` ("Dependencies").
- Project skills live in `.claude/skills/`. `.agents/skills` is a symlink to that directory so Codex and other AGENTS.md-aware tools discover the same skills. Create or edit a project skill only in `.claude/skills/`; do not duplicate it or add a per-skill symlink under `.agents/`. Prefer invoking a matching skill over an ad-hoc procedure; run `verify` before every PR.
- Run repo tasks through `./bifrost` (`./bifrost help`, `./bifrost list --json`), not by reading `package.json` files; see `rules/coding.md`, "Repo tasks".
