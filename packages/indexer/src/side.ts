// Side inference without trusting an undocumented enum.
// The on-chain OrderDescEnum is verified (Perpl fork test): 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort.
// The on-chain PositionEnum is not documented (REST uses 1 Long / 2 Short, but the on-chain order enum
// already differs from REST by one). So the side of a position comes from the order that opened it, and
// the PositionEnum value is only *learned* from those pairs.

export type Side = "long" | "short" | "unknown";

export function sideFromOrderType(orderType: number | undefined): Side {
  if (orderType === 0 || orderType === 2) return "long"; // OpenLong / CloseLong act on a long
  if (orderType === 1 || orderType === 3) return "short";
  return "unknown";
}

export type Calibration = { longCount: number; shortCount: number };

/** A raw PositionEnum value maps to a side only when every observation agrees. */
export function sideFromCalibration(c: Calibration | undefined): Side {
  if (!c) return "unknown";
  if (c.longCount > 0 && c.shortCount === 0) return "long";
  if (c.shortCount > 0 && c.longCount === 0) return "short";
  return "unknown";
}

export function flip(side: Side): Side {
  return side === "long" ? "short" : side === "short" ? "long" : "unknown";
}
