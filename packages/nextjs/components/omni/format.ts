import { type MarketSymbol, OrderDescType, PERPL_TESTNET } from "@omniagent/core";

export const EXPLORER_TX = "https://testnet.monadscan.com/tx/";

export const shortHex = (h: string, head = 6, tail = 4) =>
  h.length > head + tail ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;

export const fmtUsd = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const MARKET_BY_PERP_ID = new Map<string, MarketSymbol>(
  Object.entries(PERPL_TESTNET.markets).map(([symbol, id]) => [id.toString(), symbol as MarketSymbol]),
);

export const marketOfPerpId = (perpId: string | number | bigint) => MARKET_BY_PERP_ID.get(String(perpId));

/** First line of a wallet/RPC error, with the common onboarding failures said plainly. */
export function friendlyTxError(e: unknown): string {
  const raw = (e as Error)?.message ?? String(e);
  if (/exceeds the balance|insufficient funds/i.test(raw)) return "You need MON for gas on your passkey address.";
  if (/user rejected|NotAllowedError|cancel/i.test(raw)) return "Signature cancelled.";
  return raw.split("\n")[0];
}

/** Side of an on-chain OrderDesc type (verified enum: OpenLong = 0). Closes report the side they reduce. */
export function describeOrderType(orderType: number): { label: string; side: "long" | "short" } | undefined {
  switch (orderType) {
    case OrderDescType.OpenLong:
      return { label: "Open long", side: "long" };
    case OrderDescType.OpenShort:
      return { label: "Open short", side: "short" };
    case OrderDescType.CloseLong:
      return { label: "Close long", side: "long" };
    case OrderDescType.CloseShort:
      return { label: "Close short", side: "short" };
    default:
      return undefined;
  }
}
