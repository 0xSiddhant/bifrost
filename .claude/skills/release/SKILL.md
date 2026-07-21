---
name: release
description: Cut a Bifrost release (develop → main). Since PLAN-09, the version bump, changelog, tag, GitHub Release, and back-merge are AUTOMATED by .github/workflows/release.yml on push to main — this skill covers only the preflight and the develop→main merge PR, then confirms the automation ran. Use when the owner says "release", "cut vX.Y.Z", or "merge to main".
---

# Release — develop → main (automated since PLAN-09)

`.github/workflows/release.yml` runs on every push to `main`: it computes the
semver bump from conventional commits since the last tag, bumps root + workspace
`package.json`, regenerates `CHANGELOG.md` (changelogen), commits
`chore(release): vX.Y.Z`, tags, publishes a GitHub Release with a build tarball,
and fast-forwards `main → develop`. A `chore:`/`docs:`-only merge produces no
release. Full reference: `docs/releasing.md`.

**So this skill no longer bumps versions, tags, or back-merges by hand** — it
gets a clean release onto `main` and verifies the workflow did the rest.

Hard rules: never push to `main` directly; every change reaches `develop` via
branch + PR first; every merge is performed by the owner (STOP and wait); the
develop→main PR is merged with a **merge commit, never squash** (squash would
destroy the conventional-commit history the workflow reads).

## Procedure

1. **Preflight** on a clean `develop`: every plan intended for this release is
   `done` in `.agent/memory/progress.md` and its merge commit exists on develop.
   Run the `verify` skill. Confirm the repo secret **`RELEASE_TOKEN`** exists
   (fine-grained PAT, Contents + Workflows: write) — without it the workflow
   can't push. Abort on any mismatch.
2. **Context sync** (branch `chore/context-sync-<date>` → PR → develop): run the
   `context-sync` skill so the docs match the code being shipped. STOP for owner
   merge.
3. **Release PR**: open `develop → main`, title `release: <summary>`, body =
   shipped summary. CI green. **STOP for the owner to merge with a merge commit.**
   Do NOT bump the version or edit the changelog here — the workflow owns that.
4. **Confirm the automation** (after the merge): the `Release` workflow run
   succeeds; a new `vX.Y.Z` tag and GitHub Release exist with a `.tar.gz`
   attached; `CHANGELOG.md` updated; `develop` fast-forwarded to `main` (carries
   the `chore(release):` commit). Report the tag URL, release URL, and
   develop==main confirmation.

## When it doesn't fire / needs a hand

- **No release produced** and you expected one → check there was a `feat:`/`fix:`/
  breaking commit since the last tag (chore-only = intentionally no release).
- **Back-merge failed** (develop diverged after the release commit) → merge
  `main` into `develop` manually; never force.
- **Forcing a specific version** or a **hotfix from main** → see `docs/releasing.md`.

Version rule (what the workflow applies): `feat:`→minor, `fix:`→patch,
`!`/`BREAKING CHANGE`→major, since the last tag.
