# The standalone site

Bifrost has two client builds (PLAN-35):

- **The hub** (`npm run build`, `client/dist/`): the whole app, served by the Bifrost server on your LAN.
- **The standalone site** (`npm run build:standalone`, `client/dist-standalone/`): only what works in a browser on its own, with no Bifrost server at all. It is meant for a public machine, so the tools you use daily are one URL away from anywhere.

## What it has, and what it doesn't

| Works in the standalone site | Needs the hub |
|---|---|
| Runestone, Edda, Groot, Atlas (edit, format, export, "Download instead" of saving) | Saving to the Pensieve, the Pensieve itself, shared document links |
| Variant, Loki (transforms, regex, the sandboxed runner in your own browser) | Brotli (compression runs on the server) |
| Saga (present a dropped `.md` or `.pdf`) | Send, Receive, Hermes, Accio, Nimbus, Portkey, Wardens |
| Every Diagon Alley toolbox tool | The Join Bifrost QR |
| Themes, and Heimdall with this browser's own settings | Heimdall's household settings, stats and history |

Anything that needs the hub explains itself instead of failing: a link or button to it shows **"The Bifröst is closed"**, with "Download instead" where there is a local copy to offer. The bundle cannot reach a server: every request path is compiled out of it, and `npm run build:standalone` fails if one survives (`scripts/check-standalone.ts`).

Heimdall opens by the same shortcut and taps as on the hub, with **no PIN**: there is no server to check one against, and a PIN checked in the browser would protect nothing. Its sections (theme, the shortcut and taps, Sky Relics, Loki's run policy, the screensaver, About) are stored in this browser's `localStorage` under `bifrost.local.*`, and say so.

## Run it locally

No Docker needed to try it or work on it:

```bash
npm run dev:standalone       # Vite dev server in standalone mode, hot reload: http://localhost:5173
npm run preview:standalone   # build dist-standalone/, then serve exactly that: http://localhost:4173
```

Neither starts a Bifrost server, and none is needed: the standalone build has no proxy and no request path to one, so anything hub-only shows "The Bifröst is closed", exactly as the deployed site does. Running `npm run dev` (the hub) at the same time is fine: since PLAN-36 the hub's dev server holds `PORT` (4646) and these keep Vite's own ports.

To serve it from this Mac to the LAN the way the hub is served, set `BIFROST_RUN=web` in `.env` and run `npm start` (or `sh scripts/start-pm2.sh` / `start-launchd.sh`): the web host serves `dist-standalone/` on `PORT` with the container's exact rules, forwards nothing, and answers for `bifrost.local`.

`preview:standalone` serves the real build output, so it is the one to check before deploying. It falls back to the app for any unknown path, a little more loosely than the container's nginx (which 404s a missing `/assets/` file); the e2e `standalone` project serves the build with the container's exact rules (`e2e/support/static-server.ts`). The baked defaults come from your root `.env`, as they do for every build.

## Run it in Docker

The site is a container: static files behind `nginx-unprivileged`, running as a non-root user on port 8080, read-only, with every capability dropped. Its nginx has no `proxy_pass` anywhere, so not even the web server can reach a backend.

It is built to sit behind the reverse proxy you already run, beside your other containers:

- **No published port.** It `expose`s 8080 and joins your proxy's Docker network.
- **Nothing that collides:** no fixed container name, no host port, no volume.

```bash
# The network your reverse proxy (Caddy, Traefik, nginx-proxy, …) is on:
docker network ls
BIFROST_DOCKER_NETWORK=proxy docker compose -f docker-compose.standalone.yml up -d --build
```

Then point the proxy at `bifrost-standalone:8080` for the public hostname, with TLS at the proxy. For example, with Caddy:

```caddyfile
tools.example.com {
    reverse_proxy bifrost-standalone:8080
}
```

No proxy on the machine? Uncomment the `ports:` line in `docker-compose.standalone.yml` instead.

### Settings are build arguments

Everything the site starts from is **baked in when the image is built**: the editor size caps, Loki's run policy, the screensaver's defaults, and Heimdall's shortcut and tap count. Vite writes them into the JavaScript, so a runtime `environment:` or `docker run -e` arrives too late and changes nothing.

Set them under `build.args` in `docker-compose.standalone.yml` (the defaults are `.env.example`'s), then rebuild:

```yaml
args:
  LOKI_EXECUTION_ENABLED: 'false'   # ship the site with the runner off
  HEIMDALL_TAP_COUNT: '9'
```

A visitor can still change their own Loki, screensaver and Heimdall settings in their own browser; the build arguments are where every browser starts.

`BIFROST_COMMIT` sets the commit Heimdall's About shows. The image has no `.git`, so without it About reads `unknown`.

## Update it

```bash
git pull
BIFROST_DOCKER_NETWORK=proxy docker compose -f docker-compose.standalone.yml up -d --build
```

Hashed assets are cached forever and the app shell never, so a browser picks up the new build on its next load.

## Check it

```bash
docker compose -f docker-compose.standalone.yml ps     # STATUS should read (healthy)
scripts/standalone-smoke.sh bifrost-standalone:latest  # what CI runs on every PR
```

The smoke script runs the image the way the compose file does, then checks the shell, a deep link, a hashed asset's cache headers, that `/api/health` answers with the app shell (proof that nothing behind it is a backend), and the healthcheck. Through your proxy, open a deep link such as `/runestone` and refresh it: the page should load, not a 404.

## Logs

The standalone site sends no logs anywhere: the client's log sink is a no-op in this build. A later plan adds a small log service as another container on the same network (PLAN-99).
