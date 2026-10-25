# micromatch shim

Installed in place of `micromatch` by the root `package.json` `overrides`. It exists for one reason: `micromatch@4.0.8` depends on `braces@3.0.3`, which carries a high-severity advisory (GHSA-vfj7-8cjw-p6xm, stack exhaustion on deeply nested brace patterns) with **no patched release**. Its only consumer here is `eslint-plugin-boundaries` (and its `@boundaries/elements`), which calls exactly `isMatch`, `capture` and `makeRe`.

In micromatch 4.0.8 those three are passthroughs to `picomatch` and never call `braces`. This package is those three functions, copied verbatim (MIT, see `LICENSE`), on the same `picomatch ^2.3.1`. Matching is identical; `braces` is simply not installed. Any other micromatch function throws by name, so a plugin upgrade that needs more fails lint loudly.

Checked when it was added (2026-10-08): 4,488 comparisons of `isMatch`, `capture` and `makeRe` against the real micromatch 4.0.8, over the repo's boundary patterns plus brace, range, extglob and negation cases with and without `dot`/`contains`, gave 0 differences. `npm run lint` is the standing check: the boundary rules run through it on every lint.

**Remove it** (the override and this folder) once `braces` ships a fix or `eslint-plugin-boundaries` stops depending on micromatch.
