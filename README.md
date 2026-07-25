<div align="center">

# 🌈 Bifrost

**A LAN-only file transfer & sync hub. Your devices, connected by the rainbow bridge.**

![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/network-mDNS%20%2F%20intranet%20only-8A2BE2)

<!-- TODO: add demo video when the features land (PLAN-02+) -->
<img src="docs/assets/screenshot-home.png" alt="Bifrost home — Aurora theme, the three transfer portals" width="720" />

<img src="docs/assets/screenshot-receive.png" alt="Receive files — live download list with per-type icons" width="720" />

<p>
  <img src="docs/assets/screenshot-send-phone.png" alt="Send files on a phone" width="230" />
  <img src="docs/assets/screenshot-receive-phone.png" alt="Receive files on a phone" width="230" />
  <img src="docs/assets/screenshot-daybreak-phone.png" alt="Daybreak (light) theme on a phone" width="230" />
</p>

</div>

---

## What is Bifrost?

Bifrost turns one Mac on your local network into a private file & sync hub for every device in the house — iPhone, Android, iPad, any laptop. No cloud, no public internet, no accounts. Advertised over mDNS at `http://bifrost.local`.

**Features**

- 📤 Multi-file upload (streamed, 2 GB configurable limit) into a write-only folder
- 📥 Live download page — drop a file into a folder in Finder, it appears on every device instantly (SSE)
- 👁 In-browser previews — images, PDF, video (seekable), markdown
- 📋 Hermes — clipboard/text sync across devices
- 🔳 Sigil — QR generator ("Make a QR"); a scan-to-join QR for the server URL lives on the home page
- 🎨 Dynamic themes (Aurora, Daybreak, Ghibli Dusk, Olympus built in), addable via JSON
- 🧿 Runestone — JSON viewer/editor with a saved-document library (Pensieve); each saved doc doubles as a public data URL; in-editor find + tree collapse-all
- ⚖️ Variant — structural JSON diff (key order & formatting are noise) with a raw-text fallback; find with cross-pane reveal
- 🧹 Nimbus — LAN speed test: download/upload/latency between a device and the bridge, with per-device history
- 🛡 Heimdall — hidden admin panel (secret gesture/shortcut + PIN)
- 📜 Wardens — device presence dashboard with character-name aliases; upload history & activity log in Heimdall
- 🔁 Restart-safe: all state survives server stop/start

**Navigation** groups these into three category tabs: **Midgard** (Send / Receive / Hermes + Join-Bifrost QR), **Ollivanders** (Runestone / Variant / Edda / Loki), and **Diagon Alley** (Sigil / Nimbus + a coming-soon utility toolbox). Each tool keeps its own URL.

## Quick start

> Prerequisites: **Node.js ≥ 20**, **npm ≥ 10**, macOS (primary host target).

```bash
# 1. install dependencies
npm install

# 2. create local env from template
cp .env.example .env

# 3. create runtime folders (storage/{uploads,downloads,tmp,data,logs})
npm run setup

# 4. run in dev (server + client, hot reload)
npm run dev
```

Then open `http://bifrost.local:<PORT>` from any device on the same Wi-Fi — or scan the QR printed in the terminal.

## Run it as a service (macOS)

For an always-on hub that survives crashes and reboots, run it natively (this is
the production mode — mDNS/`bifrost.local` works, unlike Docker on macOS). One
command builds and starts it:

```bash
sh scripts/start-pm2.sh        # via PM2 (rich logs/monitoring; installs pm2)
# — or —
sh scripts/start-launchd.sh    # via launchd (zero extra deps, native)
```

Pick one, not both. Details + how to choose: [`docs/pm2.md`](docs/pm2.md) ·
[`docs/launchd.md`](docs/launchd.md).

**Optional Grafana view of the logs** (Docker containers; works alongside the
native run — Alloy tails `storage/logs/`). In a second terminal:

```bash
sh scripts/observability.sh    # http://localhost:3000  (admin / bifrost)
```

See [`docs/observability.md`](docs/observability.md). Back up all state
(`storage/` + `themes/`) any time with `npm run backup`.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Creates storage folders, verifies `.env`, runs DB migrations |
| `npm run dev` | Dev mode with hot reload (server + client) |
| `npm run build` | Production build (client + server) |
| `npm start` | Run production build |
| `npm run logs` | Pretty-tail the JSON log file |
| `npm run backup` | Archive `storage/` + `themes/` to `BACKUP_DIR` (online-safe; `-- --include-env` to add `.env`) |
| `npm run restore -- <archive.zip>` | Restore an archive (refuses a live server unless `--force`) |
| `npm run test:resilience` | Restart-resilience suite (50 restarts + SIGKILL, integrity-checked; on-demand) |
| `npm test` / `npm run lint` / `npm run typecheck` | Quality gates (also run in CI) |

Convenience shell scripts (macOS service run): `scripts/start-pm2.sh`,
`scripts/start-launchd.sh`, `scripts/observability.sh`.

## Project docs

Architecture, rules, plans and progress live in [`.agent/`](.agent/). Start with [`.agent/plans/README.md`](.agent/plans/README.md).

Operating & deploying:

- [`docs/pm2.md`](docs/pm2.md) · [`docs/launchd.md`](docs/launchd.md) — run as a service on macOS
- [`docs/observability.md`](docs/observability.md) — optional Grafana + Loki + Alloy stack
- [`docs/docker-linux.md`](docs/docker-linux.md) — Docker image for a Linux host (not the macOS run mode)
- [`docs/releasing.md`](docs/releasing.md) — automated releases (develop → main)
- [`docs/cloud-profile.md`](docs/cloud-profile.md) — checklist for a future internet deployment
- [`docs/THEME-SPEC.md`](docs/THEME-SPEC.md) · [`docs/DESIGN.md`](docs/DESIGN.md) — themes & design system

## License

MIT
