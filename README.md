# OmniAgent X

A passkey-native trading co-pilot on Monad testnet, built for the Monad Metropolis hackathon (track: Onchain Finance & Trading).

You describe a trade in plain language. An LLM proposes a plan, deterministic risk rules approve or reject it, and you sign the exact plan with your passkey. An operator agent then executes it on [Perpl](https://perpl.xyz) perpetuals. The agent can trade, but it can never withdraw. Only your passkey can.

- **Live app (testnet):** https://omniagent-app.147-93-178-184.sslip.io
- **Agent worker health:** https://omniagent.147-93-178-184.sslip.io/health

Source of truth for what is verified and what is not: [`docs/STATUS.md`](docs/STATUS.md) and [`docs/VERIFIED_FACTS.md`](docs/VERIFIED_FACTS.md). The plan, in Spanish, is in [`docs/PLAN.md`](docs/PLAN.md).

## How it works

1. **Passkey ([Mera](https://github.com/category-labs/mera)).** Face ID or a fingerprint derives an EVM key through the WebAuthn PRF extension. There is no seed phrase. The worker's gas station gives a brand-new address testnet MON and AUSD.
2. **Trading account.** A Perpl `DelegatedAccount` is created through Perpl's official factory. You are the owner and the worker's EOA is the operator. The operator can call `execOrder`; only the owner can `withdrawCollateral`.
3. **Strategy.** Your request goes through an LLM parser and planner (DeepSeek, through any OpenAI-compatible endpoint). The output is checked against a zod schema and then a deterministic `RiskPolicy`:
   - allowed markets only;
   - leverage of 3x or less;
   - notional bounds per order;
   - margin within your budget.

   A plan that breaks any rule is rejected whole, never trimmed to fit.
4. **Approval.** You sign an EIP-712 `PlanApproval` over the plan hash. Every action that moves funds asks for a fresh passkey verification.
5. **Execution.** The worker simulates each order with `eth_call`, then sends an IOC `execOrder` through the DelegatedAccount.
6. **Risk.**
   - The dashboard reads positions on-chain and shows live Perpl marks, estimated PnL and liquidation, and the agent's decision log.
   - The **Guardian** is an owner-signed mandate: rules on distance to liquidation, such as "reduce 50% below 8%". It is checked every 5 seconds.

## Verified on Monad testnet

| What | Evidence |
|---|---|
| Operator `execOrder` through a DelegatedAccount (spike S2) | [tx](https://testnet.monadscan.com/tx/0x64b7f7c3fbcf39864278e6868c9b10a3d82150c7163fb2db009781433b8298d0) |
| Live open and close through the production PWA and worker | [open](https://testnet.monadscan.com/tx/0x57e81f14d87111fb0db286ee42ad6d8498a99323faf040372d9b91121b66e5bb) · [close](https://testnet.monadscan.com/tx/0x7fdc3b05a486efed1ba6bf2cec8bedfee92a4d92b519d398bf022f25bc149eee) |
| Automated new-user journey, 11/11 steps (virtual passkey, see below) | [open](https://testnet.monadscan.com/tx/0x9c15d2466106f4f79dceec31a2f02579b9c46fb80a307fb4c810ced38e9602be) · [close](https://testnet.monadscan.com/tx/0x40a0aed6a6816e31b24a96d5c2e872610ef17c59c7a8669b76b2ac2d1f7dfff6) |
| External tester on an iPhone: automatic funding and full onboarding | DelegatedAccount `0x9C487AF208853DF7de29640B09e606Bb538A9bcF` (exchange account 1035) |

Measured on the live deployment (2026-10-09, public RPC):

| Operation | Time |
|---|---|
| Plan generation (two LLM calls) | 6–7 s |
| Gas station funding | 2.2 s |
| Full journey as a new user | 2.5 min |

Most of the full journey is nine allowlist transactions. On the public RPC they took between 19 s and 68 s.

## Try it

You need an iPhone with iOS 18+ (Safari) or an Android phone with Chrome and Google Password Manager.

1. **Cuenta.** Type a name and press **Crear passkey**. Wait for "Preparando tu cuenta" (test gas and AUSD arrive by themselves).
2. Press **Crear cuenta de trading**, then **Reparar permisos**, then **Depositar y abrir** (100 AUSD minimum on testnet).
3. **Estrategia.** Type e.g. "Corto pequeño en ETH, bajo riesgo" with a budget of 5, then **Generar plan** and **Aprobar con passkey**.
4. **Riesgo.** See the position, then **Cerrar con passkey**. Back in **Cuenta**, press **Retirar**.

After the first visit, use **Ya tengo passkey**. On iOS, "Crear passkey" always creates a new passkey, and with it a new address.

## Layout

| Path | What lives there |
|---|---|
| `packages/core` | Perpl ABIs and order builder, allowlist repair, plan schema, `RiskPolicy`, EIP-712 types, LLM pipeline, risk metrics, guardian engine |
| `packages/agent-worker` | Operator service: consent, plan and close validation, `execOrder`, guardian loop, gas station, decision log |
| `packages/nextjs` | PWA: `/onboard`, `/intent`, `/dashboard`, `/guardian`, `/api/strategy`, `/api/guardian/compile`. Mera is in `lib/mera/`; the design system is in `.stitch/` |
| `packages/indexer` | Envio HyperIndex over Perpl events of factory-created accounts |
| `packages/foundry` | Contracts and forge tests; the CRE receiver spike |
| `cre/spike-workflow` | Chainlink CRE workflow (TypeScript → WASM) |

## Run, test, deploy

```
yarn install                  # Node 24 (.nvmrc); Yarn 3.2.3 is bundled
yarn core:test && yarn worker:test
yarn next:check-types && yarn next:lint
yarn worker                   # needs packages/agent-worker/.env (see .env.example)
yarn start                    # PWA on :3000; passkeys need HTTPS outside localhost
```

- **Deploy.** Docker images for the worker and the PWA, behind Caddy; see [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Demo script.** [`docs/DEMO.md`](docs/DEMO.md).
- **Automated live test.** `packages/nextjs/scripts/qa/live-e2e.mjs` drives the whole journey in headless Chromium with a virtual passkey that supports PRF. It runs against the real PWA, worker and testnet, and saves screenshots and a video.

## Honest caveats

- **Testnet only.** The collateral is Agora's test AUSD, read on-chain from `Exchange.getExchangeInfo()`.
- **The operator is a hot key on a VPS (Phase 1).** Phase 2 (our own vault driven by Chainlink CRE) has not started.
- **Guardian collateral top-ups are disabled.** The parameter order of `increasePositionCollateral` is unverified on testnet. Reduce and close rules work.
- **Position side is never guessed.** Without the indexer, only positions opened by this worker can be closed from the app.
- **The trading account address is remembered per browser.** In another browser the app offers to create a new account.
- **Estimates only.** PnL and liquidation price ignore funding and fees; Perpl does not publish its margin formula.
- **In-memory limits.** LLM quotas and rate limits are per process and in memory.
