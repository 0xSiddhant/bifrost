# Bifrost Theme Spec (placeholder)

> **Status: not yet written.** The theme contract — JSON schema, required
> tokens, validation rules — is defined by PLAN-04 (theming engine).

What is already decided (see `.agent/memory/decisions.md`):

- Themes are JSON files in `themes/`, validated with ajv against a published JSON Schema.
- A theme maps to CSS custom properties set on `:root` (see `client/src/core/tokens.css`).
- Components never hardcode colors — they consume tokens only.
- Fonts are self-hosted in the repo; no font CDNs (LAN may be offline).
