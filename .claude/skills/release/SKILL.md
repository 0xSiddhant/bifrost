---
name: release
description: Cut a Bifrost release (develop → main) — version bump, changelog, tag, GitHub Release. Use when the owner says "release", "cut vX.Y.Z", or "merge to main". Manual procedure until PLAN-09's release automation ships; afterwards this skill only covers preflight and the main-merge PR.
---

# Release — develop → main

Hard rules: never push to `main` directly; every change reaches `develop` via branch + PR first; every merge is performed by the owner (STOP and wait); the develop→main PR must be merged with a **merge commit, never squash** (squash would destroy the conventional-commit history that release automation computes versions from).

## Procedure

1. **Preflight** on a clean `develop`: all plans intended for this release are `done` in `.agent/memory/progress.md` AND their merge commits exist on develop. Run the `verify` skill. Abort on any mismatch.
2. **Context sync** (branch `chore/vX-context-sync` → PR → develop): audit `.agent/context/`, `.agent/rules/`, `docs/ARCHITECTURE.md`, `docs/THEME-SPEC.md`, `README.md` against the codebase; fix divergences; log decision drift in `decisions.md`. STOP for owner merge.
3. **Release prep** (branch `chore/release-vX.Y.Z` → PR → develop): bump root + workspace `package.json`; regenerate `CHANGELOG.md` with changelogen (file only, no tag/push); append the release row to `decisions.md`; session note in `progress.md`. Commit `chore(release): prepare vX.Y.Z`. STOP for owner merge.
4. **Release PR**: `develop → main`, title `release: vX.Y.Z`, body = shipped summary + changelog link. CI green. STOP for owner merge (merge commit).
5. **Tag + Release**: on updated main — annotated tag `vX.Y.Z`, push tag, `gh release create` with the changelog section as notes (or print the command if `gh` is missing).
6. **Back-merge**: `git checkout develop && git merge main --ff-only && git push`. If ff-only fails, STOP and report — never force.
7. Report: tag URL, release URL, develop==main confirmation, deviations.

Version rule: compute the bump from conventional commits since the last tag (`feat:`→minor, `fix:`→patch, breaking→major) unless the owner names a version explicitly.
