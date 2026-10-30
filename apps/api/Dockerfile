# syntax=docker/dockerfile:1.7
# Build context: repository root (the API depends on the shared contracts workspace).
#   docker build -f apps/api/Dockerfile -t task-api .

ARG NODE_IMAGE=node:22.12.0-alpine3.20

# ---- build: install all workspace deps for the API and bundle it ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @taskmanager/api --include-workspace-root=false --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN npm run build --workspace @taskmanager/api

# ---- prod-deps: runtime dependencies only (contracts are bundled into dist) ----
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @taskmanager/api --include-workspace-root=false --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
# tini reaps zombies and forwards SIGTERM so the graceful-shutdown handler runs.
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --chown=node:node apps/api/package.json ./package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
