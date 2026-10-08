// Registers the guardian as an ERC-8004 agent on Monad testnet, owned by the operator key.
// The agentURI points at the PWA's registration file (/.well-known/agent-card.json).
//
//   OPERATOR_PK=0x.. APP_URL=https://<pwa-host> yarn workspace @omniagent/worker register-8004          # simulate
//   OPERATOR_PK=0x.. APP_URL=https://<pwa-host> yarn workspace @omniagent/worker register-8004 --send   # send tx
//
// Prints the agentId; set it as NEXT_PUBLIC_GUARDIAN_AGENT_ID in the PWA so the card and feedback use it.
import { ERC8004_TESTNET, identityRegistryAbi } from "@omniagent/core";
import { type Hex, createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

async function main() {
  const pk = process.env.OPERATOR_PK;
  const appUrl = process.env.APP_URL;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("OPERATOR_PK must be a 0x-prefixed 32-byte hex key");
  if (!appUrl || !/^https:\/\//.test(appUrl)) throw new Error("APP_URL must be the PWA's https origin");

  const account = privateKeyToAccount(pk as Hex);
  const transport = http(process.env.MONAD_TESTNET_RPC || undefined);
  const client = createPublicClient({ chain: monadTestnet, transport });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  const agentURI = `${appUrl.replace(/\/$/, "")}/.well-known/agent-card.json`;

  console.log(`owner ${account.address}\nregistry ${ERC8004_TESTNET.identityRegistry}\nagentURI ${agentURI}`);
  const { request, result } = await client.simulateContract({
    account,
    address: ERC8004_TESTNET.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [agentURI],
  });
  console.log(`simulation ok: would mint agentId ${result}`);
  if (!process.argv.includes("--send")) return console.log("dry run: pass --send to register");

  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted in tx ${hash}`);
  const [registered] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: receipt.logs });
  console.log(`registered: agentId ${registered?.args.agentId} tx ${hash}`);
}

main().catch(e => {
  console.error((e as Error).message);
  process.exit(1);
});
