import { type Hex, parseEther } from "viem";

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
  /** Guardian tick period; 0 disables the loop (mandates are still accepted and stored). */
  guardianIntervalMs: number;
  /** Allow collateral top-ups. Off until increasePositionCollateral is proven on testnet (S2-bis). */
  guardianAddCollateral: boolean;
  /** Perpl REST base, for the maintenance margins in /v1/pub/context. */
  perplApiUrl: string;
  /** Testnet gas station for brand-new passkey addresses; undefined (no GAS_STATION_PK) turns it off. */
  gasStation?: { pk: Hex; dripWei: bigint; dailyCap: number };
};

/** Parses GAS_STATION_* settings. The station key must differ from the operator's: separate roles, separate funds. */
function loadGasStation(env: Record<string, string | undefined>, operatorPk: string): WorkerConfig["gasStation"] {
  const pk = env.GAS_STATION_PK;
  if (!pk) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("GAS_STATION_PK must be a 0x-prefixed 32-byte hex private key");
  if (pk.toLowerCase() === operatorPk.toLowerCase()) throw new Error("GAS_STATION_PK must not be the operator key");
  const dripWei = parseEther(env.GAS_DRIP_MON ?? "0.5");
  if (dripWei <= 0n || dripWei > parseEther("5")) throw new Error("GAS_DRIP_MON must be in (0, 5]");
  const dailyCap = Number(env.GAS_DAILY_CAP ?? 40);
  if (!Number.isInteger(dailyCap) || dailyCap < 1) throw new Error("GAS_DAILY_CAP must be a positive integer");
  return { pk: pk as Hex, dripWei, dailyCap };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const operatorPk = env.OPERATOR_PK;
  if (!operatorPk || !/^0x[0-9a-fA-F]{64}$/.test(operatorPk)) {
    throw new Error("OPERATOR_PK must be a 0x-prefixed 32-byte hex private key");
  }
  const slippageBps = Number(env.SLIPPAGE_BPS ?? 50);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
    throw new Error("SLIPPAGE_BPS must be an integer in [0, 1000]");
  }
  const guardianIntervalMs = Number(env.GUARDIAN_INTERVAL_MS ?? 5000);
  if (!Number.isInteger(guardianIntervalMs) || guardianIntervalMs < 0 || (guardianIntervalMs > 0 && guardianIntervalMs < 1000)) {
    throw new Error("GUARDIAN_INTERVAL_MS must be 0 (off) or an integer >= 1000");
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
    guardianIntervalMs,
    guardianAddCollateral: env.GUARDIAN_ADD_COLLATERAL === "true",
    perplApiUrl: env.PERPL_API_URL || "https://testnet.perpl.xyz/api",
    gasStation: loadGasStation(env, operatorPk),
  };
}
