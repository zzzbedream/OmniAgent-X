# OmniAgent X PWA (next build + next start). Build context: the REPOSITORY ROOT.
#   docker build -f packages/nextjs/Dockerfile -t omniagent-pwa \
#     --build-arg NEXT_PUBLIC_WORKER_URL=https://worker.example --build-arg NEXT_PUBLIC_APP_URL=https://app.example .
# NEXT_PUBLIC_* values are inlined at build time, so they are build args. Server-only secrets (LLM_*) go in at runtime
# via --env-file (see packages/nextjs/.env.example). Passkeys bind to the serving hostname: keep it stable.

FROM node:24-slim
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
COPY packages/nextjs packages/nextjs

ARG NEXT_PUBLIC_WORKER_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_MONAD_TESTNET_RPC=""
ARG NEXT_PUBLIC_INDEXER_URL=""
ARG NEXT_PUBLIC_GUARDIAN_AGENT_ID=""
# Perpl's market-data WS rejects foreign browser Origins; point this at a server-side relay (docs/DEPLOY.md).
ARG NEXT_PUBLIC_PERPL_WS_URL=""
ENV NEXT_PUBLIC_WORKER_URL=$NEXT_PUBLIC_WORKER_URL \
    NEXT_PUBLIC_PERPL_WS_URL=$NEXT_PUBLIC_PERPL_WS_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_MONAD_TESTNET_RPC=$NEXT_PUBLIC_MONAD_TESTNET_RPC \
    NEXT_PUBLIC_INDEXER_URL=$NEXT_PUBLIC_INDEXER_URL \
    NEXT_PUBLIC_GUARDIAN_AGENT_ID=$NEXT_PUBLIC_GUARDIAN_AGENT_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN yarn workspace @se-2/nextjs build && chown -R node:node packages/nextjs/.next

ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /repo/packages/nextjs
# next directly (not `yarn serve`): Yarn may try to write install state, and the runtime user is read-only on /repo.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
