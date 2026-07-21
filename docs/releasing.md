# Releasing

After v1.0.0 (cut by hand), releases are automated by
[`.github/workflows/release.yml`](../.github/workflows/release.yml). You never
edit versions or the changelog yourself.

## The normal flow

1. Land your work on `develop` via PRs as usual (conventional commits).
2. When you're ready to ship, open a **`develop` → `main`** PR and merge it
   (a merge commit is fine).
3. The push to `main` triggers `release.yml`, which — untouched by humans —:
   - reads every commit since the last tag and computes the bump
     (`feat:` → minor, `fix:` → patch, `!` / `BREAKING CHANGE` → major);
   - bumps the root + `server` + `client` `package.json` and regenerates
     `CHANGELOG.md` (changelogen);
   - commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes;
   - publishes a **GitHub Release** with that version's changelog section and a
     `bifrost-vX.Y.Z.tar.gz` production build attached (rollback artifact);
   - fast-forwards **`main` → `develop`** so develop carries the bump.

A `chore:`/`docs:`-only merge to `main` produces **no release** (nothing
releasable since the last tag).

## One-time setup: the release token

Pushing to protected `main`/`develop` and tagging needs a token that bypasses
branch protection. Create a **fine-grained PAT**:

- Repository access: this repo only.
- Permissions: **Contents: Read and write**, **Workflows: Read and write**.
- Save it as the repo secret **`RELEASE_TOKEN`**
  (Settings → Secrets and variables → Actions).

Without it the workflow can check out but can't push the release commit.

Guards already in place: a **loop guard** (the workflow ignores its own
`chore(release):` commit) and a `concurrency` group (one release at a time).

## Forcing a specific version

Let the commit types drive it normally. To force a bump (e.g. jump to 2.0.0
without a `!` commit), do it by hand on `main` and let the tag stand:

```bash
git checkout main && git pull
npm version 2.0.0 --no-git-tag-version --workspaces --include-workspace-root
npx changelogen@latest --release --no-commit   # regenerate CHANGELOG only
git commit -am "chore(release): v2.0.0"
git tag v2.0.0
git push origin main --follow-tags
```

The workflow's loop guard skips the `chore(release):` commit, so it won't
double-fire; create the GitHub Release manually (`gh release create v2.0.0`).

## Hotfixes

Branch from `main` (not develop), fix, PR **into `main`**:

```bash
git checkout -b fix/urgent main
# ... fix ...
```

Merging the `fix:` PR to `main` triggers a patch release automatically, and the
back-merge step carries the fix + bump back to `develop`. If the fast-forward
back-merge fails (develop diverged), merge `main` into `develop` manually.

## Deliberately excluded

No container registry push (nothing consumes the image — the Mac runs native
PM2), no auto-deploy (nowhere to deploy), no npm publish (not a library). Add
GHCR the day a Linux host actually pulls the image.
