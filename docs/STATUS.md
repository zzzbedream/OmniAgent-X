# Status

Last update: 2026-10-08. Network: Monad testnet (10143). "Verified" means it ran here. Until 2026-09-26 the build environment blocked Monad RPC, Perpl and LLM hosts; read-only checks from a real machine since then are in `VERIFIED_FACTS.md`. S2 sent the first transactions on 2026-10-08.

## Phase 0: spikes

| Spike | Code | Verified here | Pending (your machine) |
|---|---|---|---|
| S1 Mera | `/spike/mera` | build, types. **2026-10-08: real passkey on the user's phone** at the VPS PWA. Full `/onboard` on testnet: DelegatedAccount `0x98A4…8713` (accountId 1004), worker as operator, allowlist synced (7 granted, 5 stale revoked), deposit 100 AUSD and owner withdraw. All checked on-chain | Device model not recorded |
| S2 Perpl | `scripts/spikes/perpl-s2.mts` (read-only, `--write`, `--test-order`) | **Passed 2026-10-08** on testnet: account created, operator allowlist synced, operator `execOrder` accepted (orderId 145). See VERIFIED_FACTS | Fills, closes and IOC on testnet |
| S3 CRE | `OmniReceiverSpike` + `cre/spike-workflow` | 6 forge tests; WASM compiles | CRE Forwarder on monad-testnet, `cre workflow simulate` |
| S4 LLM | `scripts/spikes/llm-s4.mts` | types | Kimi/Qwen API keys (paid, no credits) |

## Phase 1: core product (code complete, not yet on-chain)

| Piece | Where | Verified here |
|---|---|---|
| Order builder, Perpl ABIs, allowlist repair | `packages/core/src/perpl` | 21 tests; ABI selectors = `solc --hashes` |
| Plan schema, `RiskPolicy`, EIP-712 approval, Kimi→Qwen pipeline | `packages/core/src/strategy` | tests with a mocked LLM |
| Worker (operator EOA, **dry-run by default**) | `packages/agent-worker` | 10 tests; HTTP smoke test |
| PWA: `/onboard` (passkey, account, allowlist repair, deposit, withdraw) and `/intent` | `packages/nextjs/app` | `next build` + lint + types; pages render |
| `/api/strategy` (Kimi→Qwen, daily cap) | `packages/nextjs/app/api/strategy` | returns 503 with the list of missing env vars |

### Run locally
```
yarn install && git submodule update --init --recursive
cp packages/agent-worker/.env.example packages/agent-worker/.env   # set OPERATOR_PK (fresh testnet key)
cp packages/nextjs/.env.example packages/nextjs/.env.local          # set KIMI_* / QWEN_* when you have keys
set -a; . packages/agent-worker/.env; set +a; yarn worker           # worker on :8787, dry-run
yarn start                                                           # PWA on :3000 (passkeys need HTTPS off-localhost)
```

### Known gaps (not done, on purpose or blocked)
- **Order cap fix (2026-10-08):** `maxNegPnlCollatBPS` was 0, so every crossing order would have reverted. The builder now sets a cap (see VERIFIED_FACTS), and the dry-run simulates each order on-chain.
- **Automated live E2E (2026-10-09): 11/11.** A new user in headless Chromium with a virtual passkey (`packages/nextjs/scripts/qa/live-e2e.mjs`) completed onboarding, a live open, the position view, a close and a withdraw.
  - An earlier run stopped on a test bug after the open. It left an orphan 0.002 ETH short on account `0x5E09…E330`; its virtual passkey is gone, so nobody can close it. The script now always runs close and withdraw.
- **Execution is live since 2026-10-09** (`EXECUTION_ENABLED=true` on the VPS worker). The full open → read → close cycle was verified on testnet (VERIFIED_FACTS). Collateral top-ups are on since 2026-10-10 (`GUARDIAN_ADD_COLLATERAL=true`, after spike S2-bis verified `increasePositionCollateral`). Mandates signed in dry-run do not run live until re-activated.
- **Close orders** exist (worker `POST /close`, dashboard button, owner-signed `ClosePosition`). The side comes from the worker's own log of orders it sent (verified enum), or from the indexer calibration. Unknown → rejected, never guessed. Close/IOC semantics are unverified on testnet.
- `/operator/consent` requires an owner-signed `ConsentRequest`. POST routes are rate-limited per IP (in memory, per process). One execution runs at a time per account.
- Deployment: the worker Dockerfile is verified (build, run, healthy, non-root). Vercel for the PWA is unverified. See `docs/DEPLOY.md`.
  - 2026-10-08: worker `093d169` runs on the team VPS (Docker, `127.0.0.1:8788` behind Caddy) at `https://omniagent.147-93-178-184.sslip.io`, **dry-run**. Verified: `/health` over HTTPS and CORS preflight for `http://localhost:3000`.
  - 2026-10-08: the PWA runs on the same VPS (`packages/nextjs/Dockerfile`, `127.0.0.1:3100`) at `https://omniagent-app.147-93-178-184.sslip.io`. That hostname is the passkey `rpId`, so keep it. Verified over HTTPS: `/`, `/onboard`, `/intent`, `/dashboard`, `/guardian` and the agent card return 200. `/api/strategy` has the LLM configured and rejects unsigned requests with 401. Passkeys on a real device are still pending.
  - 2026-10-09: the redesigned front is live (dark "instrument" design system).
    - The landing page replaces the Scaffold-ETH home.
    - `/intent` shows the decision pipeline, the order ticket, the rules checklist and a readable agent result.
    - The dashboard takes a position's side from the worker's decision log when there is no indexer.
    - Checked live in headless Chromium at 375px: the landing reads marks on-chain, and `/intent` reaches the worker (CORS).
    - Perpl's WS needed a server-side relay (VERIFIED_FACTS).
  - 2026-10-09: a second tester's brand-new passkey address had 0 MON and could not create its trading account.
    - Every onboarding transaction must come from the owner (Perpl's factory and DelegatedAccount), so no relayer can pay for it.
    - Fix: the worker's gas station (`POST /onboard/fund`, owner-signed `FundRequest`) sends 0.5 MON and asks Agora's faucet for AUSD on the owner's behalf. Limits: once per address, a daily cap, and the per-IP rate limit.
    - `/onboard` calls it automatically when it sees an empty balance.
    - Actions that move funds now ask for the fingerprint or Face ID again (Mera PRF with user verification), and the passkey must derive the same address.
    - **Verified 2026-10-09 with an external tester on an iPhone.** The new passkey address `0x1411…e468` was funded automatically (0.5 MON + 10,000 AUSD, 19:50 UTC), then completed onboarding on its own: DelegatedAccount `0x9C48…9bcF`, accountId 1035, allowlist synced, 100 AUSD deposited. That took 12 transactions and about 0.185 MON.
- The daily LLM cap is per process and in memory.
- The vault + CRE (Phase 2) has not started.

## Phase 3: risk dashboard (code complete, not yet on live data)

| Piece | Where | Verified here |
|---|---|---|
| Market-data WebSocket protocol, context summary | `packages/core/src/perpl/marketData.ts` | tests on the documented message shapes |
| On-chain positions (`getPosition`, selector `0x751de421` = solc) | `packages/core/src/perpl/positions.ts` | ABI selector test |
| Risk metrics (PnL, effective leverage, margin buffer, est. liquidation price) | `packages/core/src/risk/metrics.ts` | liquidation price checked against its defining equation |
| Envio indexer: factory accounts, deposits, orders, fills, position lifecycle, side calibration | `packages/indexer` | `envio codegen` + 4 tests on simulated events; a mutation test showed the tests catch a side-mapping bug |
| `/dashboard` (markets live, account, positions, agent log, indexed history) | `packages/nextjs/app/dashboard` | build; rendered in Chromium with offline degradation and with a mocked Perpl WS (values checked by hand) |

### Phase 3 caveats
- **Position side.** The on-chain `PositionEnum` is undocumented. The indexer learns it from `OrderRequest` (verified order enum) plus the position event in the same transaction. Without the indexer, the dashboard shows the raw value and no PnL.
- **Estimates only.** PnL, margin buffer and liquidation price ignore funding and fees, and Perpl's margin formula is not public. The maintenance fraction is `100 / maintenance_margin`, inferred from the two examples in Perpl's docs.
- **Entry price after an increase.** The event does not carry the exchange's average entry price, so the indexer keeps the first entry. On-chain `getPosition` is the source the dashboard uses.
- **What `getPosition` returns for a market with no position** (empty struct vs revert) is undocumented; both cases are handled.
- **Envio needs `ENVIO_API_TOKEN` for HyperSync** (free-tier limits unverified), plus Docker for the local Postgres/Hasura. `monad-testnet` is in the envio 3.12.1 HyperSync chain table. `start_block: 0` is correct but slow.
- **The Hasura GraphQL query shape** in `lib/omni/indexer.ts` follows Envio's convention and is not verified against a running indexer.
- **Pre-existing scaffold warning:** WalletConnect logs `indexedDB is not defined` during static prerender. The build still succeeds.

### Run the indexer
```
cp packages/indexer/.env.example packages/indexer/.env   # ENVIO_API_TOKEN
yarn indexer:dev                                         # needs Docker; GraphQL at the URL envio prints
# then NEXT_PUBLIC_INDEXER_URL=<that GraphQL URL> in packages/nextjs/.env.local
```
