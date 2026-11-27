# Bifrost Plans

How plans work here. Which plans are done, and their PRs, is in `memory/progress.md`.

- **One plan at a time, in order.** Never start a plan before its gate (below, and in the plan file) is cleared.
- **One plan = one branch = one PR**, unless the plan declares parts.
- **Never modify a plan file unprompted.** Ask when a plan is ambiguous. Deviations go in the PR body, and the ones a later change could undo also go in `memory/decisions.md`.
- **A plan is not done until its failure paths are logged** (PLAN-16): each new failure path gets a `warn`/`error`/`fatal` line where it is handled, and a deliberately silent `catch` says why. See `rules/coding.md`, "Errors & logging".
- **A plan file is deleted once its PR merges.** The merged code is the spec of record; git keeps the file (`git log --all -- .agents/plans/PLAN-XX-*.md`), and `decisions.md` keeps the decisions still in force. The implementation PR deletes the file and marks the plan done in `progress.md`.
- **Format:** goal → gate → verified against the codebase → scope in/out → decisions and reasoning → API contracts → task checklist → acceptance criteria → test checklist. The `new-plan` skill has the detail.

## Open plans

| # | Plan | Gate |
| --- | --- | --- |
| 44 | [Runestone JSONL](PLAN-44-runestone-jsonl.md): JSON Lines as a third Runestone format | PLAN-43 merged |
| 99 | [Future backlog](PLAN-99-future-backlog.md) | Reference only: an item is promoted into a new numbered plan when scheduled |
