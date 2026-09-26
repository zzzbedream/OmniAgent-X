// Spike S3 (docs/PLAN.md §4): cron → EVM read (lastSequence) → signed report → OmniReceiverSpike.onReport on Monad testnet.
// No LLM calls here on purpose: S3 only proves the CRE ↔ Monad testnet write path.
import { bytesToHex, cre, encodeCallMsg, getNetwork, hexToBase64, LAST_FINALIZED_BLOCK_NUMBER, type Runtime } from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, zeroAddress } from "viem";
import { z } from "zod";

export const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  receiverAddress: z.string(),
  gasLimit: z.string(),
});
type Config = z.infer<typeof configSchema>;

const receiverAbi = parseAbi(["function lastSequence() view returns (uint256)"]);

function evmClientFor(config: Config) {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`);
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
}

const onCron = (runtime: Runtime<Config>): string => {
  const config = runtime.config;
  const evmClient = evmClientFor(config);

  const read = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.receiverAddress as Address,
        data: encodeFunctionData({ abi: receiverAbi, functionName: "lastSequence" }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  const lastSequence = decodeFunctionResult({ abi: receiverAbi, functionName: "lastSequence", data: bytesToHex(read.data) });
  runtime.log(`lastSequence=${lastSequence}`);

  const payload = encodeAbiParameters(parseAbiParameters("uint256 sequence, string note"), [
    lastSequence + 1n,
    "omniagent-cre-spike",
  ]);
  const report = runtime
    .report({ encodedPayload: hexToBase64(payload), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" })
    .result();
  const write = evmClient
    .writeReport(runtime, { receiver: config.receiverAddress, report, gasConfig: { gasLimit: config.gasLimit } })
    .result();

  const txHash = bytesToHex(write.txHash || new Uint8Array(32));
  runtime.log(`writeReport status=${write.txStatus} tx=${txHash}`);
  return txHash;
};

export function initWorkflow(config: Config) {
  const cron = new cre.capabilities.CronCapability();
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)];
}
