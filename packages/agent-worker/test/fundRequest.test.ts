import { APPROVAL_DOMAIN, CONSENT_REQUEST_TYPES, FUND_REQUEST_TYPES } from "@omniagent/core";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { validateFundRequest } from "../src/validate";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const NOW = 1_900_000_000n;
const opts = { chainId: 10143, nowSec: NOW };

const sign = async (signer = owner, deadline = NOW + 300n) => ({
  owner: owner.address,
  deadline: deadline.toString(),
  signature: await signer.signTypedData({
    domain: APPROVAL_DOMAIN(10143),
    types: FUND_REQUEST_TYPES,
    primaryType: "FundRequest",
    message: { owner: owner.address, deadline },
  }),
});

describe("validateFundRequest", () => {
  it("returns the owner for a request the owner signed", async () => {
    expect(await validateFundRequest(await sign(), opts)).toBe(owner.address);
  });

  it("rejects a stranger's signature, an expired or far deadline, and malformed bodies", async () => {
    await expect(validateFundRequest(await sign(stranger), opts)).rejects.toThrow(/not signed/);
    await expect(validateFundRequest(await sign(owner, NOW - 1n), opts)).rejects.toThrow(/expired/);
    await expect(validateFundRequest(await sign(owner, NOW + 7200n), opts)).rejects.toThrow(/too far/);
    await expect(validateFundRequest({ owner: owner.address }, opts)).rejects.toThrow(/malformed/);
  });

  it("does not accept an operator-consent signature as a funding request", async () => {
    const deadline = NOW + 300n;
    const consentSig = await owner.signTypedData({
      domain: APPROVAL_DOMAIN(10143),
      types: CONSENT_REQUEST_TYPES,
      primaryType: "ConsentRequest",
      message: { owner: owner.address, deadline },
    });
    await expect(
      validateFundRequest({ owner: owner.address, deadline: deadline.toString(), signature: consentSig }, opts),
    ).rejects.toThrow(/not signed/);
  });
});
