# Deploy (testnet MVP)

Three processes: the **PWA** (Next.js, HTTPS), the **worker** (operator EOA, HTTPS), and optionally the
**indexer** (Envio). The browser calls the worker directly, so the worker must be served over HTTPS too.
Otherwise the browser blocks the calls as mixed content.

## 1. Worker (Docker)

Verified in the build environment: the image builds, starts, reports `healthy`, runs as user `node`,
and serves `/health`. Registry pushes and hosting were not tested.

```
docker build -f packages/agent-worker/Dockerfile -t omniagent-worker .   # build context = repo root
docker run -d -p 8787:8787 -v omniagent-data:/data --env-file packages/agent-worker/.env omniagent-worker
```

| Variable | Value |
|---|---|
| `OPERATOR_PK` | **Secret.** A fresh testnet key used only for this. It can trade but cannot withdraw |
| `ALLOWED_ORIGINS` | The PWA's HTTPS origin, e.g. `https://omniagent.vercel.app` |
| `EXECUTION_ENABLED` | `false` until S2 `--test-order` passes, then `true` |
| `TRUST_PROXY` | `true` behind the host's HTTPS proxy (Railway/Fly), so rate limiting sees real client IPs |
| `MONAD_TESTNET_RPC` | Your own RPC (e.g. the QuickNode voucher) is preferable to the public one |
| `DATA_DIR` | `/data` (the image default). **Mount a persistent volume**: the log also holds used approval nonces |

Hosting options (all provide HTTPS; free tiers and limits unverified):
- **Railway / Render:** "deploy from Dockerfile", Dockerfile path `packages/agent-worker/Dockerfile`, root = repo root, add a volume on `/data`.
- **Fly.io:** `fly launch --dockerfile packages/agent-worker/Dockerfile`, then `fly volumes create data` and mount it on `/data`.
- **VPS:** `docker run` behind Caddy or nginx with TLS.

Without Docker: `yarn workspace @omniagent/worker build && node packages/agent-worker/dist/main.mjs`
(single bundled file, 840 KB).

## 2. PWA (Vercel)

**Not verified here.** Vercel with Yarn 3 workspaces and `transpilePackages` should work, but check it on the first deploy.
- Root directory: `packages/nextjs`. Install command at the repo root: `cd ../.. && yarn install`.
  - If the immutable install fails, set `YARN_ENABLE_IMMUTABLE_INSTALLS=false`, as the scaffold's `vercel` script does.
- Env vars:
  - `NEXT_PUBLIC_WORKER_URL` (the worker's HTTPS URL).
  - `KIMI_BASE_URL/KIMI_API_KEY/KIMI_MODEL` and `QWEN_*` (server-only).
  - `LLM_MAX_PLANS_PER_DAY`.
  - Optional: `NEXT_PUBLIC_MONAD_TESTNET_RPC`, `NEXT_PUBLIC_INDEXER_URL`.
- **Passkeys are bound to the domain (`rpId` = hostname).** Changing domains (preview URL → production URL)
  creates different passkeys, and therefore different addresses. Pick the final domain before onboarding real test users.
- Plan B if Vercel fails: build and run `packages/nextjs` with `next build && next start` behind any HTTPS host.

## 3. Indexer (optional)

`ENVIO_API_TOKEN` plus Docker, `yarn indexer:dev`. Point `NEXT_PUBLIC_INDEXER_URL` (PWA) and `INDEXER_URL` (worker) at
its GraphQL endpoint. Without it, the dashboard shows raw position types, and closes rely on the worker's own log.
