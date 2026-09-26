# OmniAgent X

Passkey-native (Mera) trading assistant on Monad. A user describes a risk profile in plain language, LLMs (Qwen, Kimi) propose a plan, deterministic risk checks decide, and orders execute on Perpl. Funds stay withdrawable only by the user.

Status: **Phases 1 and 3 code complete, not yet validated on-chain.** See [`docs/STATUS.md`](docs/STATUS.md) for what is verified. See [`docs/PLAN.md`](docs/PLAN.md) for the full plan and [`docs/VERIFIED_FACTS.md`](docs/VERIFIED_FACTS.md) for what has been checked against primary sources (and what has not).

Built on [scaffold-monad-foundry](https://github.com/monad-developers/scaffold-monad-foundry) (Scaffold-ETH 2, Foundry edition).

## Requirements
- Node 24 (`.nvmrc`; `@category-labs/mera` declares `node >= 24`), Yarn (bundled 3.2.3)
- Foundry (`forge`); `git submodule update --init --recursive`
- Bun ≥ 1.2.21 and the [CRE CLI](https://github.com/smartcontractkit/cre-cli) for `cre/`

## Layout
```
packages/core       Shared logic: Perpl ABIs/orders/allowlist, plan schema, RiskPolicy, EIP-712 approval, LLM pipeline
packages/agent-worker  Operator EOA service (dry-run by default): consent, plan validation, execOrder
packages/nextjs     PWA (Next.js): /onboard, /intent, /dashboard, /api/strategy, /api/perpl/context, Mera in lib/mera/, spike page /spike/mera
packages/indexer    Envio HyperIndex: Perpl activity of factory-created accounts + position side calibration
packages/foundry    Contracts. CRE receiver spike in contracts/spikes/, tests in test/
cre/spike-workflow  Chainlink CRE workflow (TypeScript → WASM)
docs/               Plan and verified facts
```

## Phase 0 spikes

| Spike | What it proves | How to run |
|---|---|---|
| S1 Mera | Passkey → same EVM address across sessions → signed tx on Monad testnet | `yarn start`, open `/spike/mera` **over HTTPS on a PRF-capable device** (iOS 18+ Safari, Android Chrome + Google Password Manager). WebAuthn needs a secure context, so use a tunnel or deploy a preview |
| S2 Perpl | Documented testnet contracts exist; create a DelegatedAccount with an EOA operator and deposit | `cd packages/nextjs && node --experimental-strip-types scripts/spikes/perpl-s2.mts` (read-only), add `--write` with `OWNER_PK`, `OPERATOR_PK` and `DEPOSIT` (also repairs the operator allowlist), then `--test-order` with `OPERATOR_PK` and `DELEGATED_ACCOUNT` |
| S3 CRE | A CRE report reaches `OmniReceiverSpike.onReport` on Monad testnet | Deploy `OmniReceiverSpike(forwarder, workflowId)`, put its address in `cre/spike-workflow/config.staging.json`, then `cd cre/spike-workflow && bun install && cre workflow simulate` (see the CRE CLI docs for flags) |
| S4 LLMs | Qwen and Kimi return schema-valid JSON; measure latency and tokens | `cd packages/nextjs && QWEN_BASE_URL=… QWEN_API_KEY=… QWEN_MODEL=… KIMI_… node --experimental-strip-types scripts/spikes/llm-s4.mts 3` |

Checks that run offline:
```
yarn test                  # core + worker + indexer + foundry tests
yarn foundry:test          # OmniReceiverSpike unit tests
yarn next:check-types      # frontend types
cd cre/spike-workflow && bun install && bun x cre-compile main.ts dist/workflow.wasm
```

## Honest caveats
- Testnet only. Sources disagree on the testnet collateral token (see VERIFIED_FACTS), so the code reads it on-chain.
- The worker runs in dry-run until S2 `--test-order` proves the `execOrder` encoding on testnet.
- The Perpl operator must be an EOA. Phase 1 uses an operator hot key in a worker. Phase 2 moves execution to our own vault contract driven by CRE.
- CRE on monad-testnet (Forwarder address, DON deploy access) is unverified until S3 passes.
