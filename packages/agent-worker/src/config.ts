import type { Hex } from "viem";

export type WorkerConfig = {
  operatorPk: Hex;
  rpcUrl: string;
  port: number;
  allowedOrigins: string[];
  executionEnabled: boolean;
  slippageBps: number;
  dataDir: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const operatorPk = env.OPERATOR_PK;
  if (!operatorPk || !/^0x[0-9a-fA-F]{64}$/.test(operatorPk)) {
    throw new Error("OPERATOR_PK must be a 0x-prefixed 32-byte hex private key");
  }
  const slippageBps = Number(env.SLIPPAGE_BPS ?? 50);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
    throw new Error("SLIPPAGE_BPS must be an integer in [0, 1000]");
  }
  return {
    operatorPk: operatorPk as Hex,
    rpcUrl: env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz",
    port: Number(env.PORT ?? 8787),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
    executionEnabled: env.EXECUTION_ENABLED === "true",
    slippageBps,
    dataDir: env.DATA_DIR ?? "./data",
  };
}
