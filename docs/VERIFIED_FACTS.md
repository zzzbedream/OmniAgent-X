# Verified facts (as of 2026-09-26)

Each row was checked against a primary source (npm tarball or GitHub repo at the commit shown).
The docs sites (docs.monad.xyz, docs.perpl.xyz, docs.chain.link) were blocked from the build
environment, so anything that only those sites would confirm is marked **UNVERIFIED**.

## Sources inspected

| Source | Version / commit |
|---|---|
| `@category-labs/mera` (npm) + `github.com/category-labs/mera` docs | 0.2.0 / `a3102f4` |
| `@chainlink/cre-sdk` (npm) | 1.22.0 |
| `github.com/smartcontractkit/cre-templates` | `d0223f3` |
| `@x402/evm` (npm) | 2.27.0 |
| `github.com/PerplFoundation/delegated-account` | HEAD at clone time (2026-09-26) |
| `github.com/PerplFoundation/api-docs` | HEAD at clone time (2026-09-26) |
| `github.com/Kuru-Labs/kuru-sdk` | `636509c` (last commit 2026-04-15) |
| `github.com/monad-developers/scaffold-monad-foundry` | `14fa9c8` (base of this repo) |

## Mera
- A passkey-account library, not a "runtime architecture guide". Status: **preview**, "API may change before 1.0". `engines.node >= 24`.
- Mera returns only the 32-byte PRF output and signing sessions. BIP-39/BIP-32 derivation is app code, following the official recipe `docs/recipes/create-passkey-accounts.mdx`. Implemented in `packages/nextjs/lib/mera/account.ts`.
- The default PRF salt is `sha256("mera.prf.salt.v1")` and is documented as stable across versions.
- `@category-labs/mera/viem` → `toViemAccount(session)` signs transactions, EIP-191, EIP-712 and EIP-7702 without a per-signature prompt.
- PRF support (`docs/authenticator-support.md`):
  - Works: iCloud Keychain on iOS/macOS 18+/15+ (Safari, Chrome, Firefox), Google Password Manager on Android, 1Password, YubiKey 5.
  - **Does not work** (tested 2026-06-01): desktop Chrome local-profile passkeys, Bitwarden, Dashlane.
- React Native is supported on iOS 18+ and Android 9+ (peer `react-native-passkey@3.6.1`).

## Perpl
- `DelegatedAccount` checks operator consent with `ECDSA.recover(digest, sig) == operator` (`src/DelegatedAccount.sol:163`, `src/DelegatedAccountFactory.sol:140`). **So the operator must be an EOA; a contract cannot be the operator.**
- The operator cannot call `withdrawCollateral`, which is owner-only.
  - Default operator allowlist: `execOrder`, `execOrders`, `increasePositionCollateral`, `requestDecreasePositionCollateral`, `buyLiquidations`, `depositCollateral`, `allowOrderForwarding`.
  - The operator can call `resignOperator()`.
- EIP-712 domains:
  - Factory: `("DelegatedAccountFactory","1")`.
  - Account: `("DelegatedAccount","1")`.
  - Type: `AssignOperator(address owner,uint256 nonce,uint256 deadline)`.
- Network config:

  | | Testnet | Mainnet |
  |---|---|---|
  | Chain ID | 10143 | 143 |
  | Factory | `0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209` | `0xc535276e3e446e4f28d95ed27ccd5c32e4c8907a` |
  | Exchange | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |
  | Collateral | `0xdf5b718d8fcc173335185a2a1513ee8151e3c027` (**"USD", not AUSD**) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (AUSD) |
  | REST | `https://testnet.perpl.xyz/api` | `https://app.perpl.xyz/api` |
  | WS | `wss://testnet.perpl.xyz` | `wss://app.perpl.xyz` |
  | Market IDs | BTC 16, ETH 32, SOL 48, MON 64, ZEC 256 | BTC 1, MON 10, ETH 20, SOL 31, HYPE 40, ZEC 50 |

- Minimum deposit to open an account: 10 (collateral units, shown as "10.0 AUSD" on mainnet).
- API auth uses Ed25519 API keys, enrolled once with a wallet signature.
- `delegated-account` is licensed **BUSL-1.1**. This repo copies none of its code and only calls the deployed contracts through their public ABI.
- **On-chain `OrderDescEnum` starts at `OpenLong = 0`** (OpenLong, OpenShort, CloseLong, CloseShort, Cancel, IncreasePositionCollateral, Change), per `test/DelegatedAccount.fork.t.sol`. The REST/WS `OrderType` starts at `OpenLong = 1`. Mixing them would turn every long into a short.
- `OrderDesc` semantics come from Perpl's fork test `_btcPostOnlyBid`:
  - Prices are absolute PNS (scaled by `priceDecimals`); the book gives ONS offsets from `basePricePNS`, so best bid = `basePricePNS + maxBidPriceONS`.
  - Lots are LNS (scaled by `lotDecimals`) and leverage is in hundredths.
  - A resting order uses `orderDescId 0` and `expiryBlock = block + 1000`.
  - BTC on testnet had `priceDecimals 1` and `lotDecimals 5`.
- **The testnet Factory mints accounts with a stale operator allowlist.** `execOrder` (`0x4d8dc985`) is NOT allowed until the owner grants it (`Fork_DeployedFactoryAllowlist_Test`). The repair grants 7 current selectors and revokes 5 stale ones (`script/helpers/OperatorAllowlistScript.sol`). It is implemented in `packages/core/src/perpl/allowlist.ts`, in the `/onboard` UI and in S2.
- Every selector in the hand-written Exchange ABI matches `solc --hashes interfaces/IExchange.sol` (enforced by `packages/core/test/abi.test.ts`).
- **Contradiction on testnet collateral:**
  - api-docs: `0xdf5b718d8fcc173335185a2a1513ee8151e3c027` ("USD").
  - fork test: `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` ("AUSD, 6 decimals").
  - The code reads it on-chain via `Exchange.getExchangeInfo()` and hard-codes neither.
- Perpl's fork tests call `setIgnOracle(BTC, true)` as the exchange owner before placing orders. **Risk:** on live testnet an order may revert when the oracle is stale; S2 `--test-order` prints `ignOracle` and the revert reason.
- **UNVERIFIED:**
  - A public faucet for the testnet collateral token.
  - IOC behavior when priced away from the book.
  - Minimum lot sizes.
  - Units of `fundingRatePct100k` (not fed to the LLM).
  - `PositionEnum` values (close orders are not implemented yet).

## Chainlink CRE
- Workflows compile to WASM through Javy/QuickJS. There is no `fetch`, no `node:*` and no `setTimeout`. Tooling: `bun` plus the `cre` CLI. This repo's `cre/spike-workflow` compiles to WASM with `cre-compile`.
- EVM writes go through `runtime.report(...)` and then `evmClient.writeReport({ receiver, report })`. The Forwarder calls `IReceiver.onReport(metadata, report)` on **your** contract, which is not an arbitrary transaction. Metadata is `abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address owner)`.
- The SDK ships chain selectors `monad-testnet` (2183018362218727504) and `monad-mainnet` (8481857512324358265).
- In DON mode every node performs the HTTP call. `cacheSettings` on a request lets nodes reuse one response. The consensus helpers are `consensusIdenticalAggregation`, `consensusMedianAggregation` and `ConsensusAggregationByFields`.
- **UNVERIFIED:** that a CRE Forwarder is deployed on monad-testnet (and its address), and that deploying to a live DON needs no early-access approval.

## x402
- `@x402/evm@2.27.0` default assets: Monad **mainnet** (`eip155:143`) USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`. It has no default entry for testnet 10143 and none for AUSD.
- **UNVERIFIED:** a facilitator that settles on Monad testnet.

## Kuru
- The SDK examples target `api.kuru.io`, `api.staging.kuru.io` and `ws.staging.kuru.io`. **UNVERIFIED:** Monad testnet markets.

## AI models (web search, secondary sources)
- Qwen3.8-Max: Alibaba Cloud Model Studio, released 2026-08-02, 1M context, function calling and structured output. Snapshot `qwen3.8-max-2026-09-02`.
- Kimi K2.7-Code: released 2026-06-12, 256K context, available on platform.moonshot.ai with an OpenAI-compatible API. OpenRouter lists US$0.95 / US$4.00 per million tokens.
- **UNVERIFIED:** exact API base URLs and native model ids. `scripts/spikes/llm-s4.mts` therefore takes them from environment variables.

## Scaffold fixes applied
- `scaffold.config.ts` used `chains.monad_testnet`, which does not exist in viem 2.31.1. The export is `monadTestnet`. Unfixed, `targetNetworks` would contain `undefined` at runtime.
- `hooks/scaffold-eth/useTransactor.tsx` had a strict-mode type error, fixed without changing behavior.

## Phase 3 additions
- The market-data WebSocket `wss://testnet.perpl.xyz/ws/v1/market-data` is public and allows 16 subscriptions and 10 requests/min per connection.
  - `market-state@<chainId>` (mt 9) carries oracle, mark, last, mid, bid, ask, 24h price, OI and TVL, with prices scaled by `price_decimals`.
  - `heartbeat@<chainId>` (mt 100) has a strictly +1 `sn`.
  - The trading stream (positions, fills) needs an API key, which needs Perpl to whitelist the enrollment Origin. Not used; positions are read on-chain.
- REST `PositionType` is 1 Long / 2 Short. The **on-chain** `PositionEnum` values are undocumented.
- Exchange event signatures come from `solc --combined-json abi interfaces/IExchangeEvents.sol`. `PositionOpened`, `PositionIncreased` and others have `V2` variants; which one the live Exchange emits is unverified, so the indexer handles both.
- Perpl event params are not `indexed`. HyperSync cannot filter by account, so the indexer filters in its handlers against factory-created accounts.
- `maintenance_margin` / `initial_margin` in `/v1/pub/context`: the docs say "hundredths" but give `2000 = 5%` and `1000 = 10%`. `fraction = 100 / raw` fits both examples; that is an inference.
- The Envio CLI 3.12.1 HyperSync chain table includes `monad-testnet` (read from the native binary). HyperSync requires an `ENVIO_API_TOKEN`.

## Spike S6: vibe/vibe (Robinhood Chain testnet), out of Monad scope (2026-10-01)
Context: an unsolicited DM invited us to launch a token on `testnet.vibevibe.fun`. This read-only spike checks what it is before spending any time on it. No wallet was connected, nothing was signed, nothing was deposited.

- **Different chain.** It runs on Robinhood Chain testnet. Checked with `cast chain-id` and `cast block-number` against `https://rpc.testnet.chain.robinhood.com`: chain ID `46630`, head block `127,316,903` on 2026-10-01.
  - Explorer: `https://explorer.testnet.chain.robinhood.com`.
  - It is **not Monad**. A token or app there counts toward no Metropolis track or bounty.
- **What it is.** A permissionless bonding-curve token launchpad by Seedify.
  - Per its public config, `GET https://testnet.vibevibe.fun/api/v1/chains/46630/config` (no API key):
    - policy `seedify-curve-v3-testnet-5eth-2pct-3pct-creator-125bps-75-25`, supply 1e9 tokens;
    - curve fee 125 bps, split 75% creator / 25% protocol;
    - graduation at 5 ETH net, creation fee 0.0005 ETH, wallet cap 2%;
    - transfers locked until graduation, buybacks sent to a burn address;
    - after graduation, trading uses Uniswap v4 contracts (pool manager, universal router, Permit2).
  - The bare `/api/v1/chains/46630/` route returns 404.
- **Factories.** All three still have code and still mint launches (`cast code`, `cast call launchCount()`, 2026-10-01):

  | Generation | Factory | `launchCount()` |
  |---|---|---|
  | current (in config `deployments`) | `0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59` | 142,243 |
  | legacy (in `legacyPublicGraphs`) | `0xB5B7A2f6c4EAFa2D73918fcA32d50e2126339eb9` | 46,151 |
  | retired (no longer listed) | `0x4FEbC267e0C24440bcDEF72B5DBC5FE7BED091dF` | 14,811 |

  - The legacy and retired addresses, and the finding that the retired factory charges 100 bps at a 50/50 split, come from the community indexer `github.com/itstorvian/vibevibe-testnet-indexer` (`config/factories.ts`).
  - That repo is unofficial. We re-read only `launchCount()` and the bytecode.
- **Terms** (text embedded in the site bundle, legal version `2026-08-29-v2-v3`):
  - Operated by SPARK LABS ORGANIZATION, S.A. (Panama). Disputes go to binding arbitration in Panama City.
  - "test ETH, testnet tokens, fees, and rankings have no monetary value".
  - Rewards: the operator "intends, at its sole and absolute discretion, to recognise recorded testnet participation if a future mainnet token is ever created". It also says "No program is offered or promised".
  - It disqualifies sybil activity, wash trading and automated abuse.
  - The community indexer reports that the terms disable mainnet chain 4663. **UNVERIFIED** here.
- **UNVERIFIED:** the "builder role" program requirements, any vibe/vibe deployment on Monad, and an official Discord link. Take the Discord link only from the official X account `@vibevibefun`, never from a DM.

**Decision: no-go for the hackathon build.** Revisit only if all three hold:
1. The Phase 0 gates pass.
2. The core demo works end to end.
3. The hackathon rules allow a token launch.

Any experiment uses a fresh burner wallet. Wallet approvals on testnet are still real signatures.

## Verified 2026-10-01 to 2026-10-07 (from this machine, which reaches the real networks)
- **Monad testnet RPC** `https://testnet-rpc.monad.xyz` answers: `cast chain-id` = 10143.
- **Perpl testnet collateral is Agora's AUSD.**
  - `Exchange.getExchangeInfo()` returns `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, `symbol()` "AUSD", 6 decimals.
  - This settles the api-docs vs fork-test contradiction above; the code still reads it on-chain.
- **Perpl testnet minimums** (`GET https://testnet.perpl.xyz/api/v1/pub/context`):
  - `min_account_open_amount` 100000000 = **100 AUSD** to open an account.
  - `min_deposit_amount` 10000000 = 10 AUSD for later deposits.
- **BTC testnet margins** in the same context: `initial_margin` 1500, `maintenance_margin` 2500. With `fraction = 100 / raw` that is 6.67% and 4%.
- **Perpl has native trigger orders** (`PerplFoundation/api-docs` types.md and websocket.md):
  - A single trigger price with a GTE/LTE condition on last or mark price, optionally linked to a position (`lp`).
  - The guardian differs by acting on liquidation distance, drawdown and leverage, with graduated responses.
- **Agora AUSD faucet** `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (docs.agora.finance contract deployments):
  - Has code and holds about 999M AUSD.
  - It is an EIP-1967 transparent proxy; implementation `0xba804df5c476e8eaef87bf8085f295300cce2a49` has `requestFunds(address)` `0x544c7cf9` and `token()` = AUSD.
  - **Verified 2026-10-08:** a `requestFunds(owner)` transaction sent 10,000 AUSD (tx `0x3ff12d42d1f27192bbd78fa9587fb21a5afafa4c0862bd72f5ed1a691603af0e`). Cooldown and limits unknown.
- **`Exchange.increasePositionCollateral(uint256,uint256)`** has selector `0xf769f0d3`, the one in the current operator allowlist.
  - The parameter order (perpId, amountCNS) is **UNVERIFIED**, so guardian top-ups stay off (`GUARDIAN_ADD_COLLATERAL=false`) until spike S2-bis.
- **ERC-8004 on Monad testnet** (repo `erc-8004/erc-8004-contracts`, testnet address set):
  - Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` (`name()` "AgentIdentity").
  - Reputation Registry `0x8004B663056A597Dffe9eCcC1965A193B7388713`.
  - Both are proxies. The implementations contain `register(string)` `0xf2c298be`, `setAgentURI` `0x0af28bd3` and `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)` `0x3c036a7e`.
  - The mainnet addresses in docs.monad.xyz (`0x8004A169…`, `0x8004BAa1…`) have **no code on testnet**.
  - `register` simulated against testnet returns a fresh agentId.
  - Per the spec, the feedback submitter must not be the agent owner or an approved operator.
- **DeepSeek API** (api-docs.deepseek.com, Oct 2026):
  - Base URL `https://api.deepseek.com`, OpenAI-compatible `/chat/completions`.
  - Models `deepseek-flash` (V4.1) and `deepseek-v4-pro`, both with JSON Output and tool calls.
  - JSON mode needs the word "json" and an example in the prompt, and "may occasionally return empty content". `chatJson` retries once.
  - Flash costs US$0.15–0.30 per M input tokens (cache miss) and US$0.60–1.20 per M output; off-peak is half.
- **Windows dev machine:**
  - `envio@3.12.1` ships Linux and macOS binaries only, so indexer codegen and tests need Linux.
  - Under memory pressure, `tsc`/vitest/lint can fail with `VirtualAlloc failed`. That is an environment failure, not a code failure.

## Verified 2026-10-08: spike S2 on Monad testnet (run from the team VPS)
- `perpl-s2.mts --write` with a burner owner and the worker's operator `0xA900773d87C3769074a238E9b572588559D2DA46`:
  - Factory `create` with the operator's EIP-712 `AssignOperator` signature works. DelegatedAccount `0xcE547926d157A17E9da942cAbD6f72bFA4d636cb`.
  - Transfer 100 AUSD + `createAccount(100 AUSD)` gives exchange `accountId` 1001.
  - The factory still mints the stale allowlist. The sync granted `0x4d8dc985`, `0x39435dac`, `0x171a5b81`, `0xbbac6c95` and revoked the five stale selectors.
- `perpl-s2.mts --test-order`: the operator called `execOrder` through the DelegatedAccount. Post-only OpenLong (on-chain enum 0), BTC perp 16, 10 lots, 1x.
  - Simulation returned `orderId` 145; tx `0x64b7f7c3fbcf39864278e6868c9b10a3d82150c7163fb2db009781433b8298d0` succeeded.
  - BTC at that moment: `priceDecimals` 1, `lotDecimals` 5, `status` 4.
  - **This validates the `OrderDesc` encoding**, the gate for `EXECUTION_ENABLED=true`. Fills, closes and IOC semantics are still unverified.

## Verified 2026-10-08: `maxNegPnlCollatBPS` blocks crossing orders (eth_call probes, nothing sent)
Probed with `eth_call` from the worker operator through DelegatedAccount `0x98A4…8713`, which held 100 AUSD.
- With `maxNegPnlCollatBPS = 0`, every order that would cross the book reverts with custom error `0xb29d1949`.
  - This held for IOC, FOK and GTC orders, any `maxMatches`, and any `amountCNS`.
  - Orders that do not cross pass: an IOC at mark below the best ask returns `orderId` 0, and a post-only bid returns an orderId.
  - The selector is not in the openchain or 4byte databases.
- The same orders pass with a larger cap. For a 5 USD, 1x IOC at mark ± 0.5%:
  - 1 bps: only BTC passes both sides.
  - 10 bps: everything passes except MON long.
  - 50 bps and up: all four markets pass.
- **Inference (UNVERIFIED against Perpl docs):** the field caps the negative PnL the order may cause, in bps of the position's collateral.
- Fix in `core/src/perpl/orders.ts`:
  - Opens use `slippageBps × leverage + 50`.
  - Closes use 10000, so a losing position can always be closed.
  - Re-probed: 48/48 combinations pass (4 markets × long/short × 5/25/60 USD × 1x/3x).
- Before the fix, the worker's dry-run only built orders and could not have caught this. The dry-run now simulates every built order with `eth_call`.

## Verified 2026-10-09: Perpl market-data WebSocket rejects foreign browser Origins
- `wss://testnet.perpl.xyz/ws/v1/market-data` upgrade responses by request `Origin`:

  | Origin | Response |
  |---|---|
  | none | 101 |
  | `https://testnet.perpl.xyz` | 101 |
  | our PWA domain | 403 |
  | `http://localhost:3000` | 403 |
  | `https://app.perpl.xyz` | 403 |

- A browser always sends `Origin`, so the PWA cannot open the socket directly. The 2026-09 dashboard check used a mocked WS, so this had never been exercised live.
- Workaround in production: the PWA's Caddy site relays `/perpl-ws/*` to Perpl with the `Origin` header removed. The PWA is built with `NEXT_PUBLIC_PERPL_WS_URL` pointing at the relay. Through the relay, our origin gets 101.
- Every viewer's socket now reaches Perpl from the VPS IP. The documented limits are per connection (16 subscriptions, 10 requests/min); a per-IP limit is **UNVERIFIED**.

## Verified 2026-10-09: live open and close through the production PWA and worker
Burner DelegatedAccount `0xcE54…36cb`, accountId 1001, `EXECUTION_ENABLED=true`, slippage 50 bps.
- **Plan.** `/api/strategy` (DeepSeek) proposed a short of 5 USD on ETH at 1.5x. The rules approved it.
- **Open.** The IOC OpenShort **filled**. Tx `0x57e81f14d87111fb0db286ee42ad6d8498a99323faf040372d9b91121b66e5bb`.
  - `getPosition`: 2 lots (0.002 ETH), entry 2,481.95, deposit 3.309507 AUSD (= notional / 1.5).
  - Free balance went from 99.9 to 96.58878.
- **Close.** `POST /close` signed by the owner sent an IOC CloseShort. Tx `0x7fdc3b05a486efed1ba6bf2cec8bedfee92a4d92b519d398bf022f25bc149eee`.
  - The side came from the worker's own log (`sideSource: worker-log`).
  - Afterwards the position had 0 lots and the balance was 99.896354, about 0.0036 AUSD of fees and spread for the round trip.
- **Observation, not a rule:** this short position reported `positionType` 1. The on-chain `PositionEnum` is still undocumented, so the code keeps refusing to infer a side from it.
