# syntax=docker/dockerfile:1
#
# The standalone site (PLAN-35): the browser-only client as static files
# behind nginx, with no backend at all. Runs on the owner's cloud machine, not
# beside the hub; moved here unchanged from the root Dockerfile (PLAN-39).
#
#   docker build -f docker/standalone.Dockerfile -t bifrost-standalone .

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
# are .env.example's; override them in compose/standalone.yml's build.args.
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
# Serves on 8080; compose/standalone.yml puts it behind the reverse proxy
# already on the machine.
FROM nginxinc/nginx-unprivileged:1.28.0-alpine AS standalone
COPY docker/nginx-standalone.conf /etc/nginx/conf.d/default.conf
COPY --from=standalone-build /app/client/dist-standalone /usr/share/nginx/html
EXPOSE 8080
# busybox wget ships with alpine; nothing extra is installed for the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
