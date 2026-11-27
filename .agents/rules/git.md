# Git Rules (non-negotiable)

## Branches

- `main` — protected. **No direct human commits, ever.** Receives merges from `develop` only, via PR, at release points. The one automated exception: `.github/workflows/release.yml` pushes the `chore(release): vX.Y.Z` commit + tag to `main` (and merges it into `develop`) after a develop→main merge, via the `RELEASE_TOKEN` PAT — see docs/releasing.md. `.github/workflows/sync-develop.yml` also merges (never squashes) any other push to `main` — e.g. a hotfix — into `develop`, so develop never falls behind main.
- `develop` — integration branch. All plan work lands here via PR.
- Feature branches — one per plan: `feat/plan-XX-<slug>` (e.g. `feat/plan-02-file-transfer`). Fix branches: `fix/<slug>`.

> A plan file may declare an explicit, scoped exception to these rules; the plan file wins for that plan only (see CLAUDE.md precedence).

## Flow for implementing a plan

1. `git checkout develop && git pull`
2. `git checkout -b feat/plan-XX-<slug>`
3. Implement, committing incrementally (see commit rules).
4. Run the `verify` skill (`.claude/skills/verify/SKILL.md`) locally — must pass.
5. Push and raise a **PR into `develop`**. Title: `feat(plan-XX): <summary>`. Body: what the plan delivered, any deviations + why, test evidence.
6. CI must be green. User reviews and merges. Never self-merge.
7. In the same PR: mark the plan `done` in `.agents/memory/progress.md`'s plan table, remove its row from `plans/README.md`, and delete the plan file (git keeps it; the merged code is the spec of record). Add a `decisions.md` line for each deviation or owner call a later change could undo.

## Commits — Conventional Commits, enforced by commitlint + husky

- Format: `<type>(<scope>): <subject>` — types: `feat fix docs style refactor perf test build ci chore`.
- **Scope = module or core area**: `file-transfer`, `heimdall`, `themes`, `core`, `client`, `ci`, `docs`.
- Subject: imperative, lowercase, no period, ≤ 72 chars.
- Body explains **why, not what** — the diff already shows what. Reference the plan: `Refs: PLAN-02`.
- Small, atomic commits. Never mix refactor + feature in one commit.
- **No `Co-authored-by` trailer in a commit message** unless the owner explicitly asks for one on that commit (owner, 2026-10-28). This holds for commits made by AI agents too.
- **A PR's merge (squash) message carries `Co-authored-by` lines only when the PR holds commits from more than one author**: one line per author other than the one merging, taken from the PR's commits. A single-author PR's merge message has none.
- **A PR's merge (squash) message carries `Reviewed-by` lines only when the PR had reviewers**: one line per person or review bot, other than the PR's author, who submitted a review on it (an approval, changes requested, or review comments), written `Reviewed-by: <name> (<GitHub login>)`, e.g. `Reviewed-by: Codex (chatgpt-codex-connector[bot])`. No `@` before the login, so the merge notifies nobody. The lines go at the end of the message, before any `Co-authored-by` lines. A PR nobody else reviewed has none, and an ordinary commit never carries one (owner, 2026-10-28).
- **A PR's description carries the same `Reviewed-by` lines while it is open**: whenever a person or review bot other than the PR's author submits a review, add their line to the end of the description, just before the closing attribution lines, in exactly the merge message's form (`Reviewed-by: <name> (<GitHub login>)`, no `@`), so the credit shows on the PR itself and the merge message can copy the lines. One line per reviewer however many reviews they leave (owner, 2026-11-22).

Example:

```
feat(file-transfer): stream uploads to tmp with atomic rename

Writing directly to uploads/ risked half-written files becoming
visible after a mid-upload crash. tmp + rename() makes publication
atomic, so restart-safety needs no cleanup logic in the hot path.

Refs: PLAN-02
```
