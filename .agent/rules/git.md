# Git Rules (non-negotiable)

## Branches

- `main` — protected. **No direct commits, ever.** Receives merges from `develop` only, via PR, at release points.
- `develop` — integration branch. All plan work lands here via PR.
- Feature branches — one per plan: `feat/plan-XX-<slug>` (e.g. `feat/plan-02-file-transfer`). Fix branches: `fix/<slug>`.

> A plan file may declare an explicit, scoped exception to these rules; the plan file wins for that plan only (see CLAUDE.md precedence).

## Flow for implementing a plan

1. `git checkout develop && git pull`
2. `git checkout -b feat/plan-XX-<slug>`
3. Implement, committing incrementally (see commit rules).
4. Run `npm run lint && npm run typecheck && npm test` locally — must pass.
5. Push and raise a **PR into `develop`**. Title: `feat(plan-XX): <summary>`. Body: what the plan delivered, any deviations + why, test evidence.
6. CI must be green. User reviews and merges. Never self-merge.
7. Update `.agent/memory/progress.md` in the same PR.

## Commits — Conventional Commits, enforced by commitlint + husky

- Format: `<type>(<scope>): <subject>` — types: `feat fix docs style refactor perf test build ci chore`.
- **Scope = module or core area**: `file-transfer`, `heimdall`, `themes`, `core`, `client`, `ci`, `docs`.
- Subject: imperative, lowercase, no period, ≤ 72 chars.
- Body explains **why, not what** — the diff already shows what. Reference the plan: `Refs: PLAN-02`.
- Small, atomic commits. Never mix refactor + feature in one commit.

Example:

```
feat(file-transfer): stream uploads to tmp with atomic rename

Writing directly to uploads/ risked half-written files becoming
visible after a mid-upload crash. tmp + rename() makes publication
atomic, so restart-safety needs no cleanup logic in the hot path.

Refs: PLAN-02
```
