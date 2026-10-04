# syntax=docker/dockerfile:1.7

# ---- dependencies (all, for building) ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries; --ignore-scripts stops npm from compiling it with node-gyp anyway.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund

# ---- compile TypeScript, copy migrations and fonts ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY scripts/copy-assets.mjs ./scripts/
COPY src ./src
COPY public ./public
RUN npm run build && mkdir -p /app/empty-data

# ---- production dependencies only ----
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf node_modules/.cache \
 # Keep only this platform's SQLite binary; drop the other prebuilds and the bundled C sources (about 24 MB).
 && keep="$(node -p 'process.platform + "-" + process.arch').node" \
 && find node_modules/better-sqlite3/prebuilds -type f ! -name "$keep" -delete \
 && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src

# ---- runtime: no shell, no package manager, non-root (uid 65532) ----
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3105 \
    DATABASE_PATH=/data/signalpost.db \
    BACKUP_DIR=/backups
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./
# A named volume mounted here starts with this directory's ownership, so the non-root user can write it.
COPY --from=build --chown=65532:65532 /app/empty-data /data
USER nonroot
EXPOSE 3105
HEALTHCHECK --interval=15s --timeout=4s --start-period=15s --retries=3 \
  CMD ["/nodejs/bin/node", "dist/cli.js", "healthcheck"]
CMD ["dist/index.js"]
