# Copilot instructions for Bifrost

## Project context

This repo is a local-LAN app called Bifrost. Follow the project’s existing guidance in `CLAUDE.md` and the files under `.agent/` before making code changes.

## Required reading order

Read these in order when starting a task:

1. `CLAUDE.md`
2. `.agent/context/architecture.md`
3. `.agent/context/tech-stack.md`
4. `.agent/context/project-structure.md`
5. `.agent/rules/git.md`
6. `.agent/rules/coding.md`
7. `.agent/memory/progress.md`
8. `.agent/memory/decisions.md`
9. the active plan in `.agent/plans/`

## Core operating rules

- Work in a single plan at a time. Do not start or alter a plan unless the user explicitly asks.
- Keep feature/module boundaries strict: `core/` is shared infrastructure; module code does not import other modules.
- Prefer the project skills in `.claude/skills/` when they match the task.
- Keep storage, paths, limits, and secrets in `.env` rather than hardcoded values.
- Prefer the smallest change that fixes the root cause, and validate with the relevant test(s).
- If a change affects runtime behavior, verify with the most targeted existing test or run.

## Domain-specific constraints

- This app is offline-first and LAN-first. Do not add network-dependent behavior where the project intentionally stays local-only.
- No Service Worker assumptions for plain HTTP LAN usage unless the user explicitly asks for that architecture.
- Keep code and UI aligned with the existing architecture and module system.
- A screensaver, offline-mode, or warm-load change must remain compatible with the project’s pure-client/offline-safe design.

## Git and delivery

- Keep commits focused and scoped to the task.
- Do not commit unrelated changes or generated noise.
- Before finishing, run the relevant validation command and check the result.

## When unsure

- Ask the user for clarification instead of guessing when the plan or expected behavior is ambiguous.
- Prefer exact, targeted reads and minimal edits over broad changes.
