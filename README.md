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
<img src="docs/assets/screenshot-home.png" alt="Bifrost home — Aurora theme, the two portals" width="720" />

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
- 📋 Muninn — clipboard/text sync across devices
- 🔳 Sigil — QR generator utility (+ scan-to-join QR for the server URL)
- 🎨 Dynamic themes (Aurora, Daybreak, Ghibli Dusk, Olympus built in), addable via JSON
- 🛡 Heimdall — hidden admin panel (secret gesture/shortcut + PIN)
- 📜 Wardens — device presence dashboard with character-name aliases; upload history & activity log in Heimdall
- 🔁 Restart-safe: all state survives server stop/start

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

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Creates storage folders, verifies `.env`, runs DB migrations |
| `npm run dev` | Dev mode with hot reload (server + client) |
| `npm run build` | Production build (client + server) |
| `npm start` | Run production build |
| `npm run logs` | Pretty-tail the JSON log file |
| `npm run backup` | Zip `storage/` to a backup location |
| `npm test` / `npm run lint` / `npm run typecheck` | Quality gates (also run in CI) |

## Project docs

Architecture, rules, plans and progress live in [`.agent/`](.agent/). Start with [`.agent/plans/README.md`](.agent/plans/README.md).

## License

MIT
