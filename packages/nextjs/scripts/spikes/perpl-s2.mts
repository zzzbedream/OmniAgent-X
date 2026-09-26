// Spike S2 (docs/PLAN.md §4): Perpl DelegatedAccount on Monad testnet with an EOA operator.
//
// Run (Node >= 22.6, from packages/nextjs):
//   node --experimental-strip-types scripts/spikes/perpl-s2.mts            # read-only checks
//   OWNER_PK=0x.. OPERATOR_PK=0x.. DEPOSIT=10 \
//   node --experimental-strip-types scripts/spikes/perpl-s2.mts --write    # create account + deposit
//
// Addresses come from PerplFoundation/delegated-account README and PerplFoundation/api-docs README
// (see docs/VERIFIED_FACTS.md). The script only uses the deployed contracts' public ABI; no BUSL code is copied.
//
// Out of scope here: execOrder. Its OrderDesc encoding (price/lot scaling per market) is not verified yet;
// do that step with the Perpl api-docs examples before automating it.
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  parseEventLogs,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const RPC_URL = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const FACTORY: Address = "0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209";
const EXCHANGE: Address = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc";
const COLLATERAL: Address = "0xdf5b718d8fcc173335185a2a1513ee8151e3c027"; // testnet "USD", not AUSD

const factoryAbi = parseAbi([
  "function EXCHANGE() view returns (address)",
  "function operatorNonces(address) view returns (uint256)",
  "function create(address operator, uint256 opDeadline, bytes opSig) returns (address)",
  "event DelegatedAccountCreated(address indexed proxy, address indexed owner, address indexed operator)",
]);
const accountAbi = parseAbi([
  "function createAccount(uint256 amount)",
  "function accountId() view returns (uint256)",
  "function isOperator(address) view returns (bool)",
  "function owner() view returns (address)",
]);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function readOnlyChecks() {
  const chainId = await publicClient.getChainId();
  check("chain id is 10143", chainId === 10143, `got ${chainId}`);
  for (const [name, address] of [
    ["factory", FACTORY],
    ["exchange", EXCHANGE],
    ["collateral", COLLATERAL],
  ] as const) {
    const code = await publicClient.getCode({ address });
    check(`${name} has code`, !!code && code !== "0x", address);
  }
  const boundExchange = await publicClient.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "EXCHANGE",
  });
  check(
    "factory.EXCHANGE matches documented exchange",
    boundExchange.toLowerCase() === EXCHANGE.toLowerCase(),
    boundExchange,
  );
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: COLLATERAL, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: COLLATERAL, abi: erc20Abi, functionName: "decimals" }),
  ]);
  console.log(`INFO  collateral symbol=${symbol} decimals=${decimals}`);
  return { decimals };
}

async function createAndFund(decimals: number) {
  const ownerPk = process.env.OWNER_PK as Hex | undefined;
  const operatorPk = process.env.OPERATOR_PK as Hex | undefined;
  if (!ownerPk || !operatorPk) throw new Error("OWNER_PK and OPERATOR_PK are required with --write");
  const owner = privateKeyToAccount(ownerPk);
  const operator = privateKeyToAccount(operatorPk);
  const deposit = parseUnits(process.env.DEPOSIT ?? "10", decimals);

  const balance = await publicClient.readContract({
    address: COLLATERAL,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner.address],
  });
  check("owner holds enough collateral", balance >= deposit, `${formatUnits(balance, decimals)} available`);
  if (balance < deposit) return;

  // Operator consents off-chain: EIP-712 AssignOperator on the FACTORY domain (creation-time path).
  const nonce = await publicClient.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "operatorNonces",
    args: [operator.address],
  });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const opSig = await operator.signTypedData({
    domain: { name: "DelegatedAccountFactory", version: "1", chainId: monadTestnet.id, verifyingContract: FACTORY },
    types: {
      AssignOperator: [
        { name: "owner", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "AssignOperator",
    message: { owner: owner.address, nonce, deadline },
  });

  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC_URL) });
  const createHash = await wallet.writeContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "create",
    args: [operator.address, deadline, opSig],
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  const [created] = parseEventLogs({ abi: factoryAbi, logs: createReceipt.logs, eventName: "DelegatedAccountCreated" });
  check("DelegatedAccount created", !!created, createHash);
  if (!created) return;
  const proxy = created.args.proxy;
  console.log(`INFO  DelegatedAccount=${proxy}`);

  const transferHash = await wallet.writeContract({
    address: COLLATERAL,
    abi: erc20Abi,
    functionName: "transfer",
    args: [proxy, deposit],
  });
  await publicClient.waitForTransactionReceipt({ hash: transferHash });

  const accountHash = await wallet.writeContract({
    address: proxy,
    abi: accountAbi,
    functionName: "createAccount",
    args: [deposit],
  });
  await publicClient.waitForTransactionReceipt({ hash: accountHash });

  const [accountId, isOp] = await Promise.all([
    publicClient.readContract({ address: proxy, abi: accountAbi, functionName: "accountId" }),
    publicClient.readContract({
      address: proxy,
      abi: accountAbi,
      functionName: "isOperator",
      args: [operator.address],
    }),
  ]);
  check("exchange accountId assigned", accountId > 0n, `accountId=${accountId}`);
  check("operator registered", isOp, operator.address);
}

const { decimals } = await readOnlyChecks();
if (process.argv.includes("--write")) await createAndFund(decimals);
