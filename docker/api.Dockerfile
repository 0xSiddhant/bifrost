# syntax=docker/dockerfile:1
#
# The API server (PLAN-36's `server/`), on its own (PLAN-39). A LINUX target:
# on the Mac the API runs natively under PM2/launchd, because Finder drops into
# storage/downloads need native file watching (docs/docker-mac.md).
#
#   docker build -f docker/api.Dockerfile -t bifrost-api .
#
# compose/api.yml runs it. Only the server workspace is installed: no client,
# no web host, no CLI.

# ---- build: the server only ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Toolchain only needed if better-sqlite3 has no prebuilt binary for the arch
# (discarded with this stage).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Every workspace manifest, because the lockfile names them all; only the
# server's dependencies (and the root's build tools) are installed.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY cli/package.json ./cli/
COPY web/package.json ./web/
COPY e2e/package.json ./e2e/
# The root devDependency that replaces micromatch (tools/micromatch-shim/README.md).
COPY tools/micromatch-shim ./tools/micromatch-shim/
RUN npm ci --workspace server --include-workspace-root
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY server ./server
# The server's prebuild writes server/build-info.json (version, commit, build
# time) for Heimdall's About; there is no .git here, so the commit is a build arg.
ARG BIFROST_COMMIT=unknown
RUN BIFROST_COMMIT=$BIFROST_COMMIT npm run build -w server \
  && npm prune --omit=dev --workspace server --include-workspace-root

# ---- runtime: slim, non-root, init ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# tini = PID 1 signal forwarding + zombie reaping; zip/unzip for the in-app
# backup path (PLAN-10 runs createBackup() in-process).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini zip unzip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# paths.ts derives the repo root from server/dist/core/, so /app mirrors the
# repo layout. No client build: the API serves none (PLAN-36), and its boot
# check of the client's baked caps is silent without one (compose keeps the
# caps in one place instead, compose/web.yml).
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/server/dist ./server/dist
COPY --chown=node:node --from=build /app/server/drizzle ./server/drizzle
COPY --chown=node:node --from=build /app/server/build-info.json ./server/build-info.json
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/server/package.json ./server/package.json
# Runtime state (bind-mounted in compose), owned by the unprivileged node user.
# The copies above are already the node user's (--chown); a `chown -R /app`
# here would copy every byte into a new layer (PLAN-39 measured +124 MB).
RUN mkdir -p storage && chown node:node storage
USER node
# Loopback only (API_HOST): nothing here is meant for the LAN.
EXPOSE 4647
# Node 20 ships global fetch — no curl/wget needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.API_PORT||Number(process.env.PORT||4646)+1;fetch('http://127.0.0.1:'+p+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# --import loads the OTel SDK before the app; see ecosystem.config.cjs.
CMD ["node", "--import", "./server/dist/otel.js", "server/dist/bootstrap.js"]
