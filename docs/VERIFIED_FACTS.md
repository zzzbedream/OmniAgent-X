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
- **UNVERIFIED:** a public faucet for the testnet "USD" collateral token. `OrderDesc` price and lot scaling per market (`pricePNS`, `lotLNS`).

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
