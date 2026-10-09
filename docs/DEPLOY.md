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
| `GAS_STATION_PK` | Optional. **Secret**, not the operator key. Funds brand-new passkey addresses: a new address has 0 MON and cannot send its first onboarding transaction. Without it, `POST /onboard/fund` answers 503 |
| `GAS_DRIP_MON` / `GAS_DAILY_CAP` | MON per new address (default 0.5) and fundings per UTC day (default 40). Each address is funded once; the list lives in `DATA_DIR/gas-station.json` |

Hosting options (all provide HTTPS; free tiers and limits unverified):
- **Railway / Render:** "deploy from Dockerfile", Dockerfile path `packages/agent-worker/Dockerfile`, root = repo root, add a volume on `/data`.
- **Fly.io:** `fly launch --dockerfile packages/agent-worker/Dockerfile`, then `fly volumes create data` and mount it on `/data`.
- **VPS:** `docker run` behind Caddy or nginx with TLS.
  - The team VPS is shared with other projects. One already uses port 8787, so the worker runs with `PORT=8788`, is published only on `127.0.0.1:8788`, and gets its own Caddy site block. The env file lives outside the repo copy, in `/root/omniagent-secrets/worker.env` (mode 600).

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

### PWA on the VPS (Docker)
`NEXT_PUBLIC_*` values are inlined at build time, so they are build args. Server-only `LLM_*` and `WORKER_OPERATOR_ADDRESS` go in at runtime.
```
docker build -f packages/nextjs/Dockerfile -t omniagent-pwa \
  --build-arg NEXT_PUBLIC_WORKER_URL=https://<worker host> --build-arg NEXT_PUBLIC_APP_URL=https://<pwa host> .
docker run -d --name omniagent-pwa --restart unless-stopped -p 127.0.0.1:3100:3000 --env-file <pwa.env> omniagent-pwa
```
- Copy the tree with LF line endings. With CRLF from a Windows checkout, `yarn install --immutable` can reject the lockfile.
- Add the PWA origin to the worker's `ALLOWED_ORIGINS`. The worker reads its env file only when the container is created, so recreate the container.
- Perpl's market-data WebSocket answers 403 to browser Origins other than its own (VERIFIED_FACTS, 2026-10-09). Relay it from the PWA's Caddy site and build with `--build-arg NEXT_PUBLIC_PERPL_WS_URL=wss://<pwa host>/perpl-ws/v1/market-data`:
  ```
  handle_path /perpl-ws/* {
  	rewrite * /ws{uri}
  	reverse_proxy https://testnet.perpl.xyz {
  		header_up Host testnet.perpl.xyz
  		header_up -Origin
  	}
  }
  handle {
  	reverse_proxy 127.0.0.1:3100
  }
  ```

## 3. Indexer (optional)

`ENVIO_API_TOKEN` plus Docker, `yarn indexer:dev`. Point `NEXT_PUBLIC_INDEXER_URL` (PWA) and `INDEXER_URL` (worker) at
its GraphQL endpoint. Without it, the dashboard shows raw position types, and closes rely on the worker's own log.
