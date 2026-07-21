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
RUN npm ci
# Build, then drop dev deps so only production node_modules ship.
COPY . .
RUN npm run build \
  && npm prune --omit=dev

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
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/client/package.json ./client/package.json
# Runtime state (bind-mounted in compose), owned by the unprivileged node user.
RUN mkdir -p storage themes && chown -R node:node /app
USER node
EXPOSE 4646
# Node 20 ships global fetch — no curl/wget needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4646)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/bootstrap.js"]
