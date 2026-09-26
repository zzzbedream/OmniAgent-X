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
- No close orders. `PositionEnum` values are unverified, so the long/short side of an open position cannot be read reliably.
- The `/operator/consent` endpoint has no auth; anyone can request consent for any owner. Harmless on testnet (the owner still has to call the factory), but not acceptable for mainnet.
- The daily LLM cap is per process and in memory.
- The dashboard (Phase 3) and vault + CRE (Phase 2) have not started.
