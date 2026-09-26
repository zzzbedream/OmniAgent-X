// Optional GraphQL client for the Envio indexer (packages/indexer). Disabled when NEXT_PUBLIC_INDEXER_URL is unset.
// Query shapes follow Envio's Hasura convention (one root field per entity); verify against a running indexer.

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message ?? `indexer HTTP ${res.status}`);
  return body.data as T;
}

export type IndexedEvent = {
  id: string;
  kind: string;
  perpId: string | null;
  side: string | null;
  pricePNS: string | null;
  lotLNS: string | null;
  amountCNS: string | null;
  block: number;
  timestamp: number;
  txHash: string;
};

export type Calibration = { id: string; longCount: number; shortCount: number };

export async function fetchIndexed(accountId: bigint) {
  return gql<{ AccountEvent: IndexedEvent[]; SideCalibration: Calibration[] }>(
    `query($acc: numeric!) {
      AccountEvent(where: { accountId: { _eq: $acc } }, order_by: { block: desc }, limit: 25) {
        id kind perpId side pricePNS lotLNS amountCNS block timestamp txHash
      }
      SideCalibration { id longCount shortCount }
    }`,
    { acc: accountId.toString() },
  );
}

/** Same rule as the indexer: a raw PositionEnum maps to a side only when every observation agrees. */
export function sideForRaw(raw: number, calibrations: Calibration[]): "long" | "short" | "unknown" {
  const c = calibrations.find(x => x.id === String(raw));
  if (!c) return "unknown";
  if (c.longCount > 0 && c.shortCount === 0) return "long";
  if (c.shortCount > 0 && c.longCount === 0) return "short";
  return "unknown";
}
