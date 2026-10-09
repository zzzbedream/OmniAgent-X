# OmniAgent X: agent context

Passkey-native (Mera) trading assistant on **Monad testnet (10143)**, built for the Monad Metropolis hackathon.
A user states a risk profile in plain language, Kimi → Qwen propose a plan, deterministic checks decide,
and an operator EOA executes on Perpl. Only the user can withdraw.

**Sources of truth, read these before changing behavior:**
- [docs/STATUS.md](docs/STATUS.md): what is verified and what is pending.
- [docs/VERIFIED_FACTS.md](docs/VERIFIED_FACTS.md): every external fact with its primary source.
- [docs/PLAN.md](docs/PLAN.md): phases and go/no-go gates (in Spanish).
- [docs/DEMO.md](docs/DEMO.md) and [docs/DEPLOY.md](docs/DEPLOY.md).

This file only points at those docs. Don't copy facts here.

## State (2026-10-01)
- Phases 1 (core product) and 3 (risk dashboard) are code complete. **Nothing has touched the real network yet.**
- Phase 2 (own vault + Chainlink CRE) has not started. Only the `OmniReceiverSpike` exists.
- The worker runs **dry-run** until spike S2 `--test-order` proves the `execOrder` encoding on testnet.

## Layout
| Path | What lives there |
|---|---|
| `packages/core` (`@omniagent/core`) | Perpl ABIs, order builder, allowlist repair, plan schema, `RiskPolicy`, EIP-712 approval, LLM pipeline, risk metrics |
| `packages/agent-worker` (`@omniagent/worker`) | Operator EOA HTTP service: consent, plan validation, `execOrder`, closes, rate limit, decision log |
| `packages/nextjs` (`@se-2/nextjs`) | PWA: `/onboard`, `/intent`, `/dashboard`, `/api/strategy`, `/api/perpl/context`, Mera in `lib/mera/` |
| `packages/indexer` (`@omniagent/indexer`) | Envio HyperIndex over Perpl events of factory-created accounts |
| `packages/foundry` (`@se-2/foundry`) | Contracts and forge tests. CRE receiver spike in `contracts/spikes/` |
| `cre/spike-workflow` | Chainlink CRE workflow (TS → WASM, needs bun + `cre` CLI) |

The Scaffold-ETH 2 pieces (`blockexplorer/`, `debug/`, `components/scaffold-eth/`, `hooks/scaffold-eth/`) are upstream scaffold code.
`.cursor/rules/scaffold-eth.mdc` describes their hooks.

## Commands
```
yarn install                 # Windows without global yarn: node .yarn/releases/yarn-3.2.3.cjs install
yarn test                    # core + worker + indexer (runs envio codegen) + foundry
yarn core:test | yarn worker:test | yarn indexer:test | yarn foundry:test
yarn next:check-types        # also runs in the pre-commit hook for packages/nextjs/**/*.ts(x)
yarn next:lint
yarn start                   # PWA on :3000. Passkeys need HTTPS off localhost
yarn worker                  # worker on :8787. Needs packages/agent-worker/.env (OPERATOR_PK)
yarn indexer:dev             # needs Docker + ENVIO_API_TOKEN
```
- Node 24 (`.nvmrc`; Mera requires ≥ 24). Yarn 3.2.3 is bundled through `yarnPath`.
- The husky pre-commit hook calls `yarn`, so `yarn` must be on PATH when committing.
- **Native Windows can't run the indexer.** `envio@3.12.1` ships binaries for Linux and macOS only, so `envio codegen`, `indexer:test` and `indexer:dev` fail there (`Cannot read properties of null (reading 'runCli')`). Use WSL2, Linux or macOS. The rest of `yarn test` runs on Windows.
- CRE needs `bun`; the worker image and `indexer:dev` need Docker.
- CI (`.github/workflows/lint.yaml`) runs on `main` only: anvil + deploy, `next:lint --max-warnings=0`, `next:check-types`.

## Invariants (break one and money or correctness goes wrong)
- **The LLM proposes and code decides.** Model output → zod schema → `RiskPolicy`. Free text is never executed.
- **Dry-run by default.** Set `EXECUTION_ENABLED=true` only after S2 `--test-order` passes.
- **Enum offsets differ.** On-chain `OrderDescEnum` starts at `OpenLong = 0`; REST/WS `OrderType` starts at `OpenLong = 1`. Mixing them turns longs into shorts.
- **Position side is never guessed.** On-chain `PositionEnum` is undocumented. An unknown side means the close is rejected.
- **The Perpl operator must be an EOA** (`ECDSA.recover` check). The operator cannot `withdrawCollateral`; only the owner can.
- **Don't copy code from `PerplFoundation/delegated-account`** (BUSL-1.1). Call the deployed contracts through hand-written ABIs only. `packages/core/test/abi.test.ts` pins the selectors.
- **Never hard-code the testnet collateral.** Read it via `Exchange.getExchangeInfo()`. On 2026-10-07 the testnet exchange reported Agora AUSD (`0xa9012a…`), not the "USD" token in api-docs; see VERIFIED_FACTS.
- **Passkeys are bound to the domain (`rpId`).** Changing the domain changes every derived address.
- **No secrets in git.** `OPERATOR_PK`, LLM keys and `ENVIO_API_TOKEN` live in `.env` files that are gitignored.

## Working rules
- A claim about an external system goes into `VERIFIED_FACTS.md` with its source, or is marked **UNVERIFIED**.
- When something gets verified on a real device or network, update `docs/STATUS.md`.
- Keep each doc in its current language: `PLAN.md` is Spanish, the rest is English.
- Report only latencies you measured. No marketing claims in the docs or the pitch.

## Hackathon targets (Monad Metropolis)
Suggested primary track: **Onchain Finance & Trading**. A sponsor bounty only counts if it names that track or "All tracks".

| Bounty | Fit with current code | Gap |
|---|---|---|
| Agora Onchain Trading ($10k) | Mera auth + collateral balance + Perpl trades: the product itself | Testnet collateral is AUSD (on-chain, 2026-10-07). Does a PWA count as a "mobile app"? |
| Perpl Analytics / Risk Tool ($3k) | `/dashboard`, `core/src/risk/metrics.ts` | Needs live data |
| Best use of Perpl's API ($5k) | `agent-worker` bot | Executes on-chain, not through the Ed25519 REST API |
| Best Mera-Powered UX ($2.5k) | `/onboard` | RainbowKit is still the scaffold's wallet path |
| Mera: One Passkey, Many Keys ($2.5k) | Idea: derive the Perpl Ed25519 API key from Mera PRF output | Not started |
| Envio ($1k) | `packages/indexer` | Needs a running indexer |
| Chainlink CRE ($3k) | Spike only | CRE Forwarder on monad-testnet is UNVERIFIED |
| Kimi ($3k credits) | Kimi → Qwen pipeline | API keys |
| Qwen 3.8 Max ($5k credits) | Pipeline | **Tied to the Trust, Identity & AI track**, so it does not pair with Onchain Finance |
| Alchemy ($1k credits) | Alchemy RPC for Monad | Trivial |
| Kuru (2 × $5k) | — | Kuru testnet markets are UNVERIFIED (spike S5) |

Out of scope: Dynamic, Privy, MetaMask Agent Wallet, Cleanverse, Aurora, Nansen and Hunyuan (Social track). They compete with Mera or sit in another track.
vibe/vibe (Robinhood Chain testnet) is also out of scope. It is a different chain; see VERIFIED_FACTS.
