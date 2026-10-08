---
name: live-verify
description: Prove a change works in the real app — build, run the built server, drive headless Chromium, screenshot. Use after implementing any user-visible or server-behavior change, before handing work to the owner for testing.
---

# Live Verify — built server + headless Chromium

Tests passing is not "live-verified". This is the procedure behind the "live-verified" claim in every session note. It supplements owner testing, never replaces it — test-before-commit still applies.

## Server

1. `npm run build`, then start the **built** hub with `npm start` (in the background) — never verify against `npm run dev`. Since PLAN-36 that is two processes: the web host on `PORT` (required, no default; `.env.example` uses 4646), which serves the page and forwards the API's paths, and the API on loopback `API_PORT` (default `PORT + 1`). Drive everything through `PORT`, the one URL people open; poll `GET http://localhost:<PORT>/api/health` until 200 before touching the browser (that answer proves both are up). Run the script with `node --import tsx scripts/start.ts` when you need its PID: `npx` puts a shell in between and a signal to it never reaches the supervisor.
2. If the check needs clean state, run with `STORAGE_ROOT=<scratch dir>` instead of touching `storage/`. To see what a device sees while the API restarts, do not use `npm start`: its supervisor stops the web host the moment the API dies. Run the two yourself instead, the API with `BIFROST_RUN=api node --import ./server/dist/otel.js server/dist/bootstrap.js` and the web host with `node web/dist/bootstrap.js` (same `.env`), then stop and restart only the API: the page must still load, show "The Bifröst is closed", and close the sheet once the API is back.

## Browser

3. Static check: headless Chromium screenshot — `"<chrome binary>" --headless=new --window-size=1280,900 --screenshot=<scratchpad>/<name>.png http://localhost:<PORT>/<route>` (macOS binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). Always give screenshots descriptive names; a verification run usually produces several.
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

6. SIGINT `scripts/start.ts` (the kill test exists for a reason — a clean shutdown of both processes, the web host first, is part of the verification), close Chromium, and **Read every screenshot** to confirm it actually shows the expected state before claiming success.
7. Report to the owner: what was verified live (with concrete observations, not "looks fine"), and what remains manual (real-device gestures, iOS quirks, etc.). Record the live-verified line in the `progress.md` session note.
