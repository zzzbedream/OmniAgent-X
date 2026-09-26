# OmniAgent X agent worker. Build context: the REPOSITORY ROOT.
#   docker build -f packages/agent-worker/Dockerfile -t omniagent-worker .
# Runtime secrets/config via env (see packages/agent-worker/.env.example). Mount a volume on /data for the
# decision log (it also stores used approval nonces; losing it re-opens replay of unexpired approvals).

FROM node:24-slim AS build
WORKDIR /repo
# Yarn 3 needs every workspace manifest to satisfy the lockfile; sources are copied only where needed.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY packages/core/package.json packages/core/
COPY packages/agent-worker/package.json packages/agent-worker/
COPY packages/nextjs/package.json packages/nextjs/
COPY packages/foundry/package.json packages/foundry/
COPY packages/indexer/package.json packages/indexer/
# skip-build: no postinstall scripts (husky needs .git; foundry copies .env files) — none are needed here.
RUN yarn install --immutable --mode=skip-build
COPY packages/core packages/core
COPY packages/agent-worker packages/agent-worker
RUN yarn workspace @omniagent/worker build

FROM node:24-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
WORKDIR /app
COPY --from=build /repo/packages/agent-worker/dist/main.mjs ./main.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "main.mjs"]
