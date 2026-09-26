import type { Hex } from "viem";

export type WorkerConfig = {
  operatorPk: Hex;
  rpcUrl: string;
  port: number;
  allowedOrigins: string[];
  executionEnabled: boolean;
  slippageBps: number;
  dataDir: string;
  /** Requests per minute per client IP on POST routes. */
  rateLimitPerMin: number;
  /** Behind a reverse proxy (Railway, Fly, …): take the client IP from the first X-Forwarded-For hop. */
  trustProxy: boolean;
  /** Optional Envio GraphQL URL, used only as a fallback to learn a position's side. */
  indexerUrl?: string;
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
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 20),
    trustProxy: env.TRUST_PROXY === "true",
    indexerUrl: env.INDEXER_URL || undefined,
  };
}
