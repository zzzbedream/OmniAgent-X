// Operator allowlist repair. The DelegatedAccountFactory deployed on Monad testnet mints accounts whose
// operator allowlist predates the current Exchange ABI: execOrder is NOT allowed until the owner fixes it
// (PerplFoundation/delegated-account test/DelegatedAccount.fork.t.sol, Fork_DeployedFactoryAllowlist_Test).
// Selector lists mirror script/helpers/OperatorAllowlistScript.sol; current selectors were checked with
// `solc --hashes interfaces/IExchange.sol`.
import type { Address, Hex, PublicClient } from "viem";
import { delegatedAccountAbi } from "./abi";

export const CURRENT_OPERATOR_SELECTORS: readonly { selector: Hex; name: string }[] = [
  { selector: "0x4d8dc985", name: "execOrder" },
  { selector: "0x39435dac", name: "execOrders" },
  { selector: "0xf769f0d3", name: "increasePositionCollateral" },
  { selector: "0x171a5b81", name: "requestDecreasePositionCollateral" },
  { selector: "0xbbac6c95", name: "buyLiquidations" },
  { selector: "0xbad4a01f", name: "depositCollateral" },
  { selector: "0x7962f910", name: "allowOrderForwarding" },
];

export const STALE_OPERATOR_SELECTORS: readonly { selector: Hex; name: string }[] = [
  { selector: "0x6b69ebbe", name: "execOrder (old OrderDesc)" },
  { selector: "0xaf3176da", name: "execOrders (old OrderDesc)" },
  { selector: "0x9c64b2b5", name: "requestDecreasePositionCollateral(uint256)" },
  { selector: "0x4a1feb12", name: "decreasePositionCollateral (never for operators)" },
  { selector: "0x1eebd35e", name: "buyLiquidations (old desc)" },
];

export const EXEC_ORDER_SELECTOR: Hex = "0x4d8dc985";

export type AllowlistChange = { selector: Hex; name: string; allowed: boolean };

/** Owner-side changes needed to match Perpl's current allowlist (empty when already in sync). */
export async function readAllowlistDrift(client: PublicClient, account: Address): Promise<AllowlistChange[]> {
  const read = (selector: Hex) =>
    client.readContract({ address: account, abi: delegatedAccountAbi, functionName: "operatorAllowlist", args: [selector] });
  const [current, stale] = await Promise.all([
    Promise.all(CURRENT_OPERATOR_SELECTORS.map(s => read(s.selector))),
    Promise.all(STALE_OPERATOR_SELECTORS.map(s => read(s.selector))),
  ]);
  return [
    ...CURRENT_OPERATOR_SELECTORS.filter((_, i) => !current[i]).map(s => ({ ...s, allowed: true })),
    ...STALE_OPERATOR_SELECTORS.filter((_, i) => stale[i]).map(s => ({ ...s, allowed: false })),
  ];
}
