# OmniAgent X

Passkey-native (Mera) trading assistant on Monad. A user describes a risk profile in plain language, LLMs (Qwen, Kimi) propose a plan, deterministic risk checks decide, and orders execute on Perpl. Funds stay withdrawable only by the user.

Status: **Phase 0: validation spikes.** See [`docs/PLAN.md`](docs/PLAN.md) for the full plan and [`docs/VERIFIED_FACTS.md`](docs/VERIFIED_FACTS.md) for what has been checked against primary sources (and what has not).

Built on [scaffold-monad-foundry](https://github.com/monad-developers/scaffold-monad-foundry) (Scaffold-ETH 2, Foundry edition).

## Requirements
- Node 24 (`.nvmrc`; `@category-labs/mera` declares `node >= 24`), Yarn (bundled 3.2.3)
- Foundry (`forge`); `git submodule update --init --recursive`
- Bun ≥ 1.2.21 and the [CRE CLI](https://github.com/smartcontractkit/cre-cli) for `cre/`

## Layout
```
packages/nextjs     PWA (Next.js). Mera passkey accounts in lib/mera/, spike page at /spike/mera
packages/foundry    Contracts. CRE receiver spike in contracts/spikes/, tests in test/
cre/spike-workflow  Chainlink CRE workflow (TypeScript → WASM)
docs/               Plan and verified facts
```

## Phase 0 spikes

| Spike | What it proves | How to run |
|---|---|---|
| S1 Mera | Passkey → same EVM address across sessions → signed tx on Monad testnet | `yarn start`, open `/spike/mera` **over HTTPS on a PRF-capable device** (iOS 18+ Safari, Android Chrome + Google Password Manager). WebAuthn needs a secure context, so use a tunnel or deploy a preview |
| S2 Perpl | Documented testnet contracts exist; create a DelegatedAccount with an EOA operator and deposit | `cd packages/nextjs && node --experimental-strip-types scripts/spikes/perpl-s2.mts` (read-only), add `--write` with `OWNER_PK`, `OPERATOR_PK` and `DEPOSIT` |
| S3 CRE | A CRE report reaches `OmniReceiverSpike.onReport` on Monad testnet | Deploy `OmniReceiverSpike(forwarder, workflowId)`, put its address in `cre/spike-workflow/config.staging.json`, then `cd cre/spike-workflow && bun install && cre workflow simulate` (see the CRE CLI docs for flags) |
| S4 LLMs | Qwen and Kimi return schema-valid JSON; measure latency and tokens | `cd packages/nextjs && QWEN_BASE_URL=… QWEN_API_KEY=… QWEN_MODEL=… KIMI_… node --experimental-strip-types scripts/spikes/llm-s4.mts 3` |

Checks that run offline:
```
yarn foundry:test          # OmniReceiverSpike unit tests
yarn next:check-types      # frontend types
cd cre/spike-workflow && bun install && bun x cre-compile main.ts dist/workflow.wasm
```

## Honest caveats
- Testnet only. On Perpl testnet the collateral is a test "USD" token, not AUSD.
- The Perpl operator must be an EOA. Phase 1 uses an operator hot key in a worker. Phase 2 moves execution to our own vault contract driven by CRE.
- CRE on monad-testnet (Forwarder address, DON deploy access) is unverified until S3 passes.
