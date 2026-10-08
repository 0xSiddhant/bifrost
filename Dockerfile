# syntax=docker/dockerfile:1
#
# Bifrost image — targets a LINUX host (Raspberry Pi / home server), where
# `--network host` lets mDNS multicast and Finder-less LAN access work. On
# macOS the native PM2/launchd path is the run mode; see docs/docker-linux.md.

# ---- builder: install all deps, build client + server ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# Toolchain only needed if better-sqlite3 has no prebuilt binary for the arch
# (discarded with this stage).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Manifests first for layer caching.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY cli/package.json ./cli/
COPY web/package.json ./web/
# The root devDependency that replaces micromatch (tools/micromatch-shim/README.md).
COPY tools/micromatch-shim ./tools/micromatch-shim/
RUN npm ci
# Build, then drop dev deps so only production node_modules ship.
COPY . .
# The editor caps are baked into the client at build time from the same keys
# the server enforces (PLAN-35). An image builds without the runtime .env, so
# pass the server's values as build args, or the defaults below are baked in;
# the server's boot log names any key that drifted.
ARG RUNESTONE_MAX_DOC_KB=2048
ARG EDDA_MAX_DOC_KB=2048
ARG EDDA_LIVE_PREVIEW_MAX_KB=300
ARG GROOT_MAX_DOC_KB=2048
ARG ATLAS_MAX_DOC_KB=2048
# CI=true so the build's cli-sync step builds cli/ without also trying to
# `npm install -g` the CLI into a throwaway image layer (PLAN-27).
RUN CI=true npm run build \
  && npm prune --omit=dev

# ---- standalone-build: the client alone, for the standalone site (PLAN-35) ----
# Only the client workspace (and the root's build tools) is installed, so this
# stage needs none of the server's native toolchain: no better-sqlite3, no
# python3/make/g++.
FROM node:20-bookworm-slim AS standalone-build
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
# Everything the standalone site starts from is baked in at build time: Vite
# inlines these, so a runtime ENV or `docker run -e` arrives too late. Defaults
# are .env.example's; override them in docker-compose.standalone.yml's
# build.args.
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
# The commit Heimdall's About shows (there is no .git in the build context).
ARG BIFROST_COMMIT=unknown
# The build's postbuild step fails it if the bundle can reach a server.
RUN npm run build:standalone

# ---- standalone: static files behind nginx, non-root, no backend ----
# Built with `docker build --target standalone`; the hub image below stays the
# default target. Serves on 8080; docker-compose.standalone.yml puts it behind
# the reverse proxy already on the machine.
FROM nginxinc/nginx-unprivileged:1.28.0-alpine AS standalone
COPY docker/nginx-standalone.conf /etc/nginx/conf.d/default.conf
COPY --from=standalone-build /app/client/dist-standalone /usr/share/nginx/html
EXPOSE 8080
# busybox wget ships with alpine; nothing extra is installed for the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

# ---- runtime: slim, non-root, init ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# tini = PID 1 signal forwarding + zombie reaping; zip/unzip for the in-app
# backup path (PLAN-10 runs createBackup() in-process).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini zip unzip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Built output + pruned prod deps + migrations + manifests. paths.ts derives the
# repo root from server/dist/core/, so /app must mirror the repo layout.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/drizzle ./server/drizzle
COPY --from=builder /app/client/dist ./client/dist
# PLAN-36: the web host, and the standalone client it serves in web mode.
COPY --from=builder /app/client/dist-standalone ./client/dist-standalone
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/client/package.json ./client/package.json
COPY --from=builder /app/web/package.json ./web/package.json
# Runtime state (bind-mounted in compose), owned by the unprivileged node user.
RUN mkdir -p storage && chown -R node:node /app
USER node
# PLAN-36: one image, two processes. The API is this image's default command,
# on loopback API_PORT; docker-compose.yml runs the web host from the same
# image as a second service. Only PORT (the web host's) is a public port.
EXPOSE 4646
# Node 20 ships global fetch — no curl/wget needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.API_PORT||Number(process.env.PORT||4646)+1;fetch('http://127.0.0.1:'+p+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# --import loads the OTel SDK before the app; see ecosystem.config.cjs.
CMD ["node", "--import", "./server/dist/otel.js", "server/dist/bootstrap.js"]
