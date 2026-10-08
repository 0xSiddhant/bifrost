# syntax=docker/dockerfile:1
#
# The web host (PLAN-36's `web/`) on its own (PLAN-39): the hub client and the
# standalone client, the proxy to the API, and the mDNS responder. No native
# dependency anywhere, so no compiler in any stage.
#
#   docker build -f docker/web.Dockerfile -t bifrost-web .
#
# compose/web.yml runs it (host networking on Linux); compose/web.bridge.yml
# adapts it for Docker Desktop on the Mac, beside a native API.

# ---- clients: the hub and the standalone build ----
FROM node:20-bookworm-slim AS clients
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY cli/package.json ./cli/
COPY web/package.json ./web/
COPY e2e/package.json ./e2e/
COPY tools/micromatch-shim ./tools/micromatch-shim/
RUN npm ci --workspace client --include-workspace-root --ignore-scripts
COPY client ./client
COPY scripts ./scripts
COPY tsconfig.base.json ./
# Vite inlines these: a runtime ENV arrives too late. compose/web.yml passes
# the caps from the same .env the API enforces at runtime, so the two images
# cannot drift; the rest are .env.example's defaults, as for the standalone
# image (docker/standalone.Dockerfile).
ARG RUNESTONE_MAX_DOC_KB=2048
ARG EDDA_MAX_DOC_KB=2048
ARG EDDA_LIVE_PREVIEW_MAX_KB=300
ARG GROOT_MAX_DOC_KB=2048
ARG ATLAS_MAX_DOC_KB=2048
ARG LOKI_EXECUTION_ENABLED=true
ARG LOKI_FETCH_ALLOWED=true
ARG LOKI_RUN_TIMEOUT_MS=5000
ARG LOKI_CONSOLE_MAX_ENTRIES=500
ARG SCREENSAVER_ENABLED=true
ARG SCREENSAVER_IDLE_SECONDS=60
ARG SCREENSAVER_PARTICLE_DENSITY=medium
ARG SCREENSAVER_MOTION=normal
ARG SCREENSAVER_CONNECT_LINES=true
ARG SCREENSAVER_MOUSE_REACTIVE=true
ARG SCREENSAVER_SHOW_QUOTES=true
ARG SCREENSAVER_QUOTE_ROTATE_SECONDS=14
ARG HEIMDALL_SHORTCUT_DEFAULT=shift+meta+comma
ARG HEIMDALL_TAP_COUNT=7
ARG BIFROST_COMMIT=unknown
# The hub client (served in BIFROST_RUN=full) and the standalone one (served in
# BIFROST_RUN=web); the standalone build's postbuild check fails it if the
# bundle can reach a server.
RUN npm run build -w client && npm run build:standalone -w client

# ---- web: compile the web host ----
FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY cli/package.json ./cli/
COPY web/package.json ./web/
COPY e2e/package.json ./e2e/
COPY tools/micromatch-shim ./tools/micromatch-shim/
RUN npm ci --workspace web --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY web ./web
RUN npm run build -w web \
  # Only what the web host runs: its own production dependencies.
  && npm ci --workspace web --omit=dev --ignore-scripts

# ---- runtime: slim, non-root, init ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# No tini and no apt at all: the web host spawns no child process, so there is
# nothing to reap, and it handles SIGTERM itself (web/src/main.ts). Compose's
# `init: true` adds Docker's own init anyway.
WORKDIR /app
# web/src/config.ts finds the repo root two levels above web/dist, and the
# clients under it, so /app mirrors the repo layout.
COPY --chown=node:node --from=web /app/node_modules ./node_modules
COPY --chown=node:node --from=web /app/web/dist ./web/dist
COPY --chown=node:node --from=web /app/web/package.json ./web/package.json
COPY --chown=node:node --from=web /app/package.json ./package.json
COPY --chown=node:node --from=clients /app/client/dist ./client/dist
COPY --chown=node:node --from=clients /app/client/dist-standalone ./client/dist-standalone
# Its own log series goes to storage/logs (bind-mounted in compose).
# The copies above are already the node user's (--chown); a `chown -R /app`
# here would copy every byte into a new layer (PLAN-39 measured +124 MB).
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 4646
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4646)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web/dist/bootstrap.js"]
