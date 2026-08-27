# Bifrost Architecture

The architecture reference is maintained in one place to avoid drift:

➡️ **[`.agent/context/architecture.md`](../.agent/context/architecture.md)**

It covers the single-process model, the three modularization rules (vertical
slices, no cross-module imports, deployment-profile manifest), the module
registry, the shared core kernel, key data flows, restart safety, and the
storage layout.

Related references:

- Project layout — [`.agent/context/project-structure.md`](../.agent/context/project-structure.md)
- Tech choices & rationale — [`.agent/context/tech-stack.md`](../.agent/context/tech-stack.md)
- Design system & tokens — [`DESIGN.md`](DESIGN.md)
- User-theme schema — [`THEME-SPEC.md`](THEME-SPEC.md)
- Offline mode (warm-load) — [`offline-mode.md`](offline-mode.md)
