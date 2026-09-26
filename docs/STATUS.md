# Status

Last update: 2026-09-26. Network: Monad testnet (10143). "Verified" means it ran here. The build environment blocks Monad RPC, Perpl and LLM hosts, so nothing below has touched the real network yet.

## Phase 0: spikes

| Spike | Code | Verified here | Pending (your machine) |
|---|---|---|---|
| S1 Mera | `/spike/mera` | build, types | Real passkey on iOS 18+ or Android with GPM |
| S2 Perpl | `scripts/spikes/perpl-s2.mts` (read-only, `--write`, `--test-order`) | types; fails only on the network (403) | Testnet collateral + MON; `--test-order` validates the `OrderDesc` encoding |
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
- **Execution is dry-run until S2 `--test-order` passes.** Only then set `EXECUTION_ENABLED=true`.
- **Close orders** exist (worker `POST /close`, dashboard button, owner-signed `ClosePosition`). The side comes from the worker's own log of orders it sent (verified enum), or from the indexer calibration. Unknown → rejected, never guessed. Close/IOC semantics are unverified on testnet.
- `/operator/consent` requires an owner-signed `ConsentRequest`. POST routes are rate-limited per IP (in memory, per process). One execution runs at a time per account.
- Deployment: the worker Dockerfile is verified (build, run, healthy, non-root). Vercel for the PWA is unverified. See `docs/DEPLOY.md` and `docs/DEMO.md`.
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
