---
name: live-verify
description: Prove a change works in the real app — build, run the built server, drive headless Chromium, screenshot. Use after implementing any user-visible or server-behavior change, before handing work to the owner for testing.
---

# Live Verify — built server + headless Chromium

Tests passing is not "live-verified". This is the procedure behind the "live-verified" claim in every session note. It supplements owner testing, never replaces it — test-before-commit still applies.

## Server

1. `npm run build`, then start the **built** server with `npm start` (in the background) — never verify against `npm run dev`. Port comes from `.env` (`PORT`, default 4646). Poll `GET /api/health` until 200 before touching the browser.
2. If the check needs clean state, run with `STORAGE_ROOT=<scratch dir>` instead of touching `storage/`.

## Browser

3. Static check: headless Chromium screenshot — `"<chrome binary>" --headless=new --window-size=1280,900 --screenshot=<scratchpad>/<name>.png http://localhost:4646/<route>` (macOS binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). Always give screenshots descriptive names; a verification run usually produces several.
4. Interaction (clicks, SSE, forms, multi-device): launch Chromium with `--remote-debugging-port` + a scratch `--user-data-dir`, and drive CDP from a throwaway `tsx` script in the scratchpad (`Page.navigate`, `Runtime.evaluate`, `Page.captureScreenshot`). Simulate two devices with two browser targets using different `?deviceId`s / user-data-dirs.
5. Default matrix unless the change is provably narrower: desktop 1280×900 **and** mobile 390×844; both themes if the change touches styling or tokens (the theme engine caches in localStorage — set it before navigation, or click the top-right switcher via CDP).

## CLI changes have no browser (PLAN-27)

A change in `cli/` is live-verified against the **globally installed** `bifrost`
— not `node cli/dist/index.js`, and never the source tree: `npm run build` runs
`scripts/cli-sync.ts`, which packs and `npm install -g`s it, and that install is
half of what is being proven. Run the real commands against the built server and
check three things a unit test cannot:

- **A terminal and a pipe disagree, deliberately.** Colour, symbols and progress
  bars must appear on a TTY and vanish the moment output is piped or redirected.
  `script -qec "<cmd>" /dev/null` gives a real pty when you need to see a bar.
- **`--json` stays machine-readable.** Pipe it through `jq` for real; chatter
  belongs on stderr and must not appear at all in JSON mode.
- **Exit codes**, since a script branches on them: 0/1/3/4/5 per `cli/README.md`.

`man bifrost` after that install is part of the same pass —
`groff -man -Kutf8 -Tutf8 <path>` must render with **zero warnings**.

## Finish

6. SIGINT the server (the kill test exists for a reason — a clean shutdown is part of the verification), close Chromium, and **Read every screenshot** to confirm it actually shows the expected state before claiming success.
7. Report to the owner: what was verified live (with concrete observations, not "looks fine"), and what remains manual (real-device gestures, iOS quirks, etc.). Record the live-verified line in the `progress.md` session note.
